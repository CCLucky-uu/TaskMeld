import type { PipelinePlugin, PluginContext } from "../types"

// Scheduler plugin has no extra config beyond enabled/disabled (handled at PluginInstance level).
// The hooks only run when the instance is enabled, so shouldSchedule always returns true.
// Disabling is done by setting enabled: false on the PluginInstance in workflow.json.

export const schedulerPlugin: PipelinePlugin = {
  id: "scheduler",
  name: "Scheduler",
  type: "scheduler",
  defaultConfig: {},

  hooks: {
    shouldSchedule(_ctx: PluginContext): boolean {
      // If this plugin is enabled, scheduling is allowed.
      // If the PluginInstance.enabled is false, the registry won't even call this hook.
      return true
    },
  },
}
