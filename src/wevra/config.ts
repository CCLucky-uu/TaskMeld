import type { LLMConfig, ThinkingConfig, ProviderProfile, RuntimeModelConfig, ModelsJson, ModelProfile } from './types'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { resolveTaskMeldDataPath } from '../app/data-dir'

// ── Data dir — reuse global path rules ──

function getDataDir(): string {
  return resolveTaskMeldDataPath('wevra')
}

// ── Built-in provider library ──

const BUILTIN_PROVIDERS: Record<string, ProviderProfile> = {
  deepseek: {
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    api: 'openai-completions',
    models: [
      {
        id: 'deepseek-v4-flash',
        name: 'DeepSeek V4 Flash',
        contextWindow: 1_000_000,
        maxTokens: 384_000,
        reasoning: true,
        compat: {
          supportsReasoningEffort: true,
          supportsUsageInStreaming: true,
          maxTokensField: 'max_tokens',
          requiresReasoningContentPassthrough: true,
          temperatureIgnoredInThinking: true,
          extraBodyThinkingToggle: true,
        },
      },
      {
        id: 'deepseek-v4-pro',
        name: 'DeepSeek V4 Pro',
        contextWindow: 1_000_000,
        maxTokens: 384_000,
        reasoning: true,
        compat: {
          supportsReasoningEffort: true,
          supportsUsageInStreaming: true,
          maxTokensField: 'max_tokens',
          requiresReasoningContentPassthrough: true,
          temperatureIgnoredInThinking: true,
          extraBodyThinkingToggle: true,
        },
      },
    ],
  },
  openai: {
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com',
    api: 'openai-completions',
    models: [
      {
        id: 'gpt-5.4-mini',
        name: 'GPT-5.4 Mini',
        contextWindow: 400_000,
        maxTokens: 128_000,
        reasoning: true,
        compat: {
          supportsReasoningEffort: true,
          supportsUsageInStreaming: true,
          maxTokensField: 'max_completion_tokens',
          requiresReasoningContentPassthrough: false,
          temperatureIgnoredInThinking: false,
          extraBodyThinkingToggle: false,
        },
      },
      {
        id: 'gpt-5.4',
        name: 'GPT-5.4',
        contextWindow: 1_000_000,
        maxTokens: 128_000,
        reasoning: true,
        compat: {
          supportsReasoningEffort: true,
          supportsUsageInStreaming: true,
          maxTokensField: 'max_completion_tokens',
          requiresReasoningContentPassthrough: false,
          temperatureIgnoredInThinking: false,
          extraBodyThinkingToggle: false,
        },
      },
      {
        id: 'gpt-5.5',
        name: 'GPT-5.5',
        contextWindow: 1_000_000,
        maxTokens: 128_000,
        reasoning: true,
        compat: {
          supportsReasoningEffort: true,
          supportsUsageInStreaming: true,
          maxTokensField: 'max_completion_tokens',
          requiresReasoningContentPassthrough: false,
          temperatureIgnoredInThinking: false,
          extraBodyThinkingToggle: false,
        },
      },
    ],
  },
  xiaomi: {
    name: 'Xiaomi MiMo',
    baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1',
    api: 'openai-completions',
    models: [
      {
        id: 'mimo-v2.5',
        name: 'MiMo V2.5',
        contextWindow: 1_048_576,
        maxTokens: 32_000,
        reasoning: true,
        compat: {
          supportsReasoningEffort: true,
          supportsUsageInStreaming: true,
          maxTokensField: 'max_tokens',
          requiresReasoningContentPassthrough: false,
          temperatureIgnoredInThinking: false,
          extraBodyThinkingToggle: false,
        },
      },
      {
        id: 'mimo-v2.5-pro',
        name: 'MiMo V2.5 Pro',
        contextWindow: 1_048_576,
        maxTokens: 32_000,
        reasoning: true,
        compat: {
          supportsReasoningEffort: true,
          supportsUsageInStreaming: true,
          maxTokensField: 'max_tokens',
          requiresReasoningContentPassthrough: false,
          temperatureIgnoredInThinking: false,
          extraBodyThinkingToggle: false,
        },
      },
      {
        id: 'mimo-v2-flash',
        name: 'MiMo V2 Flash',
        contextWindow: 262_144,
        maxTokens: 8_192,
        reasoning: false,
        compat: {
          supportsReasoningEffort: false,
          supportsUsageInStreaming: true,
          maxTokensField: 'max_tokens',
          requiresReasoningContentPassthrough: false,
          temperatureIgnoredInThinking: false,
          extraBodyThinkingToggle: false,
        },
      },
      {
        id: 'mimo-v2-pro',
        name: 'MiMo V2 Pro',
        contextWindow: 1_048_576,
        maxTokens: 32_000,
        reasoning: true,
        compat: {
          supportsReasoningEffort: true,
          supportsUsageInStreaming: true,
          maxTokensField: 'max_tokens',
          requiresReasoningContentPassthrough: false,
          temperatureIgnoredInThinking: false,
          extraBodyThinkingToggle: false,
        },
      },
      {
        id: 'mimo-v2-omni',
        name: 'MiMo V2 Omni',
        contextWindow: 262_144,
        maxTokens: 32_000,
        reasoning: true,
        compat: {
          supportsReasoningEffort: true,
          supportsUsageInStreaming: true,
          maxTokensField: 'max_tokens',
          requiresReasoningContentPassthrough: false,
          temperatureIgnoredInThinking: false,
          extraBodyThinkingToggle: false,
        },
      },
    ],
  },
}

// ── WevraConfig ──

export interface PermissionRule {
  toolPattern: string
  action: 'allow' | 'deny' | 'confirm'
}

export interface WevraConfig {
  llm: LLMConfig
  permissions: 'default' | 'permissive' | 'strict' | 'bypass'
  permissionRules?: PermissionRule[]
  maxIterations: number
  toolTimeoutMs: number
  llmTimeoutMs: number
  maxToolOutputChars: number
  memoryDir: string
  dataDir: string
}

// ── Load config ──

export function loadConfig(overrides?: Partial<WevraConfig>): WevraConfig {
  const dataDir = getDataDir()

  return {
    llm: {
      baseURL: process.env.WEVRA_LLM_BASE_URL ?? 'https://api.openai.com/v1',
      apiKey: process.env.WEVRA_LLM_API_KEY ?? '',
      model: process.env.WEVRA_LLM_MODEL ?? '',
      maxTokens: 8192,
      temperature: 1,
      thinking: {
        level: (process.env.WEVRA_THINKING_LEVEL as ThinkingConfig['level']) ?? 'high',
      },
    },
    permissions: 'default',
    maxIterations: 25,
    toolTimeoutMs: 30_000,
    llmTimeoutMs: 120_000,
    maxToolOutputChars: 30_000,
    memoryDir: join(dataDir, 'memory'),
    dataDir,
    ...overrides,
  }
}

// ── Model management ──

let _modelsCache: { models: RuntimeModelConfig[]; defaultModel: string } | null = null

export function getAvailableModels(): RuntimeModelConfig[] {
  return loadModels().models
}

export function getDefaultModelId(): string {
  return loadModels().defaultModel
}

export function resolveModel(providerId: string, modelId: string): RuntimeModelConfig | null {
  const { models } = loadModels()
  const key = `${providerId}/${modelId}`

  const found = models.find(m => `${m.providerId}/${m.modelId}` === key)
  if (found) return found

  // Not in enabledModels
  return null
}

export function invalidateModelsCache(): void {
  _modelsCache = null
}

export type PublicRuntimeModelConfig = Omit<RuntimeModelConfig, 'apiKey'>

export function getAvailableModelsPublic(): PublicRuntimeModelConfig[] {
  return loadModels().models.map(({ apiKey: _, ...rest }) => rest)
}

function loadModels(): { models: RuntimeModelConfig[]; defaultModel: string } {
  if (_modelsCache) return _modelsCache

  const dataDir = getDataDir()
  const modelsJsonPath = join(dataDir, 'models.json')

  // Load models.json
  let userConfig: ModelsJson | null = null
  if (existsSync(modelsJsonPath)) {
    try {
      userConfig = JSON.parse(readFileSync(modelsJsonPath, 'utf-8'))
    } catch {
      console.warn('[wevra] Failed to parse models.json')
    }
  }

  // Merge provider data sources: built-in + user config
  const providerMap = new Map<string, {
    baseUrl: string
    api: string
    apiKey: string
    models: typeof BUILTIN_PROVIDERS[string]['models']
  }>()

  // Built-in providers
  for (const [id, p] of Object.entries(BUILTIN_PROVIDERS)) {
    providerMap.set(id, {
      baseUrl: p.baseUrl,
      api: p.api,
      apiKey: '',
      models: p.models,
    })
  }

  // User config overrides
  if (userConfig?.providers) {
    for (const [id, p] of Object.entries(userConfig.providers)) {
      if (providerMap.has(id)) {
        const existing = providerMap.get(id)!
        if (p.baseUrl) existing.baseUrl = p.baseUrl
        if (p.apiKey) existing.apiKey = p.apiKey
        // Model list: user config fully replaces
        if (p.models?.length) {
          existing.models = p.models.map(m => ({
            id: m.id,
            name: m.name,
            contextWindow: m.contextWindow,
            maxTokens: m.maxTokens,
            reasoning: m.reasoning ?? false,
            compat: m.compat ?? BUILTIN_PROVIDERS[id]?.models.find(bm => bm.id === m.id)?.compat ?? ({} as any),
          }))
        }
      } else {
        // Custom provider
        providerMap.set(id, {
          baseUrl: p.baseUrl,
          api: p.api ?? 'openai-completions',
          apiKey: p.apiKey,
          models: (p.models ?? []).map(m => ({
            id: m.id,
            name: m.name,
            contextWindow: m.contextWindow,
            maxTokens: m.maxTokens,
            reasoning: m.reasoning ?? false,
            compat: m.compat ?? ({} as any),
          })),
        })
      }
    }
  }

  // Environment variable provider
  const envKey = process.env.WEVRA_LLM_API_KEY
  if (envKey) {
    const envModelId = process.env.WEVRA_LLM_MODEL ?? ''
    const envBaseUrl = process.env.WEVRA_LLM_BASE_URL ?? 'https://api.openai.com/v1'

    // Match model metadata from built-in library
    let envModel = findModelInProviders(envModelId)

    providerMap.set('env', {
      baseUrl: envBaseUrl,
      api: 'openai-completions',
      apiKey: envKey,
      models: envModel ? [envModel] : [{
        id: envModelId,
        name: envModelId,
        contextWindow: 128_000,
        maxTokens: 16_384,
        reasoning: false,
        compat: defaultCompat(),
      }],
    })
  }

  // Build enabledModels list
  const enabledSet: string[] = userConfig?.enabledModels ?? []

  // If enabledModels is empty, enable all built-in models + env by default
  if (enabledSet.length === 0) {
    for (const [providerId, p] of providerMap) {
      for (const m of p.models) {
        enabledSet.push(`${providerId}/${m.id}`)
      }
    }
  }

  // providerMap is declared outside the loop, so handle it outside
  // Build runtime model list
  const runtimeModels: RuntimeModelConfig[] = []
  for (const key of enabledSet) {
    const slashIdx = key.indexOf('/')
    if (slashIdx === -1) continue
    const pId = key.slice(0, slashIdx)
    const mId = key.slice(slashIdx + 1)
    const provider = providerMap.get(pId)
    if (!provider) continue
    const model = provider.models.find(m => m.id === mId)
    if (!model) continue

    runtimeModels.push({
      providerId: pId,
      modelId: model.id,
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      api: provider.api as 'openai-completions',
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
      reasoning: model.reasoning,
      compat: model.compat,
      label: `${BUILTIN_PROVIDERS[pId]?.name ?? pId} · ${model.name}`,
      readonly: pId === 'env',
    })
  }

  // Default model
  const defaultKey = userConfig?.default
    ? `${userConfig.default.provider}/${userConfig.default.model}`
    : envKey
    ? `env/${process.env.WEVRA_LLM_MODEL ?? ''}`
    : ''
  const defaultModel = resolveDefault(enabledSet, defaultKey)

  _modelsCache = { models: runtimeModels, defaultModel }
  return _modelsCache
}

function findModelInProviders(modelId: string): ModelProfile | null {
  for (const p of Object.values(BUILTIN_PROVIDERS)) {
    const found = p.models.find(m => m.id === modelId)
    if (found) return found
  }
  return null
}

function defaultCompat() {
  return {
    supportsReasoningEffort: false,
    supportsUsageInStreaming: true,
    maxTokensField: 'max_tokens' as const,
    requiresReasoningContentPassthrough: false,
    temperatureIgnoredInThinking: false,
    extraBodyThinkingToggle: false,
  }
}

function resolveDefault(enabledModels: string[], defaultId: string): string {
  if (defaultId && enabledModels.includes(defaultId)) return defaultId

  const fallback = enabledModels[0] ?? ''
  if (defaultId && fallback) {
    console.warn(`[wevra] Default model "${defaultId}" is disabled, falling back to "${fallback}"`)
  }
  return fallback
}
