import type { GatewayClient, GatewayFrame } from "../../gateway"
import {
  inferSessionAgentIds,
  normalizeSession,
  parseAgentSessionMapFromEnv,
  type NormalizedSession,
} from "../../utils/session"
import { pickArray } from "../../utils/array"
import type { NodeRun } from "../runtime-model"
import { createAgentActivityTracker } from "../agent-activity"
import { createToolActivityLogger } from "../tool-activity"

type CreateSessionRegistryOptions = {
  client: GatewayClient
  pushTimeline: (text: string, level?: "info" | "warn" | "error", detail?: unknown) => void
  getKnownExecutorIds: () => Set<string>
}

export const createSessionRegistry = (options: CreateSessionRegistryOptions) => {
  const executorSessionByAgentId = new Map<string, string>()
  let sessionCache: NormalizedSession[] = []
  const envSessionMap = parseAgentSessionMapFromEnv()
  for (const [agentId, sessionId] of Object.entries(envSessionMap)) {
    executorSessionByAgentId.set(agentId, sessionId)
  }

  const inferAgentIdFromSessionId = (sessionId: string): string | null => {
    for (const [agentId, mappedSessionId] of executorSessionByAgentId.entries()) {
      if (mappedSessionId === sessionId) return agentId
    }
    return null
  }

  const agentActivityTracker = createAgentActivityTracker({
    pushTimeline: options.pushTimeline,
    resolveAgentBySessionId: inferAgentIdFromSessionId,
  })
  const toolActivityLogger = createToolActivityLogger({
    pushTimeline: options.pushTimeline,
    resolveAgentBySessionId: inferAgentIdFromSessionId,
  })

  const applySessionBindings = (items: NormalizedSession[]) => {
    const known = options.getKnownExecutorIds()
    for (const item of items) {
      const agentIds = inferSessionAgentIds(item, known)
      for (const agentId of agentIds) {
        if (!executorSessionByAgentId.has(agentId)) {
          executorSessionByAgentId.set(agentId, item.id)
        }
      }
    }
    for (const [agentId, sessionId] of Object.entries(envSessionMap)) {
      executorSessionByAgentId.set(agentId, sessionId)
    }
  }

  const refreshSessionsFromGateway = async () => {
    const payload = await options.client.sendReq("sessions.list")
    const items = pickArray(payload)
      .map((item, index) => normalizeSession(item, index))
      .filter((item): item is NormalizedSession => Boolean(item))
    sessionCache = items
    applySessionBindings(items)
    return { payload, items }
  }

  const resolveExecutorSession = async (node: NodeRun) => {
    const pinnedSessionId = node.executor.sessionId?.trim()
    if (pinnedSessionId) {
      return { sessionId: pinnedSessionId, agentId: node.executor.agentId }
    }

    const primary = executorSessionByAgentId.get(node.executor.agentId)
    if (primary) {
      return { sessionId: primary, agentId: node.executor.agentId }
    }
    if (node.executor.fallbackAgentId) {
      const fallback = executorSessionByAgentId.get(node.executor.fallbackAgentId)
      if (fallback) {
        return { sessionId: fallback, agentId: node.executor.fallbackAgentId }
      }
    }

    await refreshSessionsFromGateway()

    const refreshedPrimary = executorSessionByAgentId.get(node.executor.agentId)
    if (refreshedPrimary) {
      return { sessionId: refreshedPrimary, agentId: node.executor.agentId }
    }
    if (node.executor.fallbackAgentId) {
      const refreshedFallback = executorSessionByAgentId.get(node.executor.fallbackAgentId)
      if (refreshedFallback) {
        return { sessionId: refreshedFallback, agentId: node.executor.fallbackAgentId }
      }
    }
    return null
  }

  const onGatewayFrame = (frame: GatewayFrame) => {
    agentActivityTracker.handleFrame(frame)
    toolActivityLogger.handleFrame(frame)
  }

  return {
    getExecutorSessionByAgentId: () => executorSessionByAgentId,
    getSessionCache: () => sessionCache,
    resolveExecutorSession,
    refreshSessionsFromGateway,
    onGatewayFrame,
    dispose: () => {
      agentActivityTracker.dispose()
    },
  }
}

export type SessionRegistry = ReturnType<typeof createSessionRegistry>
