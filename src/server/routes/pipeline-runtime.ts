import type { Router } from "../types.js";
import type { PipelineService } from "../../services/pipeline-service.js";
import { readIdentityTargetFromUrl, readIdentityTargetFromBody, mergeIdentityTargets } from "./pipeline-identity.js";

type RuntimeServices = {
  pipelineService: PipelineService;
};

/**
 * 注册 Pipeline 运行态路由：
 *   GET    /api/pipelines/:pipelineId/current             — 当前运行信息
 *   GET    /api/pipelines/:pipelineId/status              — Pipeline 状态
 *   POST   /api/pipelines/:pipelineId/run                 — 启动运行
 *   POST   /api/pipelines/:pipelineId/stop                — 停止运行（同时作为 /batch-run/stop 的别名入口）
 *   GET    /api/pipelines/:pipelineId/executor-bindings   — Executor 会话绑定
 *   POST   /api/pipelines/:pipelineId/nodes/:nodeId/retry — 节点重试
 */
export const registerPipelineRuntimeRoutes = (router: Router): void => {
  // GET /api/pipelines/:pipelineId/current
  router.register("GET", "/api/pipelines/:pipelineId/current", (ctx) => {
    const scope = ctx.getPipelineScope();
    if (!scope) {
      ctx.sendJson(404, { error: "pipeline_not_found", pipelineId: ctx.params.pipelineId });
      return;
    }
    const run = scope.getRun();
    scope.touchRun(run);
    const workflow = scope.getWorkflow?.();
    const nodes =
      workflow?.nodes && workflow.nodes.length > 0
        ? run.nodes.map((node: { id: string }) => {
            const matched = workflow.nodes.find((wNode: { id: string }) => wNode.id === node.id);
            return {
              ...node,
              isMainline: matched?.isMainline ?? true,
              lane: matched?.lane ?? "main",
              parallelGroupId: matched?.parallelGroupId ?? null,
            };
          })
        : run.nodes;
    ctx.sendJson(200, {
      run: { ...run, nodes },
      runId: run.id,
      nodes,
      scheduler: scope.getSchedulerState ? scope.getSchedulerState() : null,
      pipelineId: scope.pipelineId,
    });
  });

  // GET /api/pipelines/:pipelineId/status
  router.register("GET", "/api/pipelines/:pipelineId/status", (ctx) => {
    const scope = ctx.getPipelineScope();
    if (!scope) {
      ctx.sendJson(404, { error: "pipeline_not_found", pipelineId: ctx.params.pipelineId });
      return;
    }
    const { pipelineService } = ctx.services as RuntimeServices;
    const result = pipelineService.getPipelineExecutionStatus(scope.pipelineId, readIdentityTargetFromUrl(ctx.url));
    const statusCode = result.ok === false && (result as { error?: string }).error === "run_not_found" ? 404 : 200;
    ctx.sendJson(statusCode, result);
  });

  // POST /api/pipelines/:pipelineId/run
  router.register("POST", "/api/pipelines/:pipelineId/run", async (ctx) => {
    const scope = ctx.getPipelineScope();
    if (!scope) {
      ctx.sendJson(404, { error: "pipeline_not_found", pipelineId: ctx.params.pipelineId });
      return;
    }
    const { pipelineService } = ctx.services as RuntimeServices;
    const started = await pipelineService.startPipeline(scope.pipelineId);
    if (started.ok === false && (started as { error?: string }).error === "batch_run_in_progress") {
      ctx.sendJson(409, { ok: false, error: started.error, state: started.state, pipelineId: scope.pipelineId });
      return;
    }
    if (started.ok === false) {
      const statusCode =
        (started as { error?: string }).error === "remote_pool_url_empty" || (started as { error?: string }).error === "remote_batch_items_empty"
          ? 400
          : (started as { error?: string }).error === "remote_pool_fetch_failed" || (started as { error?: string }).error === "remote_pool_fetch_error"
            ? 502
            : 409;
      ctx.sendJson(statusCode, {
        ok: false,
        error: started.error,
        state: started.state,
        remoteUrl: started.remoteUrl,
        status: started.status,
        detail: started.detail,
        pipelineId: scope.pipelineId,
      });
      return;
    }
    if (started.mode === "remote_batch") {
      ctx.sendJson(200, {
        ...started,
        state: started.batchRun,
      });
      return;
    }
    ctx.sendJson(200, started);
  });

  // POST /api/pipelines/:pipelineId/stop
  // 旧代码中 /stop 与 /batch-run/stop 共享同一处理逻辑；此处注册 /stop，/batch-run/stop 在 pipeline-batch.ts 中注册
  router.register("POST", "/api/pipelines/:pipelineId/stop", async (ctx) => {
    const scope = ctx.getPipelineScope();
    if (!scope) {
      ctx.sendJson(404, { error: "pipeline_not_found", pipelineId: ctx.params.pipelineId });
      return;
    }
    const { pipelineService } = ctx.services as RuntimeServices;
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

  // GET /api/pipelines/:pipelineId/executor-bindings
  router.register("GET", "/api/pipelines/:pipelineId/executor-bindings", (ctx) => {
    const scope = ctx.getPipelineScope();
    if (!scope) {
      ctx.sendJson(404, { error: "pipeline_not_found", pipelineId: ctx.params.pipelineId });
      return;
    }
    ctx.sendJson(200, {
      bindings: Object.fromEntries(scope.executorSessionByAgentId.entries()),
      sessions: scope.getSessionCache().map((s: { id: string; title: string }) => ({ id: s.id, title: s.title })),
      pipelineId: scope.pipelineId,
    });
  });

  // POST /api/pipelines/:pipelineId/nodes/:nodeId/retry
  router.register("POST", "/api/pipelines/:pipelineId/nodes/:nodeId/retry", async (ctx) => {
    const scope = ctx.getPipelineScope();
    if (!scope) {
      ctx.sendJson(404, { error: "pipeline_not_found", pipelineId: ctx.params.pipelineId });
      return;
    }
    const { pipelineService } = ctx.services as RuntimeServices;
    const body = await ctx.readBody();
    const itemKey = typeof body.itemKey === "string" && body.itemKey.trim() ? body.itemKey.trim() : undefined;
    const result = await pipelineService.retryNode({
      pipelineId: scope.pipelineId,
      nodeId: ctx.params.nodeId,
      itemKey,
    });
    if (!result.ok) {
      ctx.sendJson(404, result);
      return;
    }
    if (!result.retry.ok && (result.retry as { error?: string }).error === "node_not_found") {
      ctx.sendJson(404, { run: result.run, ...result.retry });
      return;
    }
    if (!result.retry.ok && (result.retry as { error?: string }).error === "executor_session_not_found") {
      ctx.sendJson(400, { run: result.run, ...result.retry });
      return;
    }
    ctx.sendJson(200, { run: result.run, ...result.retry });
  });
};
