import type { WsMethodRegistry } from "./types";

export const registerPipelineQueueWsMethods = (registry: WsMethodRegistry): void => {
  // pipeline.queue.list
  registry.register("pipeline.queue.list", (params, ctx) => {
    const pipelineId = typeof params.pipelineId === "string" ? params.pipelineId : "";
    if (!ctx.app.getPipelineDefinition(pipelineId)) {
      return { ok: false, error: "pipeline_not_found" };
    }
    const items = ctx.app.dispatch.getQueue(pipelineId);
    return { ok: true, payload: { ok: true, pipelineId, items } };
  });

  // pipeline.queue.retry
  registry.register("pipeline.queue.retry", async (params, ctx) => {
    const pipelineId = typeof params.pipelineId === "string" ? params.pipelineId : "";
    const jobId = typeof params.jobId === "string" ? params.jobId : "";
    if (!ctx.app.getPipelineDefinition(pipelineId)) {
      return { ok: false, error: "pipeline_not_found" };
    }
    const result = await ctx.app.dispatch.retryJob(jobId);
    if (!result.ok) {
      return { ok: false, error: result.error };
    }
    return { ok: true, payload: { ok: true, job: result.job } };
  });

  // pipeline.queue.cancel
  registry.register("pipeline.queue.cancel", async (params, ctx) => {
    const pipelineId = typeof params.pipelineId === "string" ? params.pipelineId : "";
    const jobId = typeof params.jobId === "string" ? params.jobId : "";
    const reason = typeof params.reason === "string" && params.reason.trim() ? params.reason.trim() : "canceled_by_user";
    if (!ctx.app.getPipelineDefinition(pipelineId)) {
      return { ok: false, error: "pipeline_not_found" };
    }
    const result = await ctx.app.dispatch.cancelJob(jobId, reason);
    if (!result.ok) {
      return { ok: false, error: result.error };
    }
    return { ok: true, payload: { ok: true } };
  });

  // pipeline.queue.drain
  registry.register("pipeline.queue.drain", (params, ctx) => {
    const pipelineId = typeof params.pipelineId === "string" ? params.pipelineId : "";
    if (!ctx.app.getPipelineDefinition(pipelineId)) {
      return { ok: false, error: "pipeline_not_found" };
    }
    ctx.app.dispatch.drainQueue(pipelineId);
    return { ok: true, payload: { ok: true, pipelineId } };
  });
};
