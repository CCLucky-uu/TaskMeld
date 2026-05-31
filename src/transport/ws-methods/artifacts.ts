import type { WsMethodRegistry } from "./types";
import type { PipelineRegistry } from "../../app/pipeline-registry";
import type { PipelineDefinition } from "../../app/pipeline-config";
import {
  exportStoredArtifactContents,
  listStoredArtifacts,
  readStoredArtifactContent,
} from "../../artifacts/storage-service";
import { rebuildArtifactIndex } from "../../artifacts/artifact-index";
import { planCleanup, executeCleanup } from "../../artifacts/artifact-cleanup";
import { scanStoredArtifacts } from "../../artifacts/storage-service";

const parseCsvParam = (value: unknown): string[] => {
  if (typeof value !== "string") return [];
  return value.split(",").map((s) => s.trim()).filter(Boolean);
};

export const registerArtifactWsMethods = (registry: WsMethodRegistry): void => {
  registry.register("artifact.list", async (params, ctx) => {
    try {
      const pipelineIds = parseCsvParam(params.pipelineId);
      const nodeIds = parseCsvParam(params.nodeId);
      const statuses = parseCsvParam(params.status);
      const kinds = parseCsvParam(params.kind);
      const dateFrom = typeof params.dateFrom === "string" && params.dateFrom.trim() ? params.dateFrom.trim() : null;
      const dateTo = typeof params.dateTo === "string" && params.dateTo.trim() ? params.dateTo.trim() : null;
      const cursor = typeof params.cursor === "string" && params.cursor.trim() ? params.cursor.trim() : undefined;
      const batchRunId = typeof params.batchRunId === "string" && params.batchRunId.trim() ? params.batchRunId.trim() : undefined;
      const runId = typeof params.runId === "string" && params.runId.trim() ? params.runId.trim() : undefined;
      const limitRaw = typeof params.limit === "number" ? params.limit : 100;

      const result = await listStoredArtifacts(ctx.app.listPipelines(), {
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
      return {
        ok: true,
        payload: { items: result.items, nextCursor: result.nextCursor, source: result.source },
      };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  });

  registry.register("artifact.content.get", async (params, ctx) => {
    try {
      const pipelineId = typeof params.pipelineId === "string" ? params.pipelineId.trim() : "";
      const relativePath = typeof params.relativePath === "string" ? params.relativePath.trim() : "";
      const artifactId = typeof params.artifactId === "string" ? params.artifactId.trim() : "";
      if (!pipelineId || (!relativePath && !artifactId)) {
        return { ok: false, error: "invalid_artifact_query" };
      }
      const definition = ctx.app.getPipelineDefinition(pipelineId);
      if (!definition) {
        return { ok: false, error: "pipeline_not_found" };
      }
      let resolvedPath = relativePath || undefined;
      if (!resolvedPath && artifactId) {
        const listResult = await listStoredArtifacts(ctx.app.listPipelines(), {
          pipelineIds: [pipelineId],
          limit: 5000,
        });
        const match = listResult.items.find((item) => item.artifactId === artifactId);
        resolvedPath = match?.relativePath ?? undefined;
      }
      if (!resolvedPath) {
        return { ok: false, error: "artifact_not_found" };
      }
      const content = await readStoredArtifactContent(definition, resolvedPath);
      if (!content) {
        return { ok: false, error: "artifact_not_found" };
      }
      return {
        ok: true,
        payload: { pipelineId, relativePath: resolvedPath, artifactId: artifactId || null, content },
      };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  });

  registry.register("artifact.export", async (params, ctx) => {
    try {
      const pipelineIds = parseCsvParam(params.pipelineId);
      const nodeIds = parseCsvParam(params.nodeId);
      const dateFrom = typeof params.dateFrom === "string" && params.dateFrom.trim() ? params.dateFrom.trim() : null;
      const dateTo = typeof params.dateTo === "string" && params.dateTo.trim() ? params.dateTo.trim() : null;
      const limitRaw = typeof params.limit === "number" ? params.limit : 20000;
      const kinds = parseCsvParam(params.kind);
      const effectiveKinds = kinds.length > 0 ? kinds : ["artifact", "adapter", "group"];
      const data = await exportStoredArtifactContents(ctx.app.listPipelines(), {
        pipelineIds,
        nodeIds,
        dateFrom,
        dateTo,
        limit: Number.isFinite(limitRaw) ? limitRaw : 20000,
        kinds: effectiveKinds,
      });
      return { ok: true, payload: { data } };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  });

  registry.register("artifact.cleanup", async (params, ctx) => {
    try {
      const pipelineId = typeof params.pipelineId === "string" ? params.pipelineId.trim() : undefined;
      const olderThanDaysRaw = typeof params.olderThanDays === "number" ? params.olderThanDays : 0;
      const olderThanDays = olderThanDaysRaw || undefined;
      const statusParam = typeof params.status === "string" ? params.status : "";
      const statuses = statusParam ? statusParam.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
      const confirm = params.confirm === true;
      const definitions: PipelineDefinition[] = pipelineId
        ? [ctx.app.getPipelineDefinition(pipelineId)].filter(Boolean) as PipelineDefinition[]
        : ctx.app.listPipelines();
      if (definitions.length === 0) {
        return { ok: false, error: "pipeline_not_found" };
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
      return {
        ok: true,
        payload: { totalFiles, totalSizeBytes, deleted, failed, dryRun: !confirm, warnings: allWarnings },
      };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  });

  registry.register("artifact.rebuildIndex", async (params, ctx) => {
    try {
      const pipelineId = typeof params.pipelineId === "string" ? params.pipelineId.trim() : undefined;
      const definitions: PipelineDefinition[] = pipelineId
        ? [ctx.app.getPipelineDefinition(pipelineId)].filter(Boolean) as PipelineDefinition[]
        : ctx.app.listPipelines();
      if (definitions.length === 0) {
        return { ok: false, error: "pipeline_not_found" };
      }
      let indexed = 0;
      let skipped = 0;
      const warnings: string[] = [];
      for (const definition of definitions) {
        const result = await rebuildArtifactIndex(definition, (d) => scanStoredArtifacts([d]));
        indexed += result.indexed;
        skipped += result.skipped;
        warnings.push(...result.warnings);
      }
      return { ok: true, payload: { indexed, skipped, warnings } };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  });
};
