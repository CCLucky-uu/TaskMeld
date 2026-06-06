import type { PipelinePlugin, PluginContext } from '../types'

interface RemoteBatchConfig {
  url: string
  batchSize: number
  startBatch: number
  sourceField: string
}

const DEFAULT_CONFIG: RemoteBatchConfig = {
  url: '',
  batchSize: 5,
  startBatch: 1,
  sourceField: 'list30',
}

/**
 * Extract a nested value from an object by dot-path (e.g. "data.keywords").
 */
function extractByPath(obj: unknown, path: string): string[] {
  if (!obj || typeof obj !== 'object') return []
  const parts = path.split('.')
  let current: unknown = obj
  for (const part of parts) {
    if (current && typeof current === 'object' && part in current) {
      current = (current as Record<string, unknown>)[part]
    } else {
      return []
    }
  }
  return Array.isArray(current) ? current.filter((x): x is string => typeof x === 'string') : []
}

/**
 * Fallback: try common key names to extract a keyword/item array from unknown JSON.
 */
function extractKeywordPool(data: unknown): string[] {
  if (!data || typeof data !== 'object') return []
  const obj = data as Record<string, unknown>
  const keys = ['list30', 'list', 'keywords', 'items', 'pool', 'data']
  for (const key of keys) {
    if (Array.isArray(obj[key])) {
      return obj[key].filter((x: unknown): x is string => typeof x === 'string')
    }
  }
  return []
}

export const remoteBatchPlugin: PipelinePlugin<RemoteBatchConfig> = {
  id: 'remote-batch',
  name: 'Remote Batch',
  type: 'dataSource',
  defaultConfig: DEFAULT_CONFIG,

  hooks: {
    async fetchItems(ctx: PluginContext<RemoteBatchConfig>): Promise<string[]> {
      const { url, sourceField } = ctx.config
      if (!url) throw new Error('remote-batch: url is not configured')

      const res = await fetch(url, {
        signal: AbortSignal.timeout(15_000),
        headers: { 'Accept': 'application/json' },
      })
      if (!res.ok) throw new Error(`remote-batch: fetch failed with HTTP ${res.status}`)

      const data = await res.json()

      // Try configured sourceField first
      if (sourceField) {
        const items = extractByPath(data, sourceField)
        if (items.length > 0) return items
      }

      // Fallback to common key patterns
      const fallback = extractKeywordPool(data)
      if (fallback.length > 0) return fallback

      throw new Error(`remote-batch: no items found (sourceField: "${sourceField}")`)
    },

    onBatchStart(ctx) {
      console.log(`[plugin:remote-batch] pipeline=${ctx.pipelineId} batch=${ctx.batchIndex + 1}/${ctx.totalBatches} items=${ctx.batchItems.length}`)
    },

    onBatchComplete(ctx) {
      console.log(`[plugin:remote-batch] pipeline=${ctx.pipelineId} batch=${ctx.batchIndex + 1} complete, total processed: ${ctx.totalItems}`)
    },

    onBatchError(ctx, error) {
      console.error(`[plugin:remote-batch] pipeline=${ctx.pipelineId} batch=${ctx.batchIndex + 1} error:`, error.message)
    },
  },
}
