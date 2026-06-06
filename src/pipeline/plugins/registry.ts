import type {
  PipelinePlugin,
  PluginInstance,
  PluginType,
  PluginContext,
  BatchPluginContext,
  NodePluginContext,
} from './types'

export class PluginRegistry {
  private plugins = new Map<string, PipelinePlugin<any>>()

  register<TConfig = Record<string, unknown>>(plugin: PipelinePlugin<TConfig>): void {
    this.plugins.set(plugin.id, plugin as PipelinePlugin<any>)
  }

  get(pluginId: string): PipelinePlugin | undefined {
    return this.plugins.get(pluginId)
  }

  list(): PipelinePlugin[] {
    return Array.from(this.plugins.values())
  }

  /**
   * Get enabled plugin instances for a pipeline's workflow plugins config.
   * Optionally filter by plugin type.
   */
  getEnabled(instances: PluginInstance[], type?: PluginType): Array<{ plugin: PipelinePlugin; config: Record<string, unknown> }> {
    return instances
      .filter(inst => inst.enabled)
      .map(inst => {
        const plugin = this.plugins.get(inst.pluginId)
        if (!plugin) return null
        if (type && plugin.type !== type) return null
        return { plugin, config: { ...plugin.defaultConfig, ...inst.config } }
      })
      .filter((x): x is { plugin: PipelinePlugin; config: Record<string, unknown> } => x !== null)
  }

  /**
   * Find the first enabled dataSource plugin and call fetchItems.
   * Returns null if no dataSource plugin is enabled.
   */
  async fetchItems(pipelineId: string, instances: PluginInstance[]): Promise<string[] | null> {
    const sources = this.getEnabled(instances, 'dataSource')
    for (const { plugin, config } of sources) {
      if (plugin.hooks?.fetchItems) {
        const ctx: PluginContext = { pipelineId, pluginId: plugin.id, config, enabled: true }
        return await plugin.hooks.fetchItems(ctx)
      }
    }
    return null
  }

  /**
   * Check if scheduling should proceed for a pipeline.
   * Returns true if no scheduler plugin blocks it.
   */
  shouldSchedule(pipelineId: string, instances: PluginInstance[]): boolean {
    const schedulers = this.getEnabled(instances, 'scheduler')
    for (const { plugin, config } of schedulers) {
      if (plugin.hooks?.shouldSchedule) {
        const ctx: PluginContext = { pipelineId, pluginId: plugin.id, config, enabled: true }
        if (!plugin.hooks.shouldSchedule(ctx)) return false
      }
    }
    return true
  }

  /**
   * Emit a lifecycle hook to all enabled plugins that implement it.
   */
  async emit(hookName: keyof NonNullable<PipelinePlugin['hooks']>, instances: PluginInstance[], ctx: PluginContext): Promise<void> {
    const enabled = this.getEnabled(instances)
    for (const { plugin } of enabled) {
      const hook = plugin.hooks?.[hookName] as ((ctx: any) => void | Promise<void>) | undefined
      if (hook) {
        try {
          await hook(ctx)
        } catch (err) {
          console.error(`[plugin:${plugin.id}] hook ${hookName} error:`, err)
        }
      }
    }
  }

  /**
   * Emit a batch hook with batch-specific context.
   */
  async emitBatch(hookName: 'onBatchStart' | 'onBatchComplete', instances: PluginInstance[], ctx: BatchPluginContext): Promise<void> {
    const enabled = this.getEnabled(instances)
    for (const { plugin } of enabled) {
      const hook = plugin.hooks?.[hookName] as ((ctx: any) => void | Promise<void>) | undefined
      if (hook) {
        try {
          await hook(ctx)
        } catch (err) {
          console.error(`[plugin:${plugin.id}] hook ${hookName} error:`, err)
        }
      }
    }
  }

  /**
   * Emit a node hook.
   */
  async emitNode(hookName: 'onNodeAfterRun', instances: PluginInstance[], ctx: NodePluginContext): Promise<void> {
    const enabled = this.getEnabled(instances)
    for (const { plugin } of enabled) {
      const hook = plugin.hooks?.[hookName] as ((ctx: any) => void | Promise<void>) | undefined
      if (hook) {
        try {
          await hook(ctx)
        } catch (err) {
          console.error(`[plugin:${plugin.id}] hook ${hookName} error:`, err)
        }
      }
    }
  }
}
