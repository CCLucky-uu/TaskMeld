import {
  exportStoredArtifactContents,
  listStoredArtifacts,
  readStoredArtifactContent,
} from "../../artifacts/storage-service.js";
import { rebuildArtifactIndex } from "../../artifacts/artifact-index.js";
import { planCleanup, executeCleanup } from "../../artifacts/artifact-cleanup.js";
import { scanStoredArtifacts } from "../../artifacts/storage-service.js";
import type { Router } from "../types.js";
import type { PipelineDefinition } from "../../app/pipeline-config.js";

type ArtifactsServices = {
  listPipelines: () => PipelineDefinition[];
  getPipelineDefinition: (id: string) => PipelineDefinition | undefined;
};

const parseCsvParam = (value: string | null): string[] =>
  value
    ? value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];

export const registerArtifactsRoutes = (router: Router): void => {
  router.register("GET", "/api/artifacts", async (ctx) => {
    const services = ctx.services as ArtifactsServices;
    const pipelineIds = parseCsvParam(ctx.url.searchParams.get("pipelineId"));
    const nodeIds = parseCsvParam(ctx.url.searchParams.get("nodeId"));
    const statuses = parseCsvParam(ctx.url.searchParams.get("status"));
    const kinds = parseCsvParam(ctx.url.searchParams.get("kind"));
    const dateFrom =
      String(ctx.url.searchParams.get("dateFrom") ?? "").trim() || null;
    const dateTo =
      String(ctx.url.searchParams.get("dateTo") ?? "").trim() || null;
    const cursor =
      String(ctx.url.searchParams.get("cursor") ?? "").trim() || undefined;
    const batchRunId =
      String(ctx.url.searchParams.get("batchRunId") ?? "").trim() || undefined;
    const runId =
      String(ctx.url.searchParams.get("runId") ?? "").trim() || undefined;
    const limitRaw = Number(ctx.url.searchParams.get("limit") ?? 100);

    const result = await listStoredArtifacts(services.listPipelines(), {
      pipelineIds,
      nodeIds,
      dateFrom,
      dateTo,
      limit: Number.isFinite(limitRaw) ? limitRaw : 100,
      cursor,
      statuses: statuses.length ? statuses : undefined,
      kinds: kinds.length ? kinds : undefined,
      batchRunId,
      runId,
    });
    ctx.sendJson(200, {
      items: result.items,
      nextCursor: result.nextCursor,
      source: result.source,
    });
  });

  router.register("GET", "/api/artifacts/content", async (ctx) => {
    const services = ctx.services as ArtifactsServices;
    const pipelineId = String(
      ctx.url.searchParams.get("pipelineId") ?? "",
    ).trim();
    const relativePath = String(
      ctx.url.searchParams.get("relativePath") ?? "",
    ).trim();
    const artifactId = String(
      ctx.url.searchParams.get("artifactId") ?? "",
    ).trim();
    if (!pipelineId || (!relativePath && !artifactId)) {
      ctx.sendJson(400, { error: "invalid_artifact_query" });
      return;
    }
    const definition = services.getPipelineDefinition(pipelineId);
    if (!definition) {
      ctx.sendJson(404, { error: "pipeline_not_found", pipelineId });
      return;
    }
    // artifactId 查询：从索引/扫描列表中查找对应 relativePath
    let resolvedPath = relativePath || undefined;
    if (!resolvedPath && artifactId) {
      const listResult = await listStoredArtifacts(services.listPipelines(), {
        pipelineIds: [pipelineId],
        limit: 5000,
      });
      const match = listResult.items.find((item) => item.artifactId === artifactId);
      resolvedPath = match?.relativePath ?? undefined;
    }
    if (!resolvedPath) {
      ctx.sendJson(404, { error: "artifact_not_found", pipelineId, artifactId: artifactId || null });
      return;
    }
    const content = await readStoredArtifactContent(definition, resolvedPath);
    if (!content) {
      ctx.sendJson(404, {
        error: "artifact_not_found",
        pipelineId,
        relativePath: resolvedPath,
      });
      return;
    }
    ctx.sendJson(200, {
      pipelineId,
      relativePath: resolvedPath,
      artifactId: artifactId || null,
      content,
    });
  });

  router.register("GET", "/api/artifacts/export", async (ctx) => {
    const services = ctx.services as ArtifactsServices;
    const pipelineIds = parseCsvParam(ctx.url.searchParams.get("pipelineId"));
    const nodeIds = parseCsvParam(ctx.url.searchParams.get("nodeId"));
    const dateFrom =
      String(ctx.url.searchParams.get("dateFrom") ?? "").trim() || null;
    const dateTo =
      String(ctx.url.searchParams.get("dateTo") ?? "").trim() || null;
    const limitRaw = Number(ctx.url.searchParams.get("limit") ?? 20000);
    const kinds = parseCsvParam(ctx.url.searchParams.get("kind"));
    // 默认排除 envelope，避免同一业务内容在 envelope 和 artifact 文件中重复出现
    const effectiveKinds = kinds.length > 0 ? kinds : ["artifact", "adapter", "group"];
    const data = await exportStoredArtifactContents(
      services.listPipelines(),
      {
        pipelineIds,
        nodeIds,
        dateFrom,
        dateTo,
        limit: Number.isFinite(limitRaw) ? limitRaw : 20000,
        kinds: effectiveKinds,
      },
    );
    ctx.sendJson(200, { data });
  });

  router.register("POST", "/api/artifacts/cleanup", async (ctx) => {
    const services = ctx.services as ArtifactsServices;
    const pipelineId =
      String(ctx.url.searchParams.get("pipelineId") ?? "").trim() || undefined;
    const olderThanDays = parseInt(ctx.url.searchParams.get("olderThanDays") ?? "0", 10) || undefined;
    const statusParam = ctx.url.searchParams.get("status") ?? "";
    const statuses = statusParam ? statusParam.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
    const confirm = ctx.url.searchParams.get("confirm") === "true";
    const definitions = pipelineId
      ? [services.getPipelineDefinition(pipelineId)].filter(Boolean) as PipelineDefinition[]
      : services.listPipelines();
    if (definitions.length === 0) {
      ctx.sendJson(404, { error: "pipeline_not_found", pipelineId });
      return;
    }
    let totalFiles = 0;
    let totalSizeBytes = 0;
    let deleted = 0;
    let failed = 0;
    const allWarnings: string[] = [];
    for (const definition of definitions) {
      const plan = await planCleanup(definition, { olderThanDays, statuses });
      totalFiles += plan.files.length;
      totalSizeBytes += plan.totalSizeBytes;
      if (confirm) {
        const execResult = await executeCleanup(definition, plan);
        deleted += execResult.deleted;
        failed += execResult.failed;
        allWarnings.push(...execResult.warnings);
      }
    }
    ctx.sendJson(200, { totalFiles, totalSizeBytes, deleted, failed, dryRun: !confirm, warnings: allWarnings });
  });

  router.register("POST", "/api/artifacts/rebuild-index", async (ctx) => {
    const services = ctx.services as ArtifactsServices;
    const pipelineId =
      String(ctx.url.searchParams.get("pipelineId") ?? "").trim() || undefined;
    const definitions = pipelineId
      ? [services.getPipelineDefinition(pipelineId)].filter(Boolean) as PipelineDefinition[]
      : services.listPipelines();
    if (definitions.length === 0) {
      ctx.sendJson(404, { error: "pipeline_not_found", pipelineId });
      return;
    }
    let indexed = 0;
    let skipped = 0;
    const warnings: string[] = [];
    for (const definition of definitions) {
      const result = await rebuildArtifactIndex(definition, (d) =>
        scanStoredArtifacts([d]),
      );
      indexed += result.indexed;
      skipped += result.skipped;
      warnings.push(...result.warnings);
    }
    ctx.sendJson(200, { indexed, skipped, warnings });
  });
};
