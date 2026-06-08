import type { GatewayClient } from "../../gateway"

export const createRunAbortController = () => {
  const nodeExecutionControllers = new Map<string, Set<{ ac: AbortController; sessionId: string }>>()
  const drainControllers = new Map<string, AbortController>()

  const registerController = (runId: string, ac: AbortController, sessionId: string) => {
    let controllers = nodeExecutionControllers.get(runId)
    if (!controllers) {
      controllers = new Set()
      nodeExecutionControllers.set(runId, controllers)
    }
    const entry = { ac, sessionId }
    controllers.add(entry)
    return entry
  }

  const unregisterController = (runId: string, entry: { ac: AbortController; sessionId: string }) => {
    const controllers = nodeExecutionControllers.get(runId)
    if (!controllers) return
    controllers.delete(entry)
    if (controllers.size === 0) {
      nodeExecutionControllers.delete(runId)
    }
    entry.ac.abort()
  }

  /**
   * Abort all node executions for a given pipeline run.
   * 1. Send "/stop" to each active node's remote agent session (fire-and-forget)
   * 2. Trigger local AbortController to interrupt polling/drain loop
   */
  const abortRunControllers = (runId: string, client: GatewayClient) => {
    const controllers = nodeExecutionControllers.get(runId)
    if (controllers) {
      const sessionIds = new Set<string>()
      for (const entry of controllers) {
        entry.ac.abort()
        sessionIds.add(entry.sessionId)
      }
      nodeExecutionControllers.delete(runId)
      for (const sessionId of sessionIds) {
        client.sendReq("chat.send", { sessionKey: sessionId, message: "/stop" }, { sideEffect: true }).catch(() => {
          /* best-effort */
        })
      }
    }
    const dc = drainControllers.get(runId)
    if (dc) {
      dc.abort()
      drainControllers.delete(runId)
    }
  }

  /**
   * Get or create the abort signal for drainPipeline.
   * Each new run creates a new AbortController so stop/retry only interrupt the current run.
   */
  const getOrCreateDrainSignal = (runId: string): AbortSignal => {
    let dc = drainControllers.get(runId)
    if (!dc) {
      dc = new AbortController()
      drainControllers.set(runId, dc)
    }
    return dc.signal
  }

  return { registerController, unregisterController, abortRunControllers, getOrCreateDrainSignal }
}

export type RunAbortController = ReturnType<typeof createRunAbortController>
