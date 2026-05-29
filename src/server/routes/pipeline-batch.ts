import type { Router } from "../types.js";
import type { PipelineService } from "../../services/pipeline-service.js";
import { readPipelineIdentitySnapshot } from "../../services/pipeline-service.js";
import { normalizePoolItems } from "../../pipeline/item-batch-controller.js";
import { readIdentityTargetFromUrl, readIdentityTargetFromBody, mergeIdentityTargets } from "./pipeline-identity.js";

type BatchServices = {
  pipelineService: PipelineService;
};

/**
 * 注册 Pipeline Batch Run 路由：
 *   GET    /api/pipelines/:pipelineId/items                     — Item Run 列表
 *   GET    /api/pipelines/:pipelineId/batch-run/status          — Batch Run 状态
 *   POST   /api/pipelines/:pipelineId/batch-run/start           — 启动本地 Batch Run
 *   POST   /api/pipelines/:pipelineId/batch-run/start-remote    — 启动远程 Batch Run
 *   POST   /api/pipelines/:pipelineId/batch-run/stop            — 停止 Batch Run
 */
export const registerPipelineBatchRoutes = (router: Router): void => {
  // GET /api/pipelines/:pipelineId/items
  router.register("GET", "/api/pipelines/:pipelineId/items", (ctx) => {
    const scope = ctx.getPipelineScope();
    if (!scope) {
      ctx.sendJson(404, { error: "pipeline_not_found", pipelineId: ctx.params.pipelineId });
      return;
    }
    if (!scope.getItemRuns) {
      ctx.sendJson(501, { error: "item_run_api_not_enabled" });
      return;
    }
    ctx.sendJson(200, { items: scope.getItemRuns(), pipelineId: scope.pipelineId });
  });

  // GET /api/pipelines/:pipelineId/batch-run/status
  router.register("GET", "/api/pipelines/:pipelineId/batch-run/status", (ctx) => {
    const scope = ctx.getPipelineScope();
    if (!scope) {
      ctx.sendJson(404, { error: "pipeline_not_found", pipelineId: ctx.params.pipelineId });
      return;
    }
    if (!scope.getBatchRunState) {
      ctx.sendJson(501, { error: "batch_run_api_not_enabled" });
      return;
    }
    const batchRunState = scope.getBatchRunState();
    const identity = readPipelineIdentitySnapshot(scope.pipelineId, scope.getRun(), batchRunState);
    ctx.sendJson(200, { ok: true, state: batchRunState, ...identity });
  });

  // POST /api/pipelines/:pipelineId/batch-run/start
  router.register("POST", "/api/pipelines/:pipelineId/batch-run/start", async (ctx) => {
    const scope = ctx.getPipelineScope();
    if (!scope) {
      ctx.sendJson(404, { error: "pipeline_not_found", pipelineId: ctx.params.pipelineId });
      return;
    }
    const { pipelineService } = ctx.services as BatchServices;
    const body = await ctx.readBody();
    const items = normalizePoolItems(body.items ?? body.keywords ?? body.pool ?? body);
    const batchSize =
      typeof body.batchSize === "number"
        ? body.batchSize
        : typeof body.size === "number"
          ? body.size
          : typeof body.chunkSize === "number"
            ? body.chunkSize
            : undefined;
    const startIndex = typeof body.startIndex === "number" ? body.startIndex : undefined;
    const startBatch = typeof body.startBatch === "number" ? body.startBatch : undefined;
    const started = pipelineService.startBatchRun({
      pipelineId: scope.pipelineId,
      items,
      batchSize,
      startIndex,
      startBatch,
    });
    if (started.ok === false && (started as { error?: string }).error === "batch_items_empty") {
      ctx.sendJson(400, { error: started.error });
      return;
    }
    if (!started.ok) {
      ctx.sendJson(409, { ok: false, error: started.error, state: started.state });
      return;
    }
    ctx.sendJson(200, { ok: true, state: started.state, pipelineId: scope.pipelineId });
  });

  // POST /api/pipelines/:pipelineId/batch-run/start-remote
  router.register("POST", "/api/pipelines/:pipelineId/batch-run/start-remote", async (ctx) => {
    const scope = ctx.getPipelineScope();
    if (!scope) {
      ctx.sendJson(404, { error: "pipeline_not_found", pipelineId: ctx.params.pipelineId });
      return;
    }
    const { pipelineService } = ctx.services as BatchServices;
    const body = await ctx.readBody();
    const remoteUrl = typeof body.url === "string" ? body.url : undefined;
    const batchSize =
      typeof body.batchSize === "number"
        ? body.batchSize
        : typeof body.size === "number"
          ? body.size
          : typeof body.chunkSize === "number"
            ? body.chunkSize
            : undefined;
    const startIndex = typeof body.startIndex === "number" ? body.startIndex : undefined;
    const startBatch = typeof body.startBatch === "number" ? body.startBatch : undefined;
    const started = await pipelineService.startRemoteBatchRun({
      pipelineId: scope.pipelineId,
      url: remoteUrl,
      batchSize,
      startIndex,
      startBatch,
    });
    // 保持 remote pool 相关错误状态码语义：400 / 403 / 409 / 502
    if (started.ok === false && (started as { error?: string }).error === "pipeline_plugin_disabled") {
      ctx.sendJson(403, { error: started.error, plugin: started.plugin, pipelineId: scope.pipelineId });
      return;
    }
    if (
      started.ok === false &&
      ((started as { error?: string }).error === "remote_pool_url_empty" || (started as { error?: string }).error === "remote_batch_items_empty")
    ) {
      ctx.sendJson(400, { error: started.error, remoteUrl: started.remoteUrl });
      return;
    }
    if (
      started.ok === false &&
      ((started as { error?: string }).error === "remote_pool_fetch_failed" || (started as { error?: string }).error === "remote_pool_fetch_error")
    ) {
      ctx.sendJson(502, {
        error: started.error,
        status: started.status,
        remoteUrl: started.remoteUrl,
        detail: started.detail,
      });
      return;
    }
    if (!started.ok) {
      ctx.sendJson(409, { ok: false, error: started.error, state: started.state, remoteUrl: started.remoteUrl });
      return;
    }
    ctx.sendJson(200, {
      ok: true,
      state: started.state,
      remoteUrl: started.remoteUrl,
      totalFetched: started.totalFetched,
      pipelineId: scope.pipelineId,
    });
  });

  // POST /api/pipelines/:pipelineId/batch-run/stop
  // 与 /stop 共享同一业务逻辑，通过 pipelineService.stopPipeline 统一处理
  router.register("POST", "/api/pipelines/:pipelineId/batch-run/stop", async (ctx) => {
    const scope = ctx.getPipelineScope();
    if (!scope) {
      ctx.sendJson(404, { error: "pipeline_not_found", pipelineId: ctx.params.pipelineId });
      return;
    }
    const { pipelineService } = ctx.services as BatchServices;
    const body = await ctx.readBody();
    const target = mergeIdentityTargets(readIdentityTargetFromBody(body), readIdentityTargetFromUrl(ctx.url));
    const stopped = pipelineService.stopPipeline(scope.pipelineId, target);
    if (stopped.ok === false && (stopped as { error?: string }).error === "run_not_found") {
      ctx.sendJson(404, stopped);
      return;
    }
    if (stopped.ok === false) {
      ctx.sendJson(409, stopped);
      return;
    }
    ctx.sendJson(200, {
      ...stopped,
    });
  });
};
