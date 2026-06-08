import type { WsMethodRegistry } from "./types"
import { asRecord, formatError } from "./utils"

const pickString = (record: Record<string, unknown>, keys: string[]): string | null => {
  for (const key of keys) {
    const raw = record[key]
    if (typeof raw === "string" && raw.trim()) return raw.trim()
  }
  return null
}

type ModelInfo = { model: string | null; modelProvider: string | null; api: string | null }

const readModelInfo = (value: unknown): ModelInfo => {
  const direct = asRecord(value)
  if (!direct) return { model: null, modelProvider: null, api: null }
  const nestedSession = asRecord(direct.session)
  const nestedMeta = asRecord(direct.meta)
  const model =
    pickString(direct, ["model", "modelName"]) ??
    (nestedSession ? pickString(nestedSession, ["model", "modelName"]) : null) ??
    (nestedMeta ? pickString(nestedMeta, ["model", "modelName"]) : null)
  const modelProvider =
    pickString(direct, ["modelProvider", "provider", "model_provider"]) ??
    (nestedSession ? pickString(nestedSession, ["modelProvider", "provider", "model_provider"]) : null) ??
    (nestedMeta ? pickString(nestedMeta, ["modelProvider", "provider", "model_provider"]) : null)
  const api =
    pickString(direct, ["api", "apiType"]) ??
    (nestedSession ? pickString(nestedSession, ["api", "apiType"]) : null) ??
    (nestedMeta ? pickString(nestedMeta, ["api", "apiType"]) : null)
  return { model, modelProvider, api }
}

const mergeModelInfo = (preferred: ModelInfo, fallback: ModelInfo): ModelInfo => ({
  model: preferred.model ?? fallback.model,
  modelProvider: preferred.modelProvider ?? fallback.modelProvider,
  api: preferred.api ?? fallback.api,
})

const firstText = (body: Record<string, unknown>): string | null => {
  const text = body.text ?? body.message ?? body.content ?? body.input
  return typeof text === "string" ? text.trim() : null
}

export const registerSessionWsMethods = (registry: WsMethodRegistry): void => {
  registry.register("session.list", async (_params, ctx) => {
    try {
      const { payload, items } = await ctx.services.refreshSessionsFromGateway()
      return { ok: true, payload: { items, raw: payload } }
    } catch (error) {
      return { ok: false, error: formatError(error) }
    }
  })

  registry.register("session.create", async (params, ctx) => {
    try {
      // Pass through to gateway (first strip type/id that WS frame might add)
      const { sessionId: _sid, type: _t, id: _id, ...body } = params
      const payload = await ctx.services.client.sendReq("sessions.create", body, { sideEffect: true })
      return { ok: true, payload: { item: payload ?? null } }
    } catch (error) {
      return { ok: false, error: formatError(error) }
    }
  })

  registry.register("session.history", async (params, ctx) => {
    try {
      const sessionId = typeof params.sessionId === "string" ? params.sessionId.trim() : ""
      if (!sessionId) return { ok: false, error: "invalid_session_id" }
      const limitRaw = typeof params.limit === "number" ? params.limit : 200
      const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(500, Math.floor(limitRaw)) : 200
      const payload = await ctx.services.client.sendReq("chat.history", { sessionKey: sessionId, limit })
      const raw = (payload ?? {}) as Record<string, unknown>
      const rawItems = Array.isArray(raw.items)
        ? raw.items
        : Array.isArray(raw.messages)
          ? raw.messages
          : Array.isArray(raw.history)
            ? raw.history
            : Array.isArray(payload)
              ? payload
              : []

      const latestAssistant = [...rawItems]
        .reverse()
        .find((item) => String((asRecord(item) ?? {}).role ?? "").toLowerCase() === "assistant")
      const latestModelInfo = readModelInfo(latestAssistant)
      let sessionModelInfo: ModelInfo = { model: null, modelProvider: null, api: null }
      try {
        const { items } = await ctx.services.refreshSessionsFromGateway()
        const matched = items.find((s) => s.id === sessionId)
        sessionModelInfo = readModelInfo(matched?.raw)
      } catch {
        /* silent */
      }
      const mergedInfo = mergeModelInfo(latestModelInfo, sessionModelInfo)
      const items = rawItems.map((item) => {
        const rec = asRecord(item)
        if (!rec) return item
        const role = String(rec.role ?? "").toLowerCase()
        if (role !== "assistant") return item
        const itemModelInfo = mergeModelInfo(readModelInfo(rec), mergedInfo)
        return {
          ...rec,
          model: rec.model ?? itemModelInfo.model,
          modelProvider: rec.modelProvider ?? rec.provider ?? itemModelInfo.modelProvider,
          provider: rec.provider ?? rec.modelProvider ?? itemModelInfo.modelProvider,
          api: rec.api ?? itemModelInfo.api,
        }
      })
      return {
        ok: true,
        payload: {
          items,
          raw: payload,
          limit,
          model: mergedInfo.model,
          modelProvider: mergedInfo.modelProvider,
          api: mergedInfo.api,
        },
      }
    } catch (error) {
      return { ok: false, error: formatError(error) }
    }
  })

  registry.register("session.send", async (params, ctx) => {
    try {
      const sessionId = typeof params.sessionId === "string" ? params.sessionId.trim() : ""
      if (!sessionId) return { ok: false, error: "invalid_session_id" }
      const text = firstText(params)
      const mode = String(params.mode ?? "auto")
      if (!text) return { ok: false, error: "message_required" }

      const attempts: Array<{ method: "chat.send" | "sessions.send"; params: Record<string, unknown> }> = []
      if (mode === "chat") {
        attempts.push({ method: "chat.send", params: { sessionKey: sessionId, message: text } })
      } else if (mode === "sessions") {
        attempts.push({ method: "sessions.send", params: { key: sessionId, message: text } })
      } else {
        attempts.push(
          { method: "chat.send", params: { sessionKey: sessionId, message: text } },
          { method: "sessions.send", params: { key: sessionId, message: text } },
        )
      }

      let lastError: string | null = null
      let finalPayload: unknown = null
      let usedMethod: "chat.send" | "sessions.send" | null = null
      for (const attempt of attempts) {
        try {
          finalPayload = await ctx.services.client.sendReq(attempt.method, attempt.params, { sideEffect: true })
          usedMethod = attempt.method
          break
        } catch (error) {
          lastError = formatError(error)
        }
      }

      if (finalPayload === null) {
        return { ok: false, error: lastError ?? "sessions_send_failed" }
      }

      let sessionModelInfo = readModelInfo(finalPayload)
      try {
        const { items } = await ctx.services.refreshSessionsFromGateway()
        const matched = items.find((s) => s.id === sessionId)
        sessionModelInfo = mergeModelInfo(sessionModelInfo, readModelInfo(matched?.raw))
      } catch {
        /* silent */
      }
      return {
        ok: true,
        payload: {
          item: finalPayload,
          mode,
          usedMethod,
          model: sessionModelInfo.model,
          modelProvider: sessionModelInfo.modelProvider,
          api: sessionModelInfo.api,
        },
      }
    } catch (error) {
      return { ok: false, error: formatError(error) }
    }
  })
}
