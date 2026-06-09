import type { StreamEvent, LoopResult, RuntimeModelConfig, ToolPreferences, ThinkingConfig } from "./types"
import { DEFAULT_TOOL_PREFERENCES } from "./types"
import { loadConfig, getAvailableModels, getDefaultModelId, resolveModel, type WevraConfig } from "./config"
import { Brain, type DebugCallback } from "./brain"
import { ToolRegistry } from "./tools/registry"
import { ToolExecutor } from "./tools/executor"
import { ConversationManager, type SessionData, type ConversationMeta } from "./conversation"
import { WevraMemory } from "./memory"
import { SkillRegistry, createSkillRegistry } from "./skills"
import { WevraLoop, type LoopCallbacks } from "./loop/agent-loop"
import { buildGlobalPrompt } from "./loop/prompt-builder"
import { loadUserPreferences, resolvePreferences, saveUserPreferences } from "./preferences"
import type { ReadonlyServices } from "../services/read-services"
import type { PipelineRegistry } from "../app/pipeline-registry"
import type { PluginRegistry } from "../pipeline/plugins/registry"

// Builtin tools
import { createPipelineTools, createPipelinePluginTool, createPipelineNodeTool } from "./tools/builtin/pipeline"
import { createAgentTools } from "./tools/builtin/agent"
import { createArtifactTools } from "./tools/builtin/artifact"
import { createSessionTools } from "./tools/builtin/session"
import { createSystemTools } from "./tools/builtin/system"
import { webTools } from "./tools/builtin/web"
import { createMemoryTools } from "./tools/builtin/memory"
import { createSkillTools } from "./tools/builtin/skill"
import { createQuestionTool } from "./tools/builtin/question"

export class WevraAgent {
  brain: Brain | null
  readonly toolRegistry: ToolRegistry
  readonly toolExecutor: ToolExecutor
  readonly conversations: ConversationManager
  readonly memory: WevraMemory
  readonly skills: SkillRegistry
  loop: WevraLoop
  readonly config: WevraConfig
  private currentModelId: string
  private currentModel: RuntimeModelConfig
  private currentThinkingLevel: ThinkingConfig["level"]
  private userGlobalPrefs: ToolPreferences = { ...DEFAULT_TOOL_PREFERENCES }
  private activeChats = new Map<string, AbortController>()
  private services: ReadonlyServices | null
  private app: PipelineRegistry | null
  private pluginRegistry: PluginRegistry | null

  constructor(
    configOverrides?: Partial<WevraConfig> & { model?: RuntimeModelConfig },
    services?: ReadonlyServices,
    app?: PipelineRegistry,
    pluginRegistry?: PluginRegistry,
  ) {
    this.config = loadConfig(configOverrides)
    this.services = services ?? null
    this.app = app ?? null
    this.pluginRegistry = pluginRegistry ?? null
    this.toolRegistry = new ToolRegistry()
    this.memory = new WevraMemory()
    this.skills = createSkillRegistry()
    this.registerTools()

    const defaultModel =
      configOverrides?.model ??
      resolveModel(getDefaultModelId().split("/")[0] || "", getDefaultModelId().split("/")[1] || "") ??
      null

    if (!defaultModel || !defaultModel.apiKey) {
      this.currentModel = null as unknown as RuntimeModelConfig
      this.currentModelId = ""
      this.currentThinkingLevel = this.config.llm.thinking?.level ?? "high"
      this.brain = null as unknown as Brain
    } else {
      this.currentModel = defaultModel
      this.currentModelId = `${defaultModel.providerId}/${defaultModel.modelId}`
      this.currentThinkingLevel = defaultModel.thinking?.level ?? this.config.llm.thinking?.level ?? "high"
      this.brain = new Brain(defaultModel, this.config.llmTimeoutMs)
    }

    this.conversations = new ConversationManager(
      this.config.dataDir,
      this.toolRegistry,
      {
        buildGlobalPrompt: (scope) =>
          buildGlobalPrompt({
            memories: this.memory.getEntries("global"),
            alwaysSkills: this.skills.getAlwaysActive(),
            skillIndex: this.skills.list(),
            pipelines: [],
            scope,
          }),
      },
      this.currentThinkingLevel,
    )

    this.toolExecutor = new ToolExecutor(this.toolRegistry, this.config)
    this.loop = new WevraLoop(this.brain, this.toolExecutor, this.toolRegistry, this.skills, this.memory, this.config)
  }

  async init(): Promise<void> {
    this.userGlobalPrefs = await loadUserPreferences(this.config.dataDir)
    await this.conversations.loadAll()
  }

  async chat(
    message: string,
    conversationId: string,
    callbacks?: LoopCallbacks & { providerId?: string; modelId?: string },
  ): Promise<LoopResult & { conversationId: string }> {
    const conv = this.conversations.getConversation(conversationId)
    if (!conv) return { type: "error", content: "Conversation not found", iterations: 0, conversationId }

    // Resolve thinking level: per-conversation → global fallback
    const thinkingLevel = conv.thinkingLevel ?? this.currentThinkingLevel

    // Lazy brain init: on first use after models are configured via UI
    if (!this.brain) {
      const pid = callbacks?.providerId
      const mid = callbacks?.modelId
      if (!pid || !mid) return { type: "error", content: "No LLM model configured", iterations: 0, conversationId }
      const model = resolveModel(pid, mid)
      if (!model || !model.apiKey)
        return { type: "error", content: `Model "${pid}/${mid}" not available`, iterations: 0, conversationId }
      if (model.reasoning) model.thinking = { level: thinkingLevel }
      this.currentModel = model
      this.currentModelId = `${model.providerId}/${model.modelId}`
      this.brain = new Brain(model, this.config.llmTimeoutMs)
      this.loop = new WevraLoop(this.brain, this.toolExecutor, this.toolRegistry, this.skills, this.memory, this.config)
    }

    let brain = this.brain
    let loop = this.loop

    if (callbacks?.providerId && callbacks?.modelId) {
      const newModel = resolveModel(callbacks.providerId, callbacks.modelId)
      if (!newModel)
        return {
          type: "error",
          content: `Model "${callbacks.providerId}/${callbacks.modelId}" disabled`,
          iterations: 0,
          conversationId,
        }
      const newModelId = `${newModel.providerId}/${newModel.modelId}`
      if (newModelId !== this.currentModelId) {
        if (newModel.reasoning) newModel.thinking = { level: thinkingLevel }
        this.currentModel = newModel
        this.currentModelId = newModelId
        brain = new Brain(newModel, this.config.llmTimeoutMs)
        this.brain = brain
        loop = new WevraLoop(brain, this.toolExecutor, this.toolRegistry, this.skills, this.memory, this.config)
        this.loop = loop
      }
    }

    // Apply conversation thinking level to active brain
    brain.setThinkingLevel(thinkingLevel)

    const userMsg = { role: "user" as const, content: message, timestamp: Date.now() }
    await this.conversations.appendMessage(conversationId, userMsg)
    const fullHistory = await this.conversations.getFullMessages(conversationId)

    brain.setDebugCallback(callbacks?.onDebug ? (dbg) => callbacks.onDebug!(dbg) : null)

    const prefs = resolvePreferences(conv.toolPreferences, this.userGlobalPrefs)
    console.log(
      `[wevra:prefs] conversationId=${conversationId} convMode=${conv.toolPreferences?.mode ?? "undefined"} globalMode=${this.userGlobalPrefs.mode} resolvedMode=${prefs.mode} thinkingLevel=${thinkingLevel}`,
    )

    const session: SessionData = {
      id: `sess-${conv.id}`,
      conversationId: conv.id,
      frozenPrompt: conv.frozenPrompt,
      frozenTools: this.toolRegistry.toToolDefinitions(),
    }

    // Register as active
    const abortController = new AbortController()
    this.activeChats.set(conversationId, abortController)

    try {
      const result = await loop.run(fullHistory, session, callbacks, prefs, abortController)
      return { ...result, conversationId: conv.id }
    } finally {
      this.activeChats.delete(conversationId)
    }
  }

  async newConversation() {
    return this.conversations.createConversation("global")
  }
  async renameConversation(id: string, title: string) {
    return this.conversations.renameConversation(id, title)
  }

  getConversations() {
    return this.conversations.listConversations()
  }
  async viewConversation(id: string) {
    return this.conversations.viewConversation(id)
  }

  getAvailableModels() {
    return getAvailableModels()
  }
  getDefaultModelId() {
    return getDefaultModelId()
  }

  getThinkingLevel(): ThinkingConfig["level"] {
    return this.currentThinkingLevel
  }

  setThinkingLevel(level: ThinkingConfig["level"]): void {
    this.currentThinkingLevel = level
    if (this.brain) this.brain.setThinkingLevel(level)
    // Update current model config so new Brain instances pick it up
    if (this.currentModel?.reasoning) {
      this.currentModel.thinking = { level }
    }
  }

  getStatus() {
    return {
      conversations: this.conversations.listConversations().length,
      tools: this.toolRegistry.size,
      skills: this.skills.size,
      model: this.currentModelId,
      modelsAvailable: this.brain ? getAvailableModels().length : 0,
      thinkingLevel: this.currentThinkingLevel,
      activeConversations: Array.from(this.activeChats.keys()),
    }
  }

  isConversationBusy(conversationId: string): boolean {
    return this.activeChats.has(conversationId)
  }

  abortChat(conversationId: string): boolean {
    const controller = this.activeChats.get(conversationId)
    if (!controller) return false
    controller.abort()
    return true
  }

  getConversationPreferences(conversationId: string) {
    const conv = this.conversations.getConversation(conversationId)
    return resolvePreferences(conv?.toolPreferences, this.userGlobalPrefs)
  }

  async saveGlobalPreferences(prefs: ToolPreferences): Promise<void> {
    this.userGlobalPrefs = prefs
    await saveUserPreferences(this.config.dataDir, prefs)
  }

  private registerTools() {
    const s = this.services
    for (const tool of [
      ...createPipelineTools(s?.pipeline, this.app, this.pluginRegistry),
      ...createPipelinePluginTool(this.app, this.pluginRegistry),
      ...createPipelineNodeTool(this.app),
      ...createAgentTools(s?.agent, s?.session),
      ...createArtifactTools(s?.artifact),
      ...createSessionTools(s?.session),
      ...createSystemTools(s),
      ...webTools,
      ...createQuestionTool(),
    ])
      this.toolRegistry.register(tool)
    for (const tool of createMemoryTools(this.memory)) this.toolRegistry.register(tool)
    for (const tool of createSkillTools(this.skills)) this.toolRegistry.register(tool)
  }
}
