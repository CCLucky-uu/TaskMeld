import type { Router, RequestContext } from "../types.js";

export const registerPipelineQueueRoutes = (router: Router): void => {
  // GET /api/pipelines/:pipelineId/queue
  router.register("GET", "/api/pipelines/:pipelineId/queue", async (ctx: RequestContext) => {
    const { app } = ctx.options;
    const { pipelineId } = ctx.params;
    if (!app.getPipelineDefinition(pipelineId)) {
      ctx.sendJson(404, { ok: false, error: "pipeline_not_found", pipelineId });
      return;
    }
    const items = app.dispatch.getQueue(pipelineId);
    ctx.sendJson(200, { ok: true, pipelineId, items });
  });

  // POST /api/pipelines/:pipelineId/queue/:jobId/retry
  router.register("POST", "/api/pipelines/:pipelineId/queue/:jobId/retry", async (ctx: RequestContext) => {
    const { app } = ctx.options;
    const { pipelineId, jobId } = ctx.params;
    if (!app.getPipelineDefinition(pipelineId)) {
      ctx.sendJson(404, { ok: false, error: "pipeline_not_found", pipelineId });
      return;
    }
    const result = await app.dispatch.retryJob(jobId);
    if (!result.ok) {
      const statusCode = result.error === "pipeline_queue_job_not_found" ? 404 : 400;
      ctx.sendJson(statusCode, { ok: false, error: result.error });
      return;
    }
    ctx.sendJson(200, { ok: true, job: result.job });
  });

  // POST /api/pipelines/:pipelineId/queue/:jobId/cancel
  router.register("POST", "/api/pipelines/:pipelineId/queue/:jobId/cancel", async (ctx: RequestContext) => {
    const { app } = ctx.options;
    const { pipelineId, jobId } = ctx.params;
    if (!app.getPipelineDefinition(pipelineId)) {
      ctx.sendJson(404, { ok: false, error: "pipeline_not_found", pipelineId });
      return;
    }
    const body = await ctx.readBody();
    const reason = typeof body.reason === "string" ? body.reason.trim() : "canceled_by_user";
    const result = await app.dispatch.cancelJob(jobId, reason);
    if (!result.ok) {
      const statusCode = result.error === "pipeline_queue_job_not_found" ? 404 : 400;
      ctx.sendJson(statusCode, { ok: false, error: result.error });
      return;
    }
    ctx.sendJson(200, { ok: true });
  });
  // POST /api/pipelines/:pipelineId/queue/drain
  router.register("POST", "/api/pipelines/:pipelineId/queue/drain", async (ctx: RequestContext) => {
    const { app } = ctx.options;
    const { pipelineId } = ctx.params;
    if (!app.getPipelineDefinition(pipelineId)) {
      ctx.sendJson(404, { ok: false, error: "pipeline_not_found", pipelineId });
      return;
    }
    app.dispatch.drainQueue(pipelineId);
    ctx.sendJson(200, { ok: true, pipelineId });
  });
};
