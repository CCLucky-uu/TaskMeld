import type { WsMethodRegistry } from "./types";

export const registerPipelineSchedulerWsMethods = (registry: WsMethodRegistry): void => {
  // pipeline.scheduler.toggle
  registry.register("pipeline.scheduler.toggle", async (params, ctx) => {
    const pipelineId = typeof params.pipelineId === "string" ? params.pipelineId : "";
    const runtime = ctx.app.getPipelineRuntime(pipelineId);
    if (!runtime) return { ok: false, error: "pipeline_not_found" };
    const enabled = params.enabled !== false;
    const toggled = ctx.services.schedulerService.toggleScheduler(pipelineId, enabled);
    if (!toggled.ok) {
      return { ok: false, error: toggled.error };
    }
    runtime.runtime.pushTimeline(`[${pipelineId}] Scheduler ${toggled.scheduler.enabled ? "enabled" : "disabled"}`);
    return { ok: true, payload: toggled };
  });

  // pipeline.scheduler.mode
  registry.register("pipeline.scheduler.mode", async (params, ctx) => {
    const pipelineId = typeof params.pipelineId === "string" ? params.pipelineId : "";
    const runtime = ctx.app.getPipelineRuntime(pipelineId);
    if (!runtime) return { ok: false, error: "pipeline_not_found" };
    const mode = params.mode === "manual" ? "manual" : "auto";
    const updated = ctx.services.schedulerService.setSchedulerMode(pipelineId, mode);
    if (!updated.ok) {
      return { ok: false, error: updated.error };
    }
    runtime.runtime.pushTimeline(`[${pipelineId}] Scheduler mode switched to: ${updated.scheduler.mode}`);
    return { ok: true, payload: updated };
  });

  // pipeline.tick
  registry.register("pipeline.tick", async (params, ctx) => {
    const pipelineId = typeof params.pipelineId === "string" ? params.pipelineId : "";
    const runtime = ctx.app.getPipelineRuntime(pipelineId);
    if (!runtime) return { ok: false, error: "pipeline_not_found" };
    const workflow = runtime.workflow.getWorkflow();
    const schedulerPlugin = workflow.plugins.find(p => p.pluginId === 'scheduler');
    if (!workflow || !schedulerPlugin?.enabled) {
      return { ok: false, error: "pipeline_plugin_disabled" };
    }
    const drained = await runtime.pipeline.drainPipeline("manual_tick");
    const run = runtime.runtime.getRun();
    return { ok: true, payload: { ok: true, run, drained, pipelineId } };
  });
};
