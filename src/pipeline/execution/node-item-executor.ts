import type { NodeItemRun, NodeRun } from "../runtime-model"
import type { WorkflowGraph } from "../workflow-graph"
import type { RuntimeStore } from "../../app/runtime-store"
import type { StateTransitionContext } from "../state"
import { markItemRunning, markItemSuccess, markItemFailed, markItemRejected, markItemSkipped } from "../state"
import type { ResultEnvelope } from "../structured-output"
import type { RouteItemManager } from "./route-item-manager"
import type { NodeRunner } from "./node-runner"
import type { ExecuteNodeResult } from "./execution-result"

const ctx = (reason: string, extra?: Partial<Omit<StateTransitionContext, "reason">>): StateTransitionContext => ({
  reason,
  ...extra,
})

type NodeItemExecutorDeps = {
  runtimeStore: RuntimeStore
  graph: WorkflowGraph
  nodeRunner: NodeRunner
  routeItemManager: RouteItemManager
  getRun: () => ReturnType<RuntimeStore["getRun"]>
  getNodeById: (nodeId: string) => NodeRun | null
  getEffectiveDependencyIdsForNodeItem: (nodeId: string, itemKey: string) => string[]
}

export const createNodeItemExecutor = (deps: NodeItemExecutorDeps) => {
  const executeNodeItem = async (
    item: NodeItemRun,
    opts?: { suppressOutgoing?: boolean; dependencyIds?: string[] },
  ): Promise<ExecuteNodeResult> => {
    const run = deps.getRun()
    const node = deps.getNodeById(item.nodeId)
    if (!node) {
      markItemFailed(item, ctx("node_not_found", { error: "node_not_found" }))
      return { ok: false, error: "node_not_found", finalStatus: "failed" }
    }
    const workflowNode = deps.graph.getWorkflowNodeById(node.id)
    if (workflowNode?.enabled === false) {
      markItemSkipped(item, ctx("node_disabled"))
      return { ok: true, envelope: null, finalStatus: "success" }
    }
    const maxAttempts = Math.max(1, workflowNode?.retryPolicy.maxAttempts ?? 1)
    if (item.attempt >= maxAttempts) {
      markItemFailed(item, ctx("max_attempts_exceeded", { error: `max_attempts_exceeded:${maxAttempts}` }))
      deps.runtimeStore.pushTimeline(
        `Node item exceeded max retry attempts: ${item.nodeId}#${item.itemKey} (${maxAttempts})`,
        "error",
      )
      deps.runtimeStore.emitPipeline()
      return { ok: false, error: item.lastError ?? undefined, finalStatus: "failed" }
    }
    const retryBackoffMs = workflowNode?.retryPolicy.backoffMs ?? 0
    if (item.attempt > 0 && retryBackoffMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, retryBackoffMs))
    }
    markItemRunning(item, ctx("exec_start"))
    deps.runtimeStore.pushTimeline(`Node item execution triggered: ${item.nodeId}#${item.itemKey}`)
    deps.runtimeStore.emitPipeline()

    const exec = await deps.nodeRunner.executeNode(node, {
      itemKey: item.itemKey,
      dependencyIds: opts?.dependencyIds ?? deps.getEffectiveDependencyIdsForNodeItem(item.nodeId, item.itemKey),
    })
    if (!exec.ok) {
      if (exec.finalStatus === "stopped") {
        // When the user aborts, the node item is already marked as stopped — do not overwrite
      } else if (exec.finalStatus === "rejected") {
        markItemRejected(item, ctx("node_rejected", { error: exec.error ?? null }))
      } else {
        markItemFailed(item, ctx("node_item_failed", { error: exec.error ?? null }))
      }
      item.artifacts = node.artifacts
      await deps.routeItemManager.applyEnvelopeOutcomeToItem(
        item,
        (exec.envelope as ResultEnvelope | null) ?? null,
        opts,
      )
      return exec
    }
    markItemSuccess(item, ctx("exec_done"))
    item.artifacts = node.artifacts
    await deps.routeItemManager.applyEnvelopeOutcomeToItem(item, (exec.envelope as ResultEnvelope | null) ?? null, opts)
    return exec
  }

  return { executeNodeItem }
}

export type NodeItemExecutor = ReturnType<typeof createNodeItemExecutor>
