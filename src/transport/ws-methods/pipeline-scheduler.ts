import type { WsMethodRegistry } from "./types";

export const registerPipelineSchedulerWsMethods = (registry: WsMethodRegistry): void => {
  // pipeline.scheduler.toggle
  registry.register("pipeline.scheduler.toggle", async (params, ctx) => {
    const pipelineId = typeof params.pipelineId === "string" ? params.pipelineId : "";
    const runtime = ctx.app.getPipelineRuntime(pipelineId);
    if (!runtime) return { ok: false, error: "pipeline_not_found" };
    const enabled = params.enabled !== false;
    const workflow = runtime.workflow.getWorkflow();
    const nextWorkflow = { ...workflow, scheduler: { ...workflow.scheduler, enabled } };
    await runtime.workflow.setWorkflow(nextWorkflow);
    runtime.runtime.pushTimeline(`[${pipelineId}] Scheduler ${enabled ? "enabled" : "disabled"}`);
    return { ok: true, payload: { ok: true, pipelineId, scheduler: { enabled, mode: nextWorkflow.scheduler.mode } } };
  });

  // pipeline.scheduler.mode
  registry.register("pipeline.scheduler.mode", async (params, ctx) => {
    const pipelineId = typeof params.pipelineId === "string" ? params.pipelineId : "";
    const runtime = ctx.app.getPipelineRuntime(pipelineId);
    if (!runtime) return { ok: false, error: "pipeline_not_found" };
    const mode = (params.mode === "manual" ? "manual" : "auto") as "auto" | "manual";
    const workflow = runtime.workflow.getWorkflow();
    const nextWorkflow = { ...workflow, scheduler: { ...workflow.scheduler, mode } };
    await runtime.workflow.setWorkflow(nextWorkflow);
    runtime.runtime.pushTimeline(`[${pipelineId}] Scheduler mode switched to: ${mode}`);
    return { ok: true, payload: { ok: true, pipelineId, scheduler: { enabled: nextWorkflow.scheduler.enabled, mode } } };
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
