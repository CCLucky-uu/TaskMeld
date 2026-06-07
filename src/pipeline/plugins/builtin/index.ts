import { PluginRegistry } from "../registry"
import { remoteBatchPlugin } from "./remote-batch"
import { schedulerPlugin } from "./scheduler"

export function createBuiltinPluginRegistry(): PluginRegistry {
  const registry = new PluginRegistry()
  registry.register(remoteBatchPlugin)
  registry.register(schedulerPlugin)
  return registry
}
