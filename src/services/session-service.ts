import type { PipelineRegistry } from "../app/pipeline-registry"
import { ensureGatewayReadyForReadonly } from "./gateway-read-helpers"
export type SessionListItem = {
  id: string
  title: string
  raw: Record<string, unknown>
}

export type SessionHistoryItem = {
  role: string
  content: string
  ts: string | null
  raw: Record<string, unknown>
}

export type SessionService = {
  listSessions: (options?: { refresh?: boolean }) => Promise<SessionListItem[]>
  getSessionHistory: (sessionId: string) => Promise<SessionHistoryItem[]>
  sendMessage: (input: SessionSendInput) => Promise<SessionSendResult>
  sendMessageAndWaitForReply: (
    input: SessionSendInput,
    options?: { timeoutMs?: number; onChunk?: (text: string) => void },
  ) => Promise<{ sent: SessionSendResult; reply: { role: string; content: string; ts: string | null } | null }>
}

export type SessionSendMode = "auto" | "chat" | "sessions"

export type SessionSendInput = {
  sessionId: string
  message: string
  mode?: SessionSendMode
}

export type SessionSendResult = {
  sessionId: string
  mode: SessionSendMode
  method: "chat.send" | "sessions.send"
  params: Record<string, unknown>
  payload: unknown
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : null

const firstText = (value: unknown): string => {
  if (typeof value === "string") return value
  if (Array.isArray(value)) {
    for (const item of value) {
      const text = firstText(item)
      if (text) return text
    }
    return ""
  }
  if (!value || typeof value !== "object") return ""
  const obj = value as Record<string, unknown>
  const direct = obj.text ?? obj.content ?? obj.value ?? obj.message
  if (typeof direct === "string") return direct
  for (const key of ["parts", "items", "messages", "data", "result"]) {
    const nested = firstText(obj[key])
    if (nested) return nested
  }
  return ""
}

const toSessionListItems = (
  items: Array<{ id: string; title: string; raw: Record<string, unknown> }>,
): SessionListItem[] =>
  items.map((session) => ({
    id: session.id,
    title: session.title,
    raw: session.raw,
  }))

export const createSessionService = (app: PipelineRegistry): SessionService => {
  const listSessions = async (options?: { refresh?: boolean }): Promise<SessionListItem[]> => {
    await ensureGatewayReadyForReadonly(app)
    const shouldRefresh = options?.refresh ?? true
    if (shouldRefresh) {
      try {
        const refreshed = await app.gateway.refreshSessionsFromGateway()
        return toSessionListItems(refreshed.items)
      } catch {
        // On refresh failure, use cache so the CLI can still read session info during gateway flapping.
      }
    }
    return toSessionListItems(app.gateway.getSessionCache())
  }

  const getSessionHistory = async (sessionId: string): Promise<SessionHistoryItem[]> => {
    await ensureGatewayReadyForReadonly(app)
    const payload = await app.gateway.client.sendReq("chat.history", { sessionKey: sessionId })
    const rawItems = Array.isArray(payload)
      ? payload
      : Array.isArray((payload as { items?: unknown[] } | null)?.items)
        ? ((payload as { items: unknown[] }).items ?? [])
        : app.gateway.pickArray(payload)

    return rawItems.map((item) => {
      const raw = asRecord(item) ?? {}
      const tsCandidate = raw.ts ?? raw.createdAt ?? raw.timestamp ?? null
      return {
        role: String(raw.role ?? raw.author ?? raw.type ?? "unknown"),
        content: firstText(raw.content ?? raw.message ?? raw.text ?? raw),
        ts: typeof tsCandidate === "string" ? tsCandidate : null,
        raw,
      }
    })
  }

  const sendMessage = async (input: SessionSendInput): Promise<SessionSendResult> => {
    await ensureGatewayReadyForReadonly(app)
    const sessionId = input.sessionId.trim()
    const message = input.message.trim()
    const mode: SessionSendMode = input.mode ?? "auto"
    if (!sessionId) {
      throw new Error("invalid_session_id")
    }
    if (!message) {
      throw new Error("message_required")
    }

    const chatAttempts: Array<{ method: "chat.send"; params: Record<string, unknown> }> = [
      { method: "chat.send", params: { sessionKey: sessionId, message } },
    ]
    const sessionsAttempts: Array<{ method: "sessions.send"; params: Record<string, unknown> }> = [
      { method: "sessions.send", params: { key: sessionId, message } },
    ]
    const attempts =
      mode === "chat"
        ? [...chatAttempts]
        : mode === "sessions"
          ? [...sessionsAttempts]
          : [...chatAttempts, ...sessionsAttempts]

    let lastError: unknown = null
    for (const attempt of attempts) {
      try {
        const payload = await app.gateway.client.sendReq(attempt.method, attempt.params, { sideEffect: true })
        return {
          sessionId,
          mode,
          method: attempt.method,
          params: attempt.params,
          payload,
        }
      } catch (error) {
        lastError = error
      }
    }
    throw new Error(String(lastError ?? "sessions_send_failed"))
  }

  const sendMessageAndWaitForReply = async (
    input: SessionSendInput,
    options?: { timeoutMs?: number; onChunk?: (text: string) => void },
  ): Promise<{ sent: SessionSendResult; reply: { role: string; content: string; ts: string | null } | null }> => {
    const sent = await sendMessage(input)
    const sessionId = input.sessionId.trim()
    const timeoutMs = options?.timeoutMs ?? 120_000

    return new Promise((resolve) => {
      let accumulated = ""
      let emittedLength = 0
      let settled = false
      let timer: NodeJS.Timeout | null = null

      const emitIncremental = (full: string) => {
        if (full.length > emittedLength) {
          const delta = full.slice(emittedLength)
          emittedLength = full.length
          options?.onChunk?.(delta)
        }
      }

      const cleanup = () => {
        settled = true
        unsubscribe()
        if (timer) {
          clearTimeout(timer)
          timer = null
        }
      }

      const unsubscribe = app.gateway.client.onEvent((frame) => {
        if (settled) return
        if (frame.type !== "event") return
        if (frame.event !== "agent") return

        const payload = (frame.payload ?? {}) as Record<string, unknown>
        const eventSessionKey = String(payload.sessionKey ?? payload.sessionId ?? payload.key ?? "").trim()
        if (eventSessionKey !== sessionId) return

        const stream = String(payload.stream ?? "").toLowerCase()
        const data = (payload.data ?? {}) as Record<string, unknown>

        // Streaming text fragments (mix of accumulation and incremental; deduplicated with merge)
        if (stream === "assistant") {
          const text = typeof data.text === "string" ? data.text : ""
          if (text) {
            if (!accumulated) {
              accumulated = text
            } else if (text.startsWith(accumulated)) {
              accumulated = text
            } else if (!accumulated.endsWith(text)) {
              accumulated += text
            }
            emitIncremental(accumulated)
          }
          return
        }

        // Compatible with non-stream-prefix direct text
        const role = String(payload.role ?? data.role ?? "").toLowerCase()
        if (role === "assistant") {
          const text = typeof data.text === "string" ? data.text : ""
          if (text) {
            if (!accumulated) {
              accumulated = text
            } else if (text.startsWith(accumulated)) {
              accumulated = text
            } else if (!accumulated.endsWith(text)) {
              accumulated += text
            }
            emitIncremental(accumulated)
          }
        }

        // Lifecycle end
        if (stream === "lifecycle") {
          const phase = String(data.phase ?? "").toLowerCase()
          if (phase === "end" || phase === "done") {
            cleanup()
            resolve({
              sent,
              reply: accumulated.trim()
                ? { role: "assistant", content: accumulated.trim(), ts: new Date().toISOString() }
                : null,
            })
          }
        }
      })

      // Timeout safety net
      timer = setTimeout(() => {
        if (settled) return
        cleanup()
        // On timeout, try to backfill from history once
        void getSessionHistory(sessionId)
          .then((history) => {
            const items = Array.isArray(history) ? history : []
            const lastAssistant = [...items].reverse().find((item) => {
              const r = String(item.role ?? "").toLowerCase()
              return r === "assistant" || r === "bot"
            })
            const content = lastAssistant ? String(lastAssistant.content ?? "") : accumulated.trim()
            resolve({
              sent,
              reply: content ? { role: "assistant", content, ts: null } : null,
            })
          })
          .catch(() => {
            resolve({
              sent,
              reply: accumulated.trim() ? { role: "assistant", content: accumulated.trim(), ts: null } : null,
            })
          })
      }, timeoutMs)
    })
  }

  return {
    listSessions,
    getSessionHistory,
    sendMessage,
    sendMessageAndWaitForReply,
  }
}
