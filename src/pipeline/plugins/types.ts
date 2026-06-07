// ── Plugin Type ──

export type PluginType = "dataSource" | "scheduler" | "output" | "monitor"

// ── Plugin Context ──

export interface PluginContext<TConfig = Record<string, unknown>> {
  pipelineId: string
  pluginId: string
  config: TConfig
  enabled: boolean
}

export interface BatchPluginContext<TConfig = Record<string, unknown>> extends PluginContext<TConfig> {
  batchIndex: number
  totalBatches: number
  batchItems: string[]
  totalItems: number
}

export interface NodePluginContext<TConfig = Record<string, unknown>> extends PluginContext<TConfig> {
  nodeId: string
  nodeTitle: string
  itemKey: string
}

// ── Plugin Hooks ──

export interface PluginHooks<TConfig = Record<string, unknown>> {
  // Data source: fetch items for batch run
  fetchItems?(ctx: PluginContext<TConfig>): Promise<string[]>

  // Scheduler: gate auto-drain
  shouldSchedule?(ctx: PluginContext<TConfig>): boolean

  // Lifecycle
  onPipelineStart?(ctx: PluginContext<TConfig>): void | Promise<void>
  onPipelineComplete?(ctx: PluginContext<TConfig>): void | Promise<void>
  onPipelineError?(ctx: PluginContext<TConfig>, error: Error): void | Promise<void>

  // Batch
  onBatchStart?(ctx: BatchPluginContext<TConfig>): void | Promise<void>
  onBatchComplete?(ctx: BatchPluginContext<TConfig>): void | Promise<void>
  onBatchError?(ctx: BatchPluginContext<TConfig>, error: Error): void | Promise<void>

  // Node
  onNodeAfterRun?(ctx: NodePluginContext<TConfig>): void | Promise<void>
}

// ── Plugin Definition ──

export interface PipelinePlugin<TConfig = Record<string, unknown>> {
  id: string
  name: string
  type: PluginType
  defaultConfig: TConfig
  hooks?: PluginHooks<TConfig>
}

// ── Plugin Instance (runtime binding = definition + per-pipeline config) ──

export interface PluginInstance {
  pluginId: string
  enabled: boolean
  config: Record<string, unknown>
}

// ── Workflow plugins field ──

export type WorkflowPlugins = PluginInstance[]
