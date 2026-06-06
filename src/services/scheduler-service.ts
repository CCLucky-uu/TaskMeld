import type { PipelineRegistry } from "../app/pipeline-registry";

type PipelineRuntime = NonNullable<ReturnType<PipelineRegistry["getPipelineRuntime"]>>;

export type SchedulerMode = "auto" | "manual";

export type SchedulerToggleResult =
  | {
    ok: true;
    pipelineId: string;
    scheduler: ReturnType<PipelineRuntime["pipeline"]["getSchedulerState"]>;
  }
  | {
    ok: false;
    pipelineId: string;
    error: "pipeline_not_found" | "pipeline_plugin_disabled";
    plugin?: "scheduler";
  };

export type SchedulerModeResult = SchedulerToggleResult;

export type SchedulerService = {
  toggleScheduler: (pipelineId: string, enabled: boolean) => SchedulerToggleResult;
  setSchedulerMode: (pipelineId: string, mode: SchedulerMode) => SchedulerModeResult;
};

const getRuntimeByPipelineId = (app: PipelineRegistry, pipelineId: string): PipelineRuntime | null =>
  app.getPipelineRuntime(pipelineId);

const ensureSchedulerPluginEnabled = (
  runtime: PipelineRuntime,
  pipelineId: string,
): { ok: true } | { ok: false; pipelineId: string; error: "pipeline_plugin_disabled"; plugin: "scheduler" } => {
  const workflow = runtime.workflow.getWorkflow();
  const schedulerPlugin = workflow.plugins.find(p => p.pluginId === 'scheduler');
  if (schedulerPlugin?.enabled) return { ok: true };
  return { ok: false, pipelineId, error: "pipeline_plugin_disabled", plugin: "scheduler" };
};

export const createSchedulerService = (app: PipelineRegistry): SchedulerService => {
  const toggleScheduler = (pipelineId: string, enabled: boolean): SchedulerToggleResult => {
    const runtime = getRuntimeByPipelineId(app, pipelineId);
    if (!runtime) return { ok: false, pipelineId, error: "pipeline_not_found" };

    const pluginState = ensureSchedulerPluginEnabled(runtime, pipelineId);
    if (!pluginState.ok) return pluginState;

    runtime.pipeline.setSchedulerEnabled(enabled);
    return { ok: true, pipelineId, scheduler: runtime.pipeline.getSchedulerState() };
  };

  const setSchedulerMode = (pipelineId: string, mode: SchedulerMode): SchedulerModeResult => {
    const runtime = getRuntimeByPipelineId(app, pipelineId);
    if (!runtime) return { ok: false, pipelineId, error: "pipeline_not_found" };

    const pluginState = ensureSchedulerPluginEnabled(runtime, pipelineId);
    if (!pluginState.ok) return pluginState;

    runtime.pipeline.setSchedulerMode(mode);
    return { ok: true, pipelineId, scheduler: runtime.pipeline.getSchedulerState() };
  };

  return {
    toggleScheduler,
    setSchedulerMode,
  };
};

