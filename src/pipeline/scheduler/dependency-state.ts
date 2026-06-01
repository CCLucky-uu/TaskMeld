import { syncRunNodeStatusFromItemRuns, type GroupItemRun, type NodeItemRun } from "../runtime-model";
import type { RuntimeStore } from "../../app/runtime-store";
import type { WorkflowGraph } from "../workflow-graph";
import { canPromoteToQueuedByDependency, isSleepWaitingState } from "../execution/readiness-state";
import { isDependencySatisfied, canNeverSatisfy, type DependencyCheckContext } from "../execution/dependency-check";
import {
  markItemQueued,
  markItemSkipped,
  markItemWaiting,
  markItemBlocked,
  markItemWakeSuccess,
  markGroupItemQueued,
  markGroupItemSkipped,
  markGroupItemWaiting,
  markGroupItemBlocked,
  markGroupQueued,
  markGroupRunning,
  markGroupWaiting,
  markGroupSuccess,
  markGroupFailed,
  markGroupBlocked,
} from "../state";

type CreateDependencyStateOptions = {
  runtimeStore: RuntimeStore;
  graph: WorkflowGraph;
  ensureItemRuns: () => void;
  getItemRun: (nodeId: string, itemKey: string) => NodeItemRun | null;
  getGroupItemRun: (groupId: string, itemKey: string) => GroupItemRun | null;
};

export const createDependencyState = (options: CreateDependencyStateOptions) => {
  const getRun = () => options.runtimeStore.getRun();
  const resolveDependencyPolicy = (nodeId: string): "all" | "any" => {
    const workflowNode = options.graph.getWorkflowNodeById(nodeId);
    return workflowNode?.dependencyPolicy === "any" ? "any" : "all";
  };
  const resolveDependencyOutcome = (
    itemKey: string,
    incoming: Array<{ from: string; to: string; when: string | null }>,
    policy: "all" | "any",
  ): "queued" | "waiting" | "skipped" => {
    let satisfiedCount = 0;
    let impossibleCount = 0;
    for (const edge of incoming) {
      if (isDependencySatisfied(itemKey, edge, depCheckContext)) {
        satisfiedCount += 1;
        continue;
      }
      if (canNeverSatisfy(itemKey, edge, depCheckContext)) {
        impossibleCount += 1;
      }
    }
    // all/any execution difference:
    // - all: only enqueue when all dependencies are satisfied; skip when remaining dependencies are all impossible.
    // - any: enqueue when any single dependency is satisfied; only skip when all dependencies are impossible.
    if (policy === "any") {
      if (satisfiedCount > 0) return "queued";
      if (impossibleCount === incoming.length) return "skipped";
      return "waiting";
    }
    if (satisfiedCount === incoming.length) return "queued";
    if (satisfiedCount + impossibleCount === incoming.length && impossibleCount > 0) return "skipped";
    return "waiting";
  };

  const depCheckContext: DependencyCheckContext = {
    isCrossBranchEdge: (edge) => options.graph.isCrossBranchEdge(edge),
    isGroupId: (id) => options.graph.isGroupId(id),
    isWorkflowNodeEnabled: (id) => options.graph.isWorkflowNodeEnabled(id),
    isRoutePolicyNode: (id) => (options.graph.getWorkflowNodeById(id)?.routePolicy?.allowed.length ?? 0) > 0,
    getGroupItemRun: options.getGroupItemRun,
    getItemRun: options.getItemRun,
  };

  const wakeDueItems = () => {
    const now = Date.now();
    for (const item of getRun().itemRuns ?? []) {
      if (item.status !== "waiting" || !item.wakeAt) continue;
      const wakeTs = Date.parse(item.wakeAt);
      if (!Number.isFinite(wakeTs) || wakeTs > now) continue;
      markItemWakeSuccess(item, { reason: "sleep_expired" });
      options.runtimeStore.pushTimeline(`Waiting node woken: ${item.nodeId}#${item.itemKey}`);
    }
  };

  const markReadyItemsFromDependencies = () => {
    options.ensureItemRuns();
    options.graph.syncRunGroupsFromWorkflow(getRun());
    wakeDueItems();
    for (const item of getRun().itemRuns ?? []) {
      if (!options.graph.isWorkflowNodeEnabled(item.nodeId)) {
        markItemSkipped(item, { reason: "node_disabled" });
        continue;
      }
      if (item.status === "running" || item.status === "success" || item.status === "failed" || item.status === "stopped" || isSleepWaitingState(item)) {
        continue;
      }
      if (options.graph.getParallelGroupByMemberNodeId(item.nodeId)) {
        markItemBlocked(item, { reason: "parallel_group_member", command: "dependency" });
        continue;
      }
      const incoming = options.graph.getIncomingEdges(item.nodeId);
      if (incoming.length === 0) {
        if (canPromoteToQueuedByDependency(item)) markItemQueued(item, { reason: "no_dependencies", command: "dependency" });
        continue;
      }
      const outcome = resolveDependencyOutcome(item.itemKey, incoming, resolveDependencyPolicy(item.nodeId));
      if (outcome === "queued") markItemQueued(item, { reason: "dependency_satisfied", command: "dependency" });
      else if (outcome === "waiting") markItemWaiting(item, { reason: "dependency_pending", command: "dependency" });
      else markItemSkipped(item, { reason: "dependency_impossible", command: "dependency" });
    }
    syncRunNodeStatusFromItemRuns(getRun());
  };

  const markReadyGroupsFromDependencies = () => {
    options.graph.syncRunGroupsFromWorkflow(getRun());
    for (const item of getRun().groupItemRuns ?? []) {
      if (item.status === "running" || item.status === "success" || item.status === "failed" || item.status === "stopped") {
        continue;
      }
      const incoming = options.graph.getIncomingEdges(item.groupId);
      if (incoming.length === 0) {
        if (canPromoteToQueuedByDependency(item)) markGroupItemQueued(item, { reason: "no_dependencies", command: "dependency" });
        continue;
      }
      const outcome = resolveDependencyOutcome(item.itemKey, incoming, "all");
      if (outcome === "queued") markGroupItemQueued(item, { reason: "dependency_satisfied", command: "dependency" });
      else if (outcome === "waiting") markGroupItemWaiting(item, { reason: "dependency_pending", command: "dependency" });
      else markGroupItemSkipped(item, { reason: "dependency_impossible", command: "dependency" });
    }
    for (const group of getRun().groups ?? []) {
      const related = (getRun().groupItemRuns ?? []).filter((item) => item.groupId === group.id);
      if (related.length === 0) continue;
      // joinPolicy only supports "all": mark group success only when all group items succeed, fail if any fails
      if (related.some((item) => item.status === "failed")) {
        markGroupFailed(group, { reason: "member_failed", command: "group_aggregate", error: related.find((item) => item.status === "failed")?.lastError });
      } else if (related.some((item) => item.status === "running")) {
        markGroupRunning(group, { reason: "members_running", command: "group_aggregate" });
      } else if (related.some((item) => item.status === "waiting")) {
        markGroupWaiting(group, { reason: "members_waiting", command: "group_aggregate" });
      } else if (related.some((item) => item.status === "queued")) {
        markGroupQueued(group, { reason: "members_queued", command: "group_aggregate" });
      } else if (related.every((item) => item.status === "success" || item.status === "skipped")) {
        markGroupSuccess(group, { reason: "all_members_done", command: "group_aggregate" });
      } else {
        markGroupBlocked(group, { reason: "members_blocked", command: "group_aggregate" });
      }
    }
  };

  return {
    markReadyItemsFromDependencies,
    markReadyGroupsFromDependencies,
  };
};

export type DependencyState = ReturnType<typeof createDependencyState>;
