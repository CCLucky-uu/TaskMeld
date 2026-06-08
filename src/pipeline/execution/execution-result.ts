import type { ResultEnvelope } from "../structured-output"

export type ExecuteNodeResult = {
  ok: boolean
  error?: string
  haltPipeline?: boolean
  usedAgentId?: string
  usedSessionId?: string
  executorAgentId?: string
  fallbackAgentId?: string | null
  finalStatus?: "success" | "failed" | "rejected" | "stopped"
  envelope?: ResultEnvelope | null
}

export type ExecuteGroupResult = {
  ok: boolean
  error?: string
  haltPipeline?: boolean
  finalStatus: "success" | "failed"
}
