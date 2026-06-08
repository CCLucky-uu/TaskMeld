import type { LLMConfig, ThinkingConfig, ProviderProfile, RuntimeModelConfig, ModelsJson, ModelProfile } from "./types"
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { resolveTaskMeldDataPath } from "../app/data-dir"

// ── Data dir — reuse global path rules ──

function getDataDir(): string {
  return resolveTaskMeldDataPath("wevra")
}

// ── Built-in provider library ──

const BUILTIN_PROVIDERS: Record<string, ProviderProfile> = {
  deepseek: {
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    api: "openai-completions",
    models: [
      {
        id: "deepseek-v4-flash",
        name: "DeepSeek V4 Flash",
        contextWindow: 1_000_000,
        maxTokens: 384_000,
        reasoning: true,
        compat: {
          supportsReasoningEffort: true,
          supportsUsageInStreaming: true,
          maxTokensField: "max_tokens",
          requiresReasoningContentPassthrough: true,
          temperatureIgnoredInThinking: true,
          extraBodyThinkingToggle: true,
        },
      },
      {
        id: "deepseek-v4-pro",
        name: "DeepSeek V4 Pro",
        contextWindow: 1_000_000,
        maxTokens: 384_000,
        reasoning: true,
        compat: {
          supportsReasoningEffort: true,
          supportsUsageInStreaming: true,
          maxTokensField: "max_tokens",
          requiresReasoningContentPassthrough: true,
          temperatureIgnoredInThinking: true,
          extraBodyThinkingToggle: true,
        },
      },
    ],
  },
  openai: {
    name: "OpenAI",
    baseUrl: "https://api.openai.com",
    api: "openai-completions",
    models: [
      {
        id: "gpt-5.4-mini",
        name: "GPT-5.4 Mini",
        contextWindow: 400_000,
        maxTokens: 128_000,
        reasoning: true,
        compat: {
          supportsReasoningEffort: true,
          supportsUsageInStreaming: true,
          maxTokensField: "max_completion_tokens",
          requiresReasoningContentPassthrough: false,
          temperatureIgnoredInThinking: false,
          extraBodyThinkingToggle: false,
        },
      },
      {
        id: "gpt-5.4",
        name: "GPT-5.4",
        contextWindow: 1_000_000,
        maxTokens: 128_000,
        reasoning: true,
        compat: {
          supportsReasoningEffort: true,
          supportsUsageInStreaming: true,
          maxTokensField: "max_completion_tokens",
          requiresReasoningContentPassthrough: false,
          temperatureIgnoredInThinking: false,
          extraBodyThinkingToggle: false,
        },
      },
      {
        id: "gpt-5.5",
        name: "GPT-5.5",
        contextWindow: 1_000_000,
        maxTokens: 128_000,
        reasoning: true,
        compat: {
          supportsReasoningEffort: true,
          supportsUsageInStreaming: true,
          maxTokensField: "max_completion_tokens",
          requiresReasoningContentPassthrough: false,
          temperatureIgnoredInThinking: false,
          extraBodyThinkingToggle: false,
        },
      },
    ],
  },
  xiaomi: {
    name: "Xiaomi MiMo",
    baseUrl: "https://token-plan-cn.xiaomimimo.com/v1",
    api: "openai-completions",
    models: [
      {
        id: "mimo-v2.5",
        name: "MiMo V2.5",
        contextWindow: 1_048_576,
        maxTokens: 32_000,
        reasoning: true,
        compat: {
          supportsReasoningEffort: true,
          supportsUsageInStreaming: true,
          maxTokensField: "max_tokens",
          requiresReasoningContentPassthrough: false,
          temperatureIgnoredInThinking: false,
          extraBodyThinkingToggle: false,
        },
      },
      {
        id: "mimo-v2.5-pro",
        name: "MiMo V2.5 Pro",
        contextWindow: 1_048_576,
        maxTokens: 32_000,
        reasoning: true,
        compat: {
          supportsReasoningEffort: true,
          supportsUsageInStreaming: true,
          maxTokensField: "max_tokens",
          requiresReasoningContentPassthrough: false,
          temperatureIgnoredInThinking: false,
          extraBodyThinkingToggle: false,
        },
      },
      {
        id: "mimo-v2-flash",
        name: "MiMo V2 Flash",
        contextWindow: 262_144,
        maxTokens: 8_192,
        reasoning: false,
        compat: {
          supportsReasoningEffort: false,
          supportsUsageInStreaming: true,
          maxTokensField: "max_tokens",
          requiresReasoningContentPassthrough: false,
          temperatureIgnoredInThinking: false,
          extraBodyThinkingToggle: false,
        },
      },
      {
        id: "mimo-v2-pro",
        name: "MiMo V2 Pro",
        contextWindow: 1_048_576,
        maxTokens: 32_000,
        reasoning: true,
        compat: {
          supportsReasoningEffort: true,
          supportsUsageInStreaming: true,
          maxTokensField: "max_tokens",
          requiresReasoningContentPassthrough: false,
          temperatureIgnoredInThinking: false,
          extraBodyThinkingToggle: false,
        },
      },
      {
        id: "mimo-v2-omni",
        name: "MiMo V2 Omni",
        contextWindow: 262_144,
        maxTokens: 32_000,
        reasoning: true,
        compat: {
          supportsReasoningEffort: true,
          supportsUsageInStreaming: true,
          maxTokensField: "max_tokens",
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
  action: "allow" | "deny" | "confirm"
}

export interface WevraConfig {
  llm: LLMConfig
  permissions: "default" | "permissive" | "strict" | "bypass"
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
      baseURL: process.env.WEVRA_LLM_BASE_URL ?? "https://api.openai.com/v1",
      apiKey: process.env.WEVRA_LLM_API_KEY ?? "",
      model: process.env.WEVRA_LLM_MODEL ?? "",
      maxTokens: 8192,
      temperature: 1,
      thinking: {
        level: (process.env.WEVRA_THINKING_LEVEL as ThinkingConfig["level"]) ?? "high",
      },
    },
    permissions: "default",
    maxIterations: 25,
    toolTimeoutMs: 30_000,
    llmTimeoutMs: 120_000,
    maxToolOutputChars: 30_000,
    memoryDir: join(dataDir, "memory"),
    dataDir,
    ...overrides,
  }
}

// ── Model management ──

export const THINKING_LEVELS = ["off", "low", "medium", "high", "max"] as const

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

  const found = models.find((m) => `${m.providerId}/${m.modelId}` === key)
  if (found) return found

  // Not in enabledModels
  return null
}

export function invalidateModelsCache(): void {
  _modelsCache = null
}

export type PublicRuntimeModelConfig = Omit<RuntimeModelConfig, "apiKey">

export function getAvailableModelsPublic(): PublicRuntimeModelConfig[] {
  return loadModels().models.map(({ apiKey: _, ...rest }) => rest)
}

function loadModels(): { models: RuntimeModelConfig[]; defaultModel: string } {
  if (_modelsCache) return _modelsCache

  const dataDir = getDataDir()
  const modelsJsonPath = join(dataDir, "models.json")
  const configThinkingLevel: ThinkingConfig["level"] =
    (process.env.WEVRA_THINKING_LEVEL as ThinkingConfig["level"]) ?? "high"

  // Load models.json
  let userConfig: ModelsJson | null = null
  if (existsSync(modelsJsonPath)) {
    try {
      userConfig = JSON.parse(readFileSync(modelsJsonPath, "utf-8"))
    } catch {
      console.warn("[wevra] Failed to parse models.json")
    }
  }

  // Merge provider data sources: built-in + user config
  const providerMap = new Map<
    string,
    {
      baseUrl: string
      api: string
      apiKey: string
      models: (typeof BUILTIN_PROVIDERS)[string]["models"]
    }
  >()

  // Built-in providers
  for (const [id, p] of Object.entries(BUILTIN_PROVIDERS)) {
    providerMap.set(id, {
      baseUrl: p.baseUrl,
      api: p.api,
      apiKey: "",
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
          existing.models = p.models.map((m) => ({
            id: m.id,
            name: m.name,
            contextWindow: m.contextWindow,
            maxTokens: m.maxTokens,
            reasoning: m.reasoning ?? false,
            compat: m.compat ?? BUILTIN_PROVIDERS[id]?.models.find((bm) => bm.id === m.id)?.compat ?? ({} as any),
          }))
        }
      } else {
        // Custom provider
        providerMap.set(id, {
          baseUrl: p.baseUrl,
          api: p.api ?? "openai-completions",
          apiKey: p.apiKey,
          models: (p.models ?? []).map((m) => ({
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
    const envModelId = process.env.WEVRA_LLM_MODEL ?? ""
    const envBaseUrl = process.env.WEVRA_LLM_BASE_URL ?? "https://api.openai.com/v1"

    // Match model metadata from built-in library
    let envModel = findModelInProviders(envModelId)

    providerMap.set("env", {
      baseUrl: envBaseUrl,
      api: "openai-completions",
      apiKey: envKey,
      models: envModel
        ? [envModel]
        : [
            {
              id: envModelId,
              name: envModelId,
              contextWindow: 128_000,
              maxTokens: 16_384,
              reasoning: false,
              compat: defaultCompat(),
            },
          ],
    })
  }

  // Build enabledModels list
  const enabledSet: string[] = userConfig?.enabledModels ?? []

  // If enabledModels is empty, only enable models from providers that have an API key
  if (enabledSet.length === 0) {
    for (const [providerId, p] of providerMap) {
      if (!p.apiKey) continue // Skip providers without API key
      for (const m of p.models) {
        enabledSet.push(`${providerId}/${m.id}`)
      }
    }
  }

  // providerMap is declared outside the loop, so handle it outside
  // Build runtime model list
  const runtimeModels: RuntimeModelConfig[] = []
  for (const key of enabledSet) {
    const slashIdx = key.indexOf("/")
    if (slashIdx === -1) continue
    const pId = key.slice(0, slashIdx)
    const mId = key.slice(slashIdx + 1)
    const provider = providerMap.get(pId)
    if (!provider) continue
    const model = provider.models.find((m) => m.id === mId)
    if (!model) continue

    runtimeModels.push({
      providerId: pId,
      modelId: model.id,
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      api: provider.api as "openai-completions",
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
      reasoning: model.reasoning,
      compat: model.compat,
      thinking: model.reasoning ? { level: configThinkingLevel } : undefined,
      label: `${BUILTIN_PROVIDERS[pId]?.name ?? pId} · ${model.name}`,
      readonly: pId === "env",
    })
  }

  // Default model
  const defaultKey = userConfig?.default
    ? `${userConfig.default.provider}/${userConfig.default.model}`
    : envKey
      ? `env/${process.env.WEVRA_LLM_MODEL ?? ""}`
      : ""
  const defaultModel = resolveDefault(enabledSet, defaultKey)

  _modelsCache = { models: runtimeModels, defaultModel }
  return _modelsCache
}

function findModelInProviders(modelId: string): ModelProfile | null {
  for (const p of Object.values(BUILTIN_PROVIDERS)) {
    const found = p.models.find((m) => m.id === modelId)
    if (found) return found
  }
  return null
}

function defaultCompat() {
  return {
    supportsReasoningEffort: false,
    supportsUsageInStreaming: true,
    maxTokensField: "max_tokens" as const,
    requiresReasoningContentPassthrough: false,
    temperatureIgnoredInThinking: false,
    extraBodyThinkingToggle: false,
  }
}

function resolveDefault(enabledModels: string[], defaultId: string): string {
  if (defaultId && enabledModels.includes(defaultId)) return defaultId

  const fallback = enabledModels[0] ?? ""
  if (defaultId && fallback) {
    console.warn(`[wevra] Default model "${defaultId}" is disabled, falling back to "${fallback}"`)
  }
  return fallback
}

// ── Models.json persistence ──

function getModelsJsonPath(): string {
  return join(getDataDir(), "models.json")
}

function readModelsJson(): ModelsJson {
  const path = getModelsJsonPath()
  if (!existsSync(path)) return { version: 1, providers: {} }
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as ModelsJson
  } catch {
    return { version: 1, providers: {} }
  }
}

function writeModelsJson(config: ModelsJson): void {
  const path = getModelsJsonPath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(config, null, 2), "utf-8")
  invalidateModelsCache()
}

// ── Provider management ──

export function addProvider(
  providerId: string,
  baseUrl: string,
  apiKey: string,
  models?: Array<{ id: string; name: string; contextWindow?: number; maxTokens?: number }>,
): { ok: true } | { ok: false; error: string } {
  if (!providerId.trim()) return { ok: false, error: "providerId is required" }
  if (!baseUrl.trim()) return { ok: false, error: "baseUrl is required" }
  if (!apiKey.trim()) return { ok: false, error: "apiKey is required" }
  const id = providerId.trim().toLowerCase()
  if (BUILTIN_PROVIDERS[id] && !readModelsJson().providers[id]) {
    // Overriding a built-in provider is allowed (user provides their own API key)
  }
  const config = readModelsJson()
  const providerModels = (models ?? []).map((m) => ({
    id: m.id,
    name: m.name ?? m.id,
    contextWindow: m.contextWindow ?? 128_000,
    maxTokens: m.maxTokens ?? 16_384,
    reasoning: false,
    compat: defaultCompat(),
  }))
  // If no models specified, inherit from built-in provider if it exists
  const finalModels =
    providerModels.length > 0
      ? providerModels
      : (BUILTIN_PROVIDERS[id]?.models ?? [
          {
            id: "default",
            name: "Default",
            contextWindow: 128_000,
            maxTokens: 16_384,
            reasoning: false,
            compat: defaultCompat(),
          },
        ])
  config.providers[id] = {
    baseUrl: baseUrl.trim(),
    api: "openai-completions",
    apiKey: apiKey.trim(),
    models: finalModels,
  }
  // Auto-enable all models from this provider
  if (!config.enabledModels) config.enabledModels = []
  for (const m of finalModels) {
    const key = `${id}/${m.id}`
    if (!config.enabledModels.includes(key)) config.enabledModels.push(key)
  }
  // Auto-set default model if none configured yet
  if (!config.default) {
    config.default = { provider: id, model: finalModels[0].id }
  }
  writeModelsJson(config)
  return { ok: true }
}

export function updateProvider(
  providerId: string,
  patch: { baseUrl?: string; apiKey?: string },
): { ok: true } | { ok: false; error: string } {
  const id = providerId.trim().toLowerCase()
  const config = readModelsJson()
  const provider = config.providers[id]
  if (!provider) return { ok: false, error: `Provider "${id}" not found` }
  if (patch.baseUrl !== undefined) provider.baseUrl = patch.baseUrl.trim()
  if (patch.apiKey !== undefined) provider.apiKey = patch.apiKey.trim()
  writeModelsJson(config)
  return { ok: true }
}

export function removeProvider(providerId: string): { ok: true } | { ok: false; error: string } {
  const id = providerId.trim().toLowerCase()
  const config = readModelsJson()
  if (!config.providers[id]) return { ok: false, error: `Provider "${id}" not found` }
  delete config.providers[id]
  // Remove enabled models from this provider
  if (config.enabledModels) {
    config.enabledModels = config.enabledModels.filter((k) => !k.startsWith(`${id}/`))
  }
  // Clear default if it was from this provider
  if (config.default?.provider === id) {
    config.default = undefined
  }
  writeModelsJson(config)
  return { ok: true }
}

export function setDefaultModel(providerId: string, modelId: string): { ok: true } | { ok: false; error: string } {
  const key = `${providerId}/${modelId}`
  const models = getAvailableModels()
  if (!models.find((m) => `${m.providerId}/${m.modelId}` === key)) {
    return { ok: false, error: `Model "${key}" not found or not enabled` }
  }
  const config = readModelsJson()
  config.default = { provider: providerId, model: modelId }
  writeModelsJson(config)
  return { ok: true }
}

export function enableModel(providerId: string, modelId: string): { ok: true } | { ok: false; error: string } {
  const key = `${providerId}/${modelId}`
  const config = readModelsJson()
  if (!config.enabledModels) config.enabledModels = []
  if (!config.enabledModels.includes(key)) config.enabledModels.push(key)
  writeModelsJson(config)
  return { ok: true }
}

export function disableModel(
  providerId: string,
  modelId: string,
): { ok: true; newDefault?: string } | { ok: false; error: string } {
  const key = `${providerId}/${modelId}`
  const config = readModelsJson()
  if (!config.enabledModels?.includes(key)) return { ok: false, error: `Model "${key}" is not enabled` }
  config.enabledModels = config.enabledModels.filter((k) => k !== key)
  let newDefault: string | undefined
  // Auto-switch default if disabling the current default
  if (config.default?.provider === providerId && config.default?.model === modelId) {
    const next = config.enabledModels[0]
    if (next) {
      const slashIdx = next.indexOf("/")
      config.default = { provider: next.slice(0, slashIdx), model: next.slice(slashIdx + 1) }
      newDefault = next
    } else {
      config.default = undefined
    }
  }
  writeModelsJson(config)
  return { ok: true, newDefault }
}

export function getModelsConfigPublic(): {
  models: Array<{ providerId: string; modelId: string; label: string; contextWindow: number; readonly: boolean; enabled: boolean }>
  default: string
  thinkingLevels: readonly string[]
  providers: Array<{
    id: string
    name: string
    baseUrl: string
    hasApiKey: boolean
    modelCount: number
    readonly: boolean
  }>
} {
  const config = readModelsJson()
  const enabledSet = new Set(config.enabledModels ?? [])

  // Build provider map (built-in + user config)
  const providerMap = new Map<string, { name: string; baseUrl: string; apiKey: string; models: typeof BUILTIN_PROVIDERS[string]["models"]; readonly: boolean }>()
  for (const [id, p] of Object.entries(BUILTIN_PROVIDERS)) {
    providerMap.set(id, { name: p.name, baseUrl: p.baseUrl, apiKey: "", models: p.models, readonly: true })
  }
  for (const [id, p] of Object.entries(config.providers)) {
    const builtin = providerMap.get(id)
    providerMap.set(id, {
      name: builtin?.name ?? id,
      baseUrl: p.baseUrl,
      apiKey: p.apiKey,
      models: p.models.length ? p.models : (builtin?.models ?? []),
      readonly: false,
    })
  }

  // Add env provider if API key present
  if (process.env.WEVRA_LLM_API_KEY) {
    const envModelId = process.env.WEVRA_LLM_MODEL ?? ""
    const envBaseUrl = process.env.WEVRA_LLM_BASE_URL ?? "https://api.openai.com/v1"
    const builtinMatch = findModelInProviders(envModelId)
    providerMap.set("env", {
      name: "Environment",
      baseUrl: envBaseUrl,
      apiKey: process.env.WEVRA_LLM_API_KEY,
      models: builtinMatch
        ? [builtinMatch]
        : [{ id: envModelId, name: envModelId, contextWindow: 128_000, maxTokens: 16_384, reasoning: false, compat: defaultCompat() }],
      readonly: true,
    })
  }

  const models: Array<{ providerId: string; modelId: string; label: string; contextWindow: number; readonly: boolean; enabled: boolean }> = []
  const providers: Array<{ id: string; name: string; baseUrl: string; hasApiKey: boolean; modelCount: number; readonly: boolean }> = []

  for (const [pid, p] of providerMap) {
    providers.push({
      id: pid,
      name: p.name,
      baseUrl: p.baseUrl,
      hasApiKey: Boolean(p.apiKey),
      modelCount: p.models.length,
      readonly: p.readonly,
    })
    for (const m of p.models) {
      const key = `${pid}/${m.id}`
      models.push({
        providerId: pid,
        modelId: m.id,
        label: `${p.name} · ${m.name}`,
        contextWindow: m.contextWindow,
        readonly: pid === "env",
        enabled: enabledSet.has(key),
      })
    }
  }

  return {
    models,
    default: getDefaultModelId(),
    thinkingLevels: THINKING_LEVELS,
    providers,
  }
}
