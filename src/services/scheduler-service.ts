import type { PipelineRegistry } from "../app/pipeline-registry"

type PipelineRuntime = NonNullable<ReturnType<PipelineRegistry["getPipelineRuntime"]>>

export type SchedulerMode = "auto" | "manual"

export type SchedulerToggleResult =
  | {
      ok: true
      pipelineId: string
      scheduler: ReturnType<PipelineRuntime["pipeline"]["getSchedulerState"]>
    }
  | {
      ok: false
      pipelineId: string
      error: "pipeline_not_found" | "pipeline_plugin_disabled"
      plugin?: "scheduler"
    }

export type SchedulerModeResult = SchedulerToggleResult

export type SchedulerService = {
  toggleScheduler: (pipelineId: string, enabled: boolean) => Promise<SchedulerToggleResult>
  setSchedulerMode: (pipelineId: string, mode: SchedulerMode) => Promise<SchedulerModeResult>
}

const getRuntimeByPipelineId = (app: PipelineRegistry, pipelineId: string): PipelineRuntime | null =>
  app.getPipelineRuntime(pipelineId)

const ensureSchedulerPluginEnabled = (
  runtime: PipelineRuntime,
  pipelineId: string,
): { ok: true } | { ok: false; pipelineId: string; error: "pipeline_plugin_disabled"; plugin: "scheduler" } => {
  const workflow = runtime.workflow.getWorkflow()
  const schedulerPlugin = workflow.plugins.find((p) => p.pluginId === "scheduler")
  if (schedulerPlugin?.enabled) return { ok: true }
  return { ok: false, pipelineId, error: "pipeline_plugin_disabled", plugin: "scheduler" }
}

export const createSchedulerService = (app: PipelineRegistry): SchedulerService => {
  const toggleScheduler = async (pipelineId: string, enabled: boolean): Promise<SchedulerToggleResult> => {
    const runtime = getRuntimeByPipelineId(app, pipelineId)
    if (!runtime) return { ok: false, pipelineId, error: "pipeline_not_found" }

    const pluginState = ensureSchedulerPluginEnabled(runtime, pipelineId)
    if (!pluginState.ok) return pluginState

    const workflow = runtime.workflow.getWorkflow()
    const nextWorkflow = { ...workflow, scheduler: { ...workflow.scheduler, enabled } }
    await runtime.workflow.setWorkflow(nextWorkflow)
    return { ok: true, pipelineId, scheduler: { enabled, mode: nextWorkflow.scheduler.mode } }
  }

  const setSchedulerMode = async (pipelineId: string, mode: SchedulerMode): Promise<SchedulerModeResult> => {
    const runtime = getRuntimeByPipelineId(app, pipelineId)
    if (!runtime) return { ok: false, pipelineId, error: "pipeline_not_found" }

    const pluginState = ensureSchedulerPluginEnabled(runtime, pipelineId)
    if (!pluginState.ok) return pluginState

    const workflow = runtime.workflow.getWorkflow()
    const nextWorkflow = { ...workflow, scheduler: { ...workflow.scheduler, mode } }
    await runtime.workflow.setWorkflow(nextWorkflow)
    return { ok: true, pipelineId, scheduler: { enabled: nextWorkflow.scheduler.enabled, mode } }
  }

  return {
    toggleScheduler,
    setSchedulerMode,
  }
}
