import type { WsMethodRegistry } from "./types"
import type { WsBroker } from "../ws-broker"
import type { WevraAgent } from "../../wevra"
import type { StreamEvent } from "../../wevra/types"
import { formatError } from "./utils"
import { invalidateModelsCache, getAvailableModelsPublic, THINKING_LEVELS } from "../../wevra/config"
import { saveUserPreferences } from "../../wevra/preferences"

let wevraInstance: WevraAgent | null = null
let brokerInstance: WsBroker | null = null

// confirm 桥：toolCallId → Promise resolve
const confirmPendings = new Map<
  string,
  {
    resolve: (decision: "allow" | "deny" | "always-allow") => void
    reject: (err: Error) => void
    timer: ReturnType<typeof setTimeout>
    toolName: string
  }
>()

function createConfirmCallback(conversationId: string) {
  return (req: {
    toolCallId: string
    toolName: string
    toolArgs: Record<string, unknown>
  }): Promise<"allow" | "deny" | "always-allow"> => {
    return new Promise<"allow" | "deny" | "always-allow">((resolve, reject) => {
      const key = `${conversationId}:${req.toolCallId}`
      const timer = setTimeout(() => {
        confirmPendings.delete(key)
        reject(new Error("confirm_timeout"))
      }, 120_000) // 2 minutes for user to respond
      confirmPendings.set(key, { resolve, reject, timer, toolName: req.toolName })
    })
  }
}

export function initWevraWs(wevra: WevraAgent, broker: WsBroker): void {
  wevraInstance = wevra
  brokerInstance = broker
}

export const registerWevraWsMethods = (registry: WsMethodRegistry): void => {
  // ── 模型 ──

  registry.register("wevra.models", async () => {
    if (!wevraInstance) return { ok: false, error: "wevra_not_initialized" }
    try {
      const models = getAvailableModelsPublic()
      const defaultId = wevraInstance.getDefaultModelId()
      return {
        ok: true,
        payload: {
          models: models.map((m) => ({
            providerId: m.providerId,
            modelId: m.modelId,
            label: m.label ?? m.modelId,
            readonly: m.readonly ?? false,
            contextWindow: m.contextWindow,
          })),
          default: defaultId,
          thinkingLevels: THINKING_LEVELS,
          thinkingLevel: wevraInstance.getThinkingLevel(),
        },
      }
    } catch (error) {
      return { ok: false, error: formatError(error) }
    }
  })

  registry.register("wevra.models.reload", async () => {
    if (!wevraInstance) return { ok: false, error: "wevra_not_initialized" }
    try {
      invalidateModelsCache()
      const models = getAvailableModelsPublic()
      const defaultId = wevraInstance.getDefaultModelId()
      return {
        ok: true,
        payload: {
          models: models.map((m) => ({
            providerId: m.providerId,
            modelId: m.modelId,
            label: m.label ?? m.modelId,
            readonly: m.readonly ?? false,
            contextWindow: m.contextWindow,
          })),
          default: defaultId,
          thinkingLevels: THINKING_LEVELS,
          thinkingLevel: wevraInstance.getThinkingLevel(),
        },
      }
    } catch (error) {
      return { ok: false, error: formatError(error) }
    }
  })

  registry.register("wevra.models.set-thinking-level", async (params) => {
    if (!wevraInstance) return { ok: false, error: "wevra_not_initialized" }
    try {
      const level = typeof params.level === "string" ? params.level.trim() : ""
      if (!level || !(THINKING_LEVELS as readonly string[]).includes(level))
        return { ok: false, error: "invalid_level", message: `Level must be one of: ${THINKING_LEVELS.join(", ")}` }
      const validLevel = level as (typeof THINKING_LEVELS)[number]
      const conversationId = typeof params.conversationId === "string" ? params.conversationId.trim() : ""

      // Persist to conversation if conversationId provided
      if (conversationId) {
        await wevraInstance.conversations.setThinkingLevel(conversationId, validLevel)
      }

      // Apply to agent (sets on current brain + model config)
      wevraInstance.setThinkingLevel(validLevel)
      invalidateModelsCache()
      return { ok: true, payload: { level: validLevel } }
    } catch (error) {
      return { ok: false, error: formatError(error) }
    }
  })

  // ── 对话列表 ──

  registry.register("wevra.conversations.list", async () => {
    if (!wevraInstance) return { ok: false, error: "wevra_not_initialized" }
    try {
      const conversations = wevraInstance.getConversations()
      return { ok: true, payload: { conversations } }
    } catch (error) {
      return { ok: false, error: formatError(error) }
    }
  })

  registry.register("wevra.conversations.view", async (params) => {
    if (!wevraInstance) return { ok: false, error: "wevra_not_initialized" }
    try {
      const id = typeof params.conversationId === "string" ? params.conversationId.trim() : ""
      if (!id) return { ok: false, error: "conversation_id_required" }
      const conv = wevraInstance.getConversations().find((c) => c.id === id)
      return {
        ok: true,
        payload: {
          messages: await wevraInstance.viewConversation(id),
          lastPromptTokens: conv?.lastPromptTokens ?? 0,
          lastCompletionTokens: conv?.lastCompletionTokens ?? 0,
          thinkingLevel: conv?.thinkingLevel ?? wevraInstance.getThinkingLevel(),
          mode: conv?.mode ?? "normal",
        },
      }
    } catch (error) {
      return { ok: false, error: formatError(error) }
    }
  })

  registry.register("wevra.conversations.new", async () => {
    if (!wevraInstance) return { ok: false, error: "wevra_not_initialized" }
    try {
      const conv = await wevraInstance.newConversation()
      return { ok: true, payload: { conversation: conv } }
    } catch (error) {
      return { ok: false, error: formatError(error) }
    }
  })

  registry.register("wevra.conversations.rename", async (params) => {
    if (!wevraInstance) return { ok: false, error: "wevra_not_initialized" }
    try {
      const id = typeof params.conversationId === "string" ? params.conversationId.trim() : ""
      const title = typeof params.title === "string" ? params.title.trim() : ""
      if (!id || !title) return { ok: false, error: "params_required" }
      await wevraInstance.renameConversation(id, title)
      return { ok: true, payload: {} }
    } catch (error) {
      return { ok: false, error: formatError(error) }
    }
  })

  registry.register("wevra.conversations.archive", async (params) => {
    if (!wevraInstance) return { ok: false, error: "wevra_not_initialized" }
    try {
      const id = typeof params.conversationId === "string" ? params.conversationId.trim() : ""
      if (!id) return { ok: false, error: "conversation_id_required" }
      await wevraInstance.conversations.archiveConversation(id)
      return { ok: true, payload: {} }
    } catch (error) {
      return { ok: false, error: formatError(error) }
    }
  })

  registry.register("wevra.conversations.delete", async (params) => {
    if (!wevraInstance) return { ok: false, error: "wevra_not_initialized" }
    try {
      const id = typeof params.conversationId === "string" ? params.conversationId.trim() : ""
      if (!id) return { ok: false, error: "conversation_id_required" }
      await wevraInstance.conversations.deleteConversation(id)
      return { ok: true, payload: {} }
    } catch (error) {
      return { ok: false, error: formatError(error) }
    }
  })

  // ── 聊天 ──

  registry.register("wevra.chat", async (params) => {
    if (!wevraInstance) return { ok: false, error: "wevra_not_initialized" }
    try {
      const message = typeof params.message === "string" ? params.message.trim() : ""
      if (!message) return { ok: false, error: "message_required" }
      const conversationId = typeof params.conversationId === "string" ? params.conversationId.trim() : ""
      if (!conversationId) return { ok: false, error: "conversation_id_required" }
      const providerId = typeof params.provider === "string" ? params.provider.trim() : undefined
      const modelId = typeof params.model === "string" ? params.model.trim() : undefined

      // Insert mode marker if mode changed since last saved marker
      const convMeta = wevraInstance.getConversations().find((c) => c.id === conversationId)
      const currentMode = convMeta?.mode ?? "normal"
      const modeVersion = convMeta?.modeVersion ?? 0
      const messages = await wevraInstance.viewConversation(conversationId)
      let lastSavedMode = ""
      for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i]
        if (m.role === "system") {
          const match = m.content.match(/^\[mode:(\w+):v(\d+)\]$/)
          if (match) {
            lastSavedMode = match[1]
            break
          }
        }
      }
      if (currentMode !== lastSavedMode) {
        await wevraInstance.conversations.appendMessage(conversationId, {
          role: "system",
          content: `[mode:${currentMode}:v${modeVersion}]`,
        })
      }

      const onStream = (event: StreamEvent) => {
        if (!brokerInstance) return
        // Persist token usage to conversation index
        if (event.usage) {
          wevraInstance!.conversations
            .updateTokenUsage(conversationId, event.usage.promptTokens, event.usage.completionTokens)
            .catch(() => {})
        }
        brokerInstance.broadcast({
          type: "event",
          method: "wevra.stream",
          payload: {
            sessionId: conversationId,
            stream: mapStreamType(event.type),
            phase: mapStreamPhase(event.type),
            content: event.content,
            toolCall: event.toolCall,
            toolResult: event.toolResult,
            usage: event.usage,
            error: event.error,
          },
        })
      }
      const onDebug = (dbg: unknown) => {
        if (!brokerInstance) return
        brokerInstance.broadcast({ type: "event", method: "wevra.debug", payload: dbg })
      }
      const onMessage = async (msg: any) => {
        await wevraInstance!.conversations.appendMessage(conversationId, msg)
      }
      const onConfirm = createConfirmCallback(conversationId)

      // Broadcast busy status
      if (brokerInstance) {
        brokerInstance.broadcast({
          type: "event",
          method: "wevra.stream",
          payload: { sessionId: conversationId, stream: "status", phase: "busy" },
        })
      }

      let result
      try {
        result = await wevraInstance.chat(message, conversationId, {
          onStream,
          onDebug,
          onMessage,
          onConfirm,
          providerId,
          modelId,
        })
      } finally {
        // Broadcast idle status (always, even on error/abort)
        if (brokerInstance) {
          brokerInstance.broadcast({
            type: "event",
            method: "wevra.stream",
            payload: { sessionId: conversationId, stream: "status", phase: "idle" },
          })
        }
      }
      return {
        ok: true,
        payload: {
          conversationId,
          content: result.content,
          type: result.type,
          iterations: result.iterations,
          usage: result.usage,
        },
      }
    } catch (error) {
      return { ok: false, error: formatError(error) }
    }
  })

  // ── 聊天中止 ──

  registry.register("wevra.chat.abort", async (params) => {
    if (!wevraInstance) return { ok: false, error: "wevra_not_initialized" }
    try {
      const conversationId = typeof params.conversationId === "string" ? params.conversationId.trim() : ""
      if (!conversationId) return { ok: false, error: "conversation_id_required" }
      const aborted = wevraInstance.abortChat(conversationId)
      return { ok: true, payload: { aborted } }
    } catch (error) {
      return { ok: false, error: formatError(error) }
    }
  })

  // ── 工具权限 ──

  registry.register("wevra.tool-preferences.get", async (params) => {
    if (!wevraInstance) return { ok: false, error: "wevra_not_initialized" }
    try {
      const id = typeof params.conversationId === "string" ? params.conversationId.trim() : ""
      if (!id) return { ok: false, error: "conversation_id_required" }
      const prefs = wevraInstance.getConversationPreferences(id)
      return { ok: true, payload: { preferences: prefs } }
    } catch (error) {
      return { ok: false, error: formatError(error) }
    }
  })

  registry.register("wevra.tool-preferences.set-mode", async (params) => {
    if (!wevraInstance) return { ok: false, error: "wevra_not_initialized" }
    try {
      const id = typeof params.conversationId === "string" ? params.conversationId.trim() : ""
      const mode = typeof params.mode === "string" ? params.mode.trim() : ""
      if (!id || !mode) return { ok: false, error: "params_required" }
      await wevraInstance.conversations.setToolPreference(id, "mode", mode)
      return { ok: true, payload: {} }
    } catch (error) {
      return { ok: false, error: formatError(error) }
    }
  })

  registry.register("wevra.tool-preferences.always-allow", async (params) => {
    if (!wevraInstance) return { ok: false, error: "wevra_not_initialized" }
    try {
      const id = typeof params.conversationId === "string" ? params.conversationId.trim() : ""
      const toolName = typeof params.toolName === "string" ? params.toolName.trim() : ""
      if (!id || !toolName) return { ok: false, error: "params_required" }
      await wevraInstance.conversations.setToolPreference(id, "alwaysAllow", toolName, "add")
      return { ok: true, payload: {} }
    } catch (error) {
      return { ok: false, error: formatError(error) }
    }
  })

  registry.register("wevra.tool-preferences.revoke", async (params) => {
    if (!wevraInstance) return { ok: false, error: "wevra_not_initialized" }
    try {
      const id = typeof params.conversationId === "string" ? params.conversationId.trim() : ""
      const toolName = typeof params.toolName === "string" ? params.toolName.trim() : ""
      if (!id || !toolName) return { ok: false, error: "params_required" }
      await wevraInstance.conversations.setToolPreference(id, "alwaysAllow", toolName, "remove")
      return { ok: true, payload: {} }
    } catch (error) {
      return { ok: false, error: formatError(error) }
    }
  })

  registry.register("wevra.tool-preferences.save-global", async (params) => {
    if (!wevraInstance) return { ok: false, error: "wevra_not_initialized" }
    try {
      const modeStr = typeof params.mode === "string" ? params.mode.trim() : undefined
      const alwaysAllowStr = typeof params.alwaysAllow === "string" ? params.alwaysAllow : undefined
      const alwaysDenyStr = typeof params.alwaysDeny === "string" ? params.alwaysDeny : undefined

      // 从当前对话的合并配置入手，覆盖用户全局
      const prefs = wevraInstance.getConversationPreferences("")
      if (modeStr && (modeStr === "plan" || modeStr === "normal" || modeStr === "auto")) {
        prefs.mode = modeStr
      }
      if (alwaysAllowStr) {
        try {
          prefs.alwaysAllow = JSON.parse(alwaysAllowStr)
        } catch {
          /* ignore */
        }
      }
      if (alwaysDenyStr) {
        try {
          prefs.alwaysDeny = JSON.parse(alwaysDenyStr)
        } catch {
          /* ignore */
        }
      }

      await wevraInstance.saveGlobalPreferences(prefs)
      return { ok: true, payload: {} }
    } catch (error) {
      return { ok: false, error: formatError(error) }
    }
  })

  registry.register("wevra.confirm", async (params) => {
    if (!wevraInstance) return { ok: false, error: "wevra_not_initialized" }
    try {
      const conversationId = typeof params.conversationId === "string" ? params.conversationId.trim() : ""
      const toolCallId = typeof params.toolCallId === "string" ? params.toolCallId.trim() : ""
      const decision = typeof params.decision === "string" ? params.decision.trim() : ""
      if (!conversationId || !toolCallId || !decision) return { ok: false, error: "params_required" }
      if (decision !== "allow" && decision !== "deny" && decision !== "always-allow") {
        return { ok: false, error: "invalid_decision" }
      }

      const key = `${conversationId}:${toolCallId}`
      const pending = confirmPendings.get(key)
      if (!pending) return { ok: false, error: "no_pending_confirmation" }

      clearTimeout(pending.timer)
      confirmPendings.delete(key)
      pending.resolve(decision as "allow" | "deny" | "always-allow")

      // 如果是 always-allow，写入对话级偏好
      if (decision === "always-allow") {
        await wevraInstance.conversations.setToolPreference(conversationId, "alwaysAllow", pending.toolName, "add")
      }

      return { ok: true, payload: {} }
    } catch (error) {
      return { ok: false, error: formatError(error) }
    }
  })

  // ── 状态 ──

  registry.register("wevra.status", async () => {
    if (!wevraInstance) return { ok: false, error: "wevra_not_initialized" }
    try {
      return { ok: true, payload: wevraInstance.getStatus() }
    } catch (error) {
      return { ok: false, error: formatError(error) }
    }
  })
}

function mapStreamType(eventType: StreamEvent["type"]): string {
  if (eventType.startsWith("thinking")) return "thinking"
  if (eventType.startsWith("text")) return "assistant"
  if (eventType.startsWith("tool")) return "tool"
  if (eventType.startsWith("confirm")) return "confirm"
  return "meta"
}
function mapStreamPhase(eventType: StreamEvent["type"]): string {
  if (eventType.endsWith("_start")) return "start"
  if (eventType.endsWith("_delta")) return "delta"
  if (eventType.endsWith("_end")) return "end"
  return eventType
}
