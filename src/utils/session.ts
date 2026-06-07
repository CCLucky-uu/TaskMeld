import { isRecord } from "./guards"

export const normalizeSession = (value: unknown, _index: number) => {
  const obj = (value ?? {}) as Record<string, unknown>
  const id = String(obj.sessionKey ?? obj.key ?? obj.sessionId ?? obj.id ?? obj.uuid ?? "").trim()
  if (!id) {
    return null
  }
  const title = String(obj.title ?? obj.name ?? obj.label ?? id)
  return { id, title, raw: obj }
}

export type NormalizedSession = NonNullable<ReturnType<typeof normalizeSession>>

export const parseAgentSessionMapFromEnv = (): Record<string, string> => {
  const raw = process.env.OPENCLAW_AGENT_SESSION_MAP
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!isRecord(parsed)) return {}
    const output: Record<string, string> = {}
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof k === "string" && typeof v === "string" && k.trim() && v.trim()) {
        output[k.trim()] = v.trim()
      }
    }
    return output
  } catch {
    return {}
  }
}

export const inferSessionAgentIds = (session: NormalizedSession, knownAgentIds: Set<string>): string[] => {
  const candidates = new Set<string>()
  const raw = session.raw
  const fields = [raw.agentId, raw.agent_id, raw.executorAgentId, raw.ownerAgentId]
  for (const f of fields) {
    if (typeof f === "string" && f.trim()) candidates.add(f.trim())
  }
  if (knownAgentIds.has(session.id)) candidates.add(session.id)
  const bag = `${session.id} ${session.title}`.toLowerCase()
  for (const agentId of knownAgentIds) {
    const needle = agentId.toLowerCase()
    if (bag.includes(needle)) {
      candidates.add(agentId)
    }
  }
  return [...candidates]
}
