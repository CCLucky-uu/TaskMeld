import type { NodeRun, ArtifactManifest, Run } from "../runtime-model"
import type { ResultEnvelope } from "../structured-output"
import type { RuntimeStore } from "../../app/runtime-store"
import type { StructuredNodeRunner } from "./structured-node-runner"
import type { SessionRegistry } from "./session-registry"
import type { RunAbortController } from "./run-abort-controller"
import type { ExecuteNodeResult } from "./execution-result"
import { markNodeRunning, markNodeSuccess, markNodeFailed } from "../state"
import type { StateTransitionContext } from "../state"
import { extractEnvelopeErrorMessage } from "./reject-handler"

const ctx = (reason: string, extra?: Partial<Omit<StateTransitionContext, "reason">>): StateTransitionContext => ({
  reason,
  ...extra,
})

const extractEnvelopeErrorCode = (error: unknown): string => {
  if (!error || typeof error !== "object") return ""
  const obj = error as Record<string, unknown>
  return typeof obj.code === "string" ? obj.code.trim() : ""
}

const normalizeEnvelopeErrorForDisplay = (error: unknown): { code: string; message: string; display: string } => {
  const code = extractEnvelopeErrorCode(error)
  const message = extractEnvelopeErrorMessage(error)
  const display = message || code || "node_failed"
  return { code, message, display }
}

const classifyNodeFailure = (error: unknown): { reason: string; haltPipeline: boolean } => {
  const message = error instanceof Error ? error.message : String(error)
  const lower = message.toLowerCase()
  if (lower.includes("timeout") || lower.includes("etimedout") || lower.includes("timed out")) {
    return { reason: "network_timeout", haltPipeline: true }
  }
  if (error instanceof TypeError || error instanceof ReferenceError || error instanceof SyntaxError) {
    return { reason: "runtime_exception", haltPipeline: true }
  }
  return { reason: "unknown", haltPipeline: true }
}

type CreateNodeRunnerDeps = {
  runtimeStore: RuntimeStore
  getRun: () => Run
  structuredNodeRunner: StructuredNodeRunner
  sessionRegistry: SessionRegistry
  runAbortController: RunAbortController
  handleNodeReject: (params: {
    node: NodeRun
    envelope: ResultEnvelope
    itemKey?: string
    dependencyIds?: string[]
    nodes: NodeRun[]
    runId: string
    pushTimeline: (text: string, level: "info" | "warn" | "error", detail?: unknown) => void
    artifactDir: string
    pipelineId: string
    getBatchRunId?: () => string | null
    resetAffectedDownstreamNodes: (opts: { targetNodeId: string; itemKey?: string; skipNodeIds?: string[] }) => {
      affectedNodeCount: number
      affectedGroupCount: number
    }
  }) => Promise<void>
  resetAffectedDownstreamNodes: (params: { targetNodeId: string; itemKey?: string; skipNodeIds?: string[] }) => {
    affectedNodeCount: number
    affectedGroupCount: number
  }
  artifactDir: string
  pipelineId: string
  getBatchRunId?: () => string | null
}

export const createNodeRunner = (deps: CreateNodeRunnerDeps) => {
  const handleNodeEnvelopeResult = async (
    node: NodeRun,
    result: { envelope: ResultEnvelope; artifacts: ArtifactManifest[] },
    envelopeError: { code: string; message: string; display: string },
    opts: { itemKey?: string; dependencyIds?: string[] } | undefined,
    effectiveDependencyIds: string[],
    usedAgentId: string,
  ): Promise<{
    succeeded: boolean
    finalStatus: "success" | "failed" | "rejected"
    execError?: string
    haltPipeline: boolean
  }> => {
    const envelopeErrorCode = envelopeError.code
    let succeeded = false
    let finalStatus: "success" | "failed" | "rejected" = "failed"
    let execError: string | undefined
    let haltPipeline = true

    if (result.envelope.status === "success") {
      markNodeSuccess(node, ctx("exec_done", { artifacts: result.artifacts }))
      finalStatus = "success"
      haltPipeline = false
      node.rejectCount = 0
      node.rejectFeedbacks = []
      succeeded = true
      deps.runtimeStore.pushTimeline(`Node executed (structured): ${node.id} <- ${usedAgentId}`)
    } else if (envelopeErrorCode === "upstream_reject" && node.allowReject) {
      node.artifacts = []
      await deps.handleNodeReject({
        node,
        envelope: result.envelope,
        itemKey: opts?.itemKey,
        dependencyIds: effectiveDependencyIds,
        nodes: deps.getRun().nodes,
        runId: deps.getRun().id,
        pushTimeline: deps.runtimeStore.pushTimeline,
        artifactDir: deps.artifactDir,
        pipelineId: deps.pipelineId,
        getBatchRunId: deps.getBatchRunId,
        resetAffectedDownstreamNodes: deps.resetAffectedDownstreamNodes,
      })
      finalStatus = "rejected"
      haltPipeline = false
      execError = node.lastError ?? "upstream_reject"
    } else if (envelopeErrorCode === "upstream_reject" && !node.allowReject) {
      const rejectNotAllowedError = JSON.stringify({
        code: "upstream_reject_not_allowed",
        message: "node_allowReject_false",
        originalError: result.envelope.error ?? null,
      })
      markNodeFailed(node, ctx("upstream_reject_not_allowed", { error: rejectNotAllowedError }))
      finalStatus = "failed"
      node.artifacts = result.artifacts
      execError = "upstream_reject_not_allowed: node_allowReject_false"
      deps.runtimeStore.pushTimeline(
        `Node execution failed (structured): ${node.id} <- ${usedAgentId} upstream_reject_not_allowed: node_allowReject_false`,
        "error",
      )
    } else {
      const structuredFailError = JSON.stringify(result.envelope.error ?? "node_failed")
      markNodeFailed(node, ctx("node_structured_failed", { error: structuredFailError }))
      finalStatus = "failed"
      haltPipeline = false
      node.artifacts = result.artifacts
      execError = envelopeError.display
      const detailText = envelopeError.message
        ? `${envelopeError.code ? `${envelopeError.code}: ` : ""}${envelopeError.message}`
        : envelopeError.code || "node_failed"
      deps.runtimeStore.pushTimeline(
        `Node execution failed (structured): ${node.id} <- ${usedAgentId} ${detailText}`,
        "error",
      )
    }

    return { succeeded, finalStatus, execError, haltPipeline }
  }

  const executeNode = async (
    node: NodeRun,
    opts?: { itemKey?: string; dependencyIds?: string[] },
  ): Promise<ExecuteNodeResult> => {
    const resolved = await deps.sessionRegistry.resolveExecutorSession(node)
    if (!resolved) {
      deps.runtimeStore.pushTimeline(
        `Node ${node.id} execution failed: executor session not found (${node.executor.agentId})`,
        "error",
      )
      markNodeFailed(node, ctx("executor_session_not_found", { error: "executor_session_not_found" }))
      deps.runtimeStore.emitPipeline()
      return {
        ok: false,
        error: "executor_session_not_found",
        executorAgentId: node.executor.agentId,
        fallbackAgentId: node.executor.fallbackAgentId,
        envelope: null,
      }
    }
    const sessionId = resolved.sessionId
    const usedAgentId = resolved.agentId

    markNodeRunning(node, ctx("exec_start"))
    deps.runtimeStore.pushTimeline(`Node execution triggered: ${node.id} -> ${usedAgentId}`)
    deps.runtimeStore.emitPipeline()

    const effectiveDependencyIds = opts?.dependencyIds?.length
      ? Array.from(new Set(opts.dependencyIds.map((id) => id.trim()).filter(Boolean)))
      : node.dependsOn

    const ac = new AbortController()
    const runId = deps.getRun().id
    const entry = deps.runAbortController.registerController(runId, ac, sessionId)

    try {
      const result = await deps.structuredNodeRunner.runNodeViaStructuredOutput(
        node,
        sessionId,
        opts?.itemKey,
        effectiveDependencyIds,
        ac.signal,
      )
      const envelopeError = normalizeEnvelopeErrorForDisplay(result.envelope.error)
      const outcome = await handleNodeEnvelopeResult(
        node,
        result,
        envelopeError,
        opts,
        effectiveDependencyIds,
        usedAgentId,
      )
      deps.runtimeStore.emitPipeline()
      return {
        ok: outcome.succeeded,
        ...(outcome.succeeded ? {} : { error: outcome.execError ?? "node_not_success" }),
        haltPipeline: outcome.haltPipeline,
        usedAgentId,
        usedSessionId: sessionId,
        finalStatus: outcome.finalStatus,
        envelope: result.envelope,
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error)
      const isAborted = errMsg === "aborted"
      const classification = isAborted ? { reason: "pipeline_aborted", haltPipeline: true } : classifyNodeFailure(error)
      // When the user aborts, the node is already marked as stopped — should not be overwritten to failed
      if (!isAborted) {
        markNodeFailed(node, ctx(classification.reason, { error: String(error) }))
      }
      deps.runtimeStore.pushTimeline(
        `Node execution interrupted (structured): ${node.id} <- ${usedAgentId} ${String(error)}`,
        "warn",
      )
      deps.runtimeStore.emitPipeline()
      return {
        ok: false,
        error: String(error),
        haltPipeline: classification.haltPipeline,
        usedAgentId,
        usedSessionId: sessionId,
        finalStatus: isAborted ? "stopped" : "failed",
        envelope: null,
      }
    } finally {
      deps.runAbortController.unregisterController(runId, entry)
    }
  }

  return { executeNode, handleNodeEnvelopeResult }
}

export type NodeRunner = ReturnType<typeof createNodeRunner>
