import { randomUUID } from "node:crypto";
import type { RuntimeStore } from "../../app/runtime-store";
import type { WorkflowGraph } from "../workflow-graph";
import type { GroupItemRun, NodeItemRun, NodeRun } from "../runtime-model";
import { isDependencySatisfied as checkSatisfied, type DependencyCheckContext } from "./dependency-check";
import { transitionStatus } from "../state-machine";

type CreateRunStateHelpersOptions = {
  runtimeStore: RuntimeStore;
  graph: WorkflowGraph;
  defaultItemKeys: string[];
};

export const createRunStateHelpers = (options: CreateRunStateHelpersOptions) => {
  const getRun = () => options.runtimeStore.getRun();

  const getNodeById = (nodeId: string) => getRun().nodes.find((node) => node.id === nodeId) ?? null;
  const getGroupById = (groupId: string) => (getRun().groups ?? []).find((group) => group.id === groupId) ?? null;
  const getItemRun = (nodeId: string, itemKey: string) =>
    (getRun().itemRuns ?? []).find((item) => item.nodeId === nodeId && item.itemKey === itemKey) ?? null;
  const getGroupItemRun = (groupId: string, itemKey: string) =>
    (getRun().groupItemRuns ?? []).find((item) => item.groupId === groupId && item.itemKey === itemKey) ?? null;

  const computeInitialItemStatus = (nodeId: string): NodeItemRun["status"] => {
    if (!options.graph.isWorkflowNodeEnabled(nodeId)) return "skipped";
    if (options.graph.getParallelGroupByMemberNodeId(nodeId)) return "blocked";
    const incoming = options.graph.getIncomingEdges(nodeId);
    return incoming.length === 0 ? "queued" : "blocked";
  };

  const computeInitialGroupItemStatus = (groupId: string): GroupItemRun["status"] => {
    const incoming = options.graph.getIncomingEdges(groupId);
    return incoming.length === 0 ? "queued" : "blocked";
  };

  const ensureGroupItemKeyInitialized = (itemKey: string) => {
    const run = getRun();
    options.graph.syncRunGroupsFromWorkflow(run);
    if (!run.groupItemRuns) run.groupItemRuns = [];
    for (const group of run.groups ?? []) {
      const existed = run.groupItemRuns.find((item) => item.groupId === group.id && item.itemKey === itemKey);
      if (existed) continue;
      run.groupItemRuns.push({
        id: randomUUID(),
        groupId: group.id,
        itemKey,
        status: computeInitialGroupItemStatus(group.id),
        attempt: 0,
        startedAt: null,
        finishedAt: null,
        lastError: null,
        artifacts: [],
      });
    }
  };

  const ensureItemRuns = () => {
    const run = getRun();
    if (!run.itemRuns) run.itemRuns = [];
    options.graph.syncRunGroupsFromWorkflow(run);
    if (run.itemRuns.length === 0) {
      run.itemRuns = options.graph.getTemplateNodes().flatMap((node) => {
        const status = computeInitialItemStatus(node.id);
        return options.defaultItemKeys.map((itemKey) => ({
          id: randomUUID(),
          nodeId: node.id,
          itemKey,
          status,
          route: null,
          attempt: 0,
          loopCount: 0,
          wakeAt: null,
          startedAt: null,
          finishedAt: null,
          lastError: null,
          artifacts: [],
        }));
      });
      for (const itemKey of options.defaultItemKeys) {
        ensureGroupItemKeyInitialized(itemKey);
      }
      return;
    }

    const knownNodeIds = new Set(run.nodes.map((node) => node.id));
    run.itemRuns = run.itemRuns.filter((item) => knownNodeIds.has(item.nodeId));
  };

  const ensureItemKeyInitialized = (itemKey: string) => {
    const run = getRun();
    if (!run.itemRuns) run.itemRuns = [];
    for (const node of run.nodes) {
      const existed = run.itemRuns.find((item) => item.nodeId === node.id && item.itemKey === itemKey);
      if (existed) continue;
      run.itemRuns.push({
        id: randomUUID(),
        nodeId: node.id,
        itemKey,
        status: computeInitialItemStatus(node.id),
        route: null,
        attempt: 0,
        loopCount: 0,
        wakeAt: null,
        startedAt: null,
        finishedAt: null,
        lastError: null,
        artifacts: [],
      });
    }
    ensureGroupItemKeyInitialized(itemKey);
  };

  const depCheckContext: DependencyCheckContext = {
    isCrossBranchEdge: (edge) => options.graph.isCrossBranchEdge(edge),
    isGroupId: (id) => options.graph.isGroupId(id),
    isWorkflowNodeEnabled: (id) => options.graph.isWorkflowNodeEnabled(id),
    isRoutePolicyNode: (id) => (options.graph.getWorkflowNodeById(id)?.routePolicy?.allowed.length ?? 0) > 0,
    getGroupItemRun: (groupId, itemKey) => getGroupItemRun(groupId, itemKey),
    getItemRun: (nodeId, itemKey) => getItemRun(nodeId, itemKey),
  };

  const isDependencySatisfied = (itemKey: string, edge: { from: string; to: string; when: string | null }) =>
    checkSatisfied(itemKey, edge, depCheckContext);

  const getEffectiveDependencyIdsForNodeItem = (nodeId: string, itemKey: string) => {
    const directDependencyIds = options.graph.getIncomingEdges(nodeId)
      .filter((edge) => isDependencySatisfied(itemKey, edge))
      .map((edge) => edge.from);
    const groupId = options.graph.getWorkflowNodeById(nodeId)?.parallelGroupId?.trim();
    if (!groupId) return [...new Set(directDependencyIds)];
    const groupDependencyIds = options.graph.getIncomingEdges(groupId)
      .filter((edge) => isDependencySatisfied(itemKey, edge))
      .map((edge) => edge.from);
    return [...new Set([...directDependencyIds, ...groupDependencyIds])];
  };

  const collectDownstreamSubgraph = (rootNodeId: string): { nodeIds: Set<string>; groupIds: Set<string> } => {
    const nodeIds = new Set<string>();
    const groupIds = new Set<string>();
    const queue = [rootNodeId];
    const seen = new Set<string>();
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || seen.has(current)) continue;
      seen.add(current);
      if (options.graph.isGroupId(current)) {
        groupIds.add(current);
        const group = options.graph.getWorkflowGroupById(current);
        // A parallel group is not an execution node itself, but it controls the state of its member nodes and subsequent join branches.
        // Replay/reject must penetrate the group to include members and nodes downstream of the group in the reset scope.
        for (const memberId of group?.members ?? []) {
          queue.push(memberId);
        }
      } else {
        nodeIds.add(current);
        const ownerGroup = options.graph.getParallelGroupByMemberNodeId(current);
        if (ownerGroup) {
          queue.push(ownerGroup.id);
        }
      }
      for (const edge of options.graph.getOutgoingEdges(current)) {
        if (options.graph.isCrossBranchEdge(edge)) continue;
        queue.push(edge.to);
      }
    }
    return { nodeIds, groupIds };
  };

  const collectReachableEntities = (startIds: string[]) => {
    const nodeIds = new Set<string>();
    const groupIds = new Set<string>();
    const queue = [...startIds];
    const seen = new Set<string>();
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || seen.has(current)) continue;
      seen.add(current);
      if (options.graph.isGroupId(current)) {
        groupIds.add(current);
      } else {
        nodeIds.add(current);
      }
      for (const edge of options.graph.getOutgoingEdges(current)) {
        queue.push(edge.to);
      }
    }
    return { nodeIds, groupIds };
  };

  const collectAncestorEntities = (startIds: string[]) => {
    const nodeIds = new Set<string>();
    const groupIds = new Set<string>();
    const queue = [...startIds];
    const seen = new Set<string>();
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || seen.has(current)) continue;
      seen.add(current);
      if (options.graph.isGroupId(current)) {
        groupIds.add(current);
      } else {
        nodeIds.add(current);
      }
      for (const edge of options.graph.getIncomingEdges(current)) {
        queue.push(edge.from);
      }
    }
    return { nodeIds, groupIds };
  };

  const resetNodeForReplay = (node: NodeRun, opts?: { clearRejectFeedbacks?: boolean }) => {
    const run = getRun();
    if (!options.graph.isWorkflowNodeEnabled(node.id)) {
      node.status = transitionStatus(node.status, "skipped");
    } else {
      const effectiveDepIds = new Set(
        options.graph.getIncomingEdges(node.id)
          .filter((edge) => !options.graph.isCrossBranchEdge(edge))
          .map((edge) => edge.from),
      );
      const groupId = options.graph.getWorkflowNodeById(node.id)?.parallelGroupId?.trim();
      if (groupId) {
        for (const edge of options.graph.getIncomingEdges(groupId)) {
          if (!options.graph.isCrossBranchEdge(edge)) {
            effectiveDepIds.add(edge.from);
          }
        }
      }
      node.status = transitionStatus(
        node.status,
        [...effectiveDepIds].every((depId) => {
          if (options.graph.isGroupId(depId)) {
            return (run.groups ?? []).find((group) => group.id === depId)?.status === "success";
          }
          if (!options.graph.isWorkflowNodeEnabled(depId)) return true;
          return run.nodes.find((current) => current.id === depId)?.status === "success";
        })
          ? "queued"
          : "blocked",
      );
    }
    node.artifacts = [];
    node.startedAt = null;
    node.finishedAt = null;
    node.lastError = null;
    if (opts?.clearRejectFeedbacks ?? true) {
      node.rejectFeedbacks = [];
    }
  };

  return {
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
    isDependencySatisfied,
    getEffectiveDependencyIdsForNodeItem,
    collectDownstreamSubgraph,
    collectReachableEntities,
    collectAncestorEntities,
    resetNodeForReplay,
  };
};

export type RunStateHelpers = ReturnType<typeof createRunStateHelpers>;
