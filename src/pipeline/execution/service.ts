import type { GatewayClient, GatewayFrame } from "../../gateway";
import {
  type ArtifactManifest,
  type GroupItemRun,
  type NodeItemRun,
  type NodeRun,
} from "../runtime-model";
import type { RuntimeStore } from "../../app/runtime-store";
import type { WorkflowGraph } from "../workflow-graph";
import { createRunStateHelpers } from "./run-state-helpers";
import { createSessionRegistry } from "./session-registry";
import { createRouteItemManager } from "./route-item-manager";
import { createStructuredNodeRunner } from "./structured-node-runner";
import {
  markItemReset,
  markGroupItemReset,
  markGroupReset,
} from "../state";
import type { StateTransitionContext } from "../state";
import { handleNodeReject } from "./reject-handler";
import { createRunAbortController } from "./run-abort-controller";
import { createNodeRunner } from "./node-runner";
import { createGroupItemExecutor } from "./group-item-executor";
import { createNodeItemExecutor } from "./node-item-executor";
export { type ExecuteNodeResult, type ExecuteGroupResult } from "./execution-result";

const ctx = (reason: string, extra?: Partial<Omit<StateTransitionContext, "reason">>): StateTransitionContext => ({ reason, ...extra });

type ExecutionServiceDeps = {
  client: GatewayClient;
  runtimeStore: RuntimeStore;
  graph: WorkflowGraph;
  artifactDir: string;
  pipelineId: string;
  pipelineNodeExecutionTimeoutMs: number;
  defaultItemKeys: string[];
  getBatchRunId?: () => string | null;
};

/**
 * Pipeline executor.
 * Responsible for: specific execution logic of nodes, state transitions, artifact management.
 * Not responsible for: scheduling decisions, concurrency control.
 */
export const createExecutionService = (deps: ExecutionServiceDeps) => {
  let activeBatchKeywordItems: string[] | null = null;

  const runAbortController = createRunAbortController();

  const state = createRunStateHelpers({
    runtimeStore: deps.runtimeStore,
    graph: deps.graph,
    defaultItemKeys: deps.defaultItemKeys,
  });
  const {
    getRun,
    getNodeById,
    getGroupById,
    getItemRun,
    getGroupItemRun,
    computeInitialItemStatus,
    computeInitialGroupItemStatus,
    ensureGroupItemKeyInitialized,
    ensureItemRuns,
    ensureItemKeyInitialized,
    getEffectiveDependencyIdsForNodeItem,
    collectDownstreamSubgraph,
    resetNodeForReplay,
  } = state;

  const routeItemManager = createRouteItemManager({
    runtimeStore: deps.runtimeStore,
    graph: deps.graph,
    state,
  });
  const structuredNodeRunner = createStructuredNodeRunner({
    client: deps.client,
    runtimeStore: deps.runtimeStore,
    graph: deps.graph,
    artifactDir: deps.artifactDir,
    pipelineId: deps.pipelineId,
    pipelineNodeExecutionTimeoutMs: deps.pipelineNodeExecutionTimeoutMs,
    getNodeById,
    getRun,
    getActiveBatchKeywordItems: () => activeBatchKeywordItems,
    getBatchRunId: deps.getBatchRunId,
  });

  const sessionRegistry = createSessionRegistry({
    client: deps.client,
    pushTimeline: deps.runtimeStore.pushTimeline,
    getKnownExecutorIds: () => {
      const ids = new Set<string>();
      for (const node of getRun().nodes) {
        ids.add(node.executor.agentId);
        if (node.executor.fallbackAgentId) ids.add(node.executor.fallbackAgentId);
      }
      return ids;
    },
  });

  // ====== Helper: Reset affected downstream ======
  const resetAffectedDownstreamNodes = (params: {
    targetNodeId: string;
    itemKey?: string;
    skipNodeIds?: string[];
  }): { affectedNodeCount: number; affectedGroupCount: number } => {
    const run = getRun();
    const affected = collectDownstreamSubgraph(params.targetNodeId);
    const skipSet = new Set(params.skipNodeIds ?? []);

    for (const affectedNode of run.nodes) {
      if (!affected.nodeIds.has(affectedNode.id)) continue;
      if (skipSet.has(affectedNode.id)) continue;
      resetNodeForReplay(affectedNode, { clearRejectFeedbacks: affectedNode.id !== params.targetNodeId });
    }
    for (const affectedGroup of run.groups ?? []) {
      if (!affected.groupIds.has(affectedGroup.id)) continue;
      markGroupReset(affectedGroup, computeInitialGroupItemStatus(affectedGroup.id), ctx("reset_downstream"));
      affectedGroup.artifacts = [];
    }
    for (const affectedItem of run.itemRuns ?? []) {
      if (!affected.nodeIds.has(affectedItem.nodeId)) continue;
      if (skipSet.has(affectedItem.nodeId)) continue;
      if (params.itemKey && affectedItem.itemKey !== params.itemKey) continue;
      markItemReset(affectedItem, computeInitialItemStatus(affectedItem.nodeId), ctx("reset_downstream"));
      affectedItem.route = null;
      affectedItem.artifacts = [];
    }
    for (const affectedGroupItem of run.groupItemRuns ?? []) {
      if (!affected.groupIds.has(affectedGroupItem.groupId)) continue;
      if (params.itemKey && affectedGroupItem.itemKey !== params.itemKey) continue;
      markGroupItemReset(affectedGroupItem, computeInitialGroupItemStatus(affectedGroupItem.groupId), ctx("reset_downstream"));
      affectedGroupItem.artifacts = [];
    }

    return { affectedNodeCount: affected.nodeIds.size, affectedGroupCount: affected.groupIds.size };
  };

  // ====== Node runner ======
  const nodeRunner = createNodeRunner({
    runtimeStore: deps.runtimeStore,
    getRun,
    structuredNodeRunner,
    sessionRegistry,
    runAbortController,
    handleNodeReject,
    resetAffectedDownstreamNodes,
    artifactDir: deps.artifactDir,
    pipelineId: deps.pipelineId,
    getBatchRunId: deps.getBatchRunId,
  });

  // ====== Node item executor ======
  const nodeItemExecutor = createNodeItemExecutor({
    runtimeStore: deps.runtimeStore,
    graph: deps.graph,
    nodeRunner,
    routeItemManager,
    getRun,
    getNodeById,
    getEffectiveDependencyIdsForNodeItem,
  });
  const executeNodeItem = nodeItemExecutor.executeNodeItem;

  // ====== Group item executor ======
  const groupItemExecutor = createGroupItemExecutor({
    runtimeStore: deps.runtimeStore,
    graph: deps.graph,
    artifactDir: deps.artifactDir,
    pipelineId: deps.pipelineId,
    getBatchRunId: deps.getBatchRunId,
    getRun,
    getNodeById,
    getGroupById,
    getItemRun,
    ensureItemKeyInitialized,
    getEffectiveDependencyIdsForNodeItem,
    executeNodeItem,
  });

  return {
    getExecutorSessionByAgentId: sessionRegistry.getExecutorSessionByAgentId,
    getSessionCache: sessionRegistry.getSessionCache,
    refreshSessionsFromGateway: sessionRegistry.refreshSessionsFromGateway,
    setActiveBatchKeywordItems: (items: string[] | null) => {
      activeBatchKeywordItems = items;
    },
    onGatewayFrame: (frame: GatewayFrame) => {
      structuredNodeRunner.rememberGatewayFrame(frame);
      sessionRegistry.onGatewayFrame(frame);
    },
    hasActiveSession: (sessionKey: string) => {
      return structuredNodeRunner.hasActiveSession?.(sessionKey) ?? false;
    },
    dispose: () => {
      sessionRegistry.dispose();
    },
    ensureItemKeyInitialized,
    ensureGroupItemKeyInitialized,
    getEffectiveDependencyIdsForNodeItem,
    resetAffectedDownstreamNodes,
    executeNode: nodeRunner.executeNode,
    executeNodeItem,
    executeGroupItem: groupItemExecutor.executeGroupItem,
    abortRunControllers: (runId: string) => runAbortController.abortRunControllers(runId, deps.client),
    getOrCreateDrainSignal: (runId: string) => runAbortController.getOrCreateDrainSignal(runId),
  };
};

export type ExecutionService = ReturnType<typeof createExecutionService>;
