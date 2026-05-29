import { isDependencySatisfied, canNeverSatisfy, type DependencyCheckContext } from "../execution/dependency-check";
import type { Run } from "../runtime-model";

export type DependencyDiagnosticGraph = {
  getWorkflowNodeById: (nodeId: string) => { dependencyPolicy?: "all" | "any"; routePolicy?: { allowed: string[] } | null } | null;
  getIncomingEdges: (nodeId: string) => Array<{ from: string; to: string; when: string | null }>;
  isCrossBranchEdge: (edge: { from: string; to: string; when: string | null }) => boolean;
  isGroupId: (id: string) => boolean;
  isWorkflowNodeEnabled: (id: string) => boolean;
};

export type ReasonCode =
  | "dependency_satisfied"
  | "source_not_success"
  | "source_failed"
  | "source_skipped"
  | "route_mismatch"
  | "cross_branch_edge_blocked"
  | "group_not_success"
  | "source_disabled_dependency_satisfied"
  | "source_disabled_route_impossible"
  | "missing_source_item_run"
  | "missing_group_item_run";

export type DependencyDiagnostic = {
  itemKey: string;
  nodeId: string;
  incoming: Array<{
    from: string;
    when: string | null;
    satisfied: boolean;
    impossible: boolean;
    reason: ReasonCode;
  }>;
  policy: "all" | "any";
  outcome: "queued" | "waiting" | "skipped";
};

export type ReasonMessage = Record<ReasonCode, string>;

export const REASON_MESSAGES: ReasonMessage = {
  dependency_satisfied: "依赖已满足",
  source_not_success: "上游节点未成功（当前状态不满足依赖）",
  source_failed: "上游节点执行失败",
  source_skipped: "上游节点已跳过",
  route_mismatch: "路由不匹配（上游路由值与边要求不一致）",
  cross_branch_edge_blocked: "跨支线边已被阻断",
  group_not_success: "上游并行组未成功",
  source_disabled_dependency_satisfied: "上游节点已禁用（视为依赖满足）",
  source_disabled_route_impossible: "上游节点已禁用但路由边无法满足",
  missing_source_item_run: "缺少上游节点条目运行记录",
  missing_group_item_run: "缺少上游并行组条目运行记录",
};

const resolveOutcome = (
  satisfiedCount: number,
  impossibleCount: number,
  totalIncoming: number,
  policy: "all" | "any",
): "queued" | "waiting" | "skipped" => {
  if (policy === "any") {
    if (satisfiedCount > 0) return "queued";
    if (impossibleCount === totalIncoming) return "skipped";
    return "waiting";
  }
  if (satisfiedCount === totalIncoming) return "queued";
  if (satisfiedCount + impossibleCount === totalIncoming && impossibleCount > 0) return "skipped";
  return "waiting";
};

const resolveReason = (
  satisfied: boolean,
  impossible: boolean,
  ctx: DependencyCheckContext,
  edge: { from: string; to: string; when: string | null },
  itemKey: string,
): ReasonCode => {
  if (satisfied) {
    if (ctx.isGroupId(edge.from)) return "dependency_satisfied";
    if (!ctx.isWorkflowNodeEnabled(edge.from)) return "source_disabled_dependency_satisfied";
    return "dependency_satisfied";
  }

  if (ctx.isCrossBranchEdge(edge)) return "cross_branch_edge_blocked";

  if (ctx.isGroupId(edge.from)) {
    const sourceGroup = ctx.getGroupItemRun(edge.from, itemKey);
    if (!sourceGroup) return "missing_group_item_run";
    if (sourceGroup.status === "failed") return "group_not_success";
    if (sourceGroup.status === "skipped") return "group_not_success";
    return "group_not_success";
  }

  if (!ctx.isWorkflowNodeEnabled(edge.from)) {
    if (edge.when !== null) return "source_disabled_route_impossible";
    return "source_disabled_dependency_satisfied";
  }

  const source = ctx.getItemRun(edge.from, itemKey);
  if (!source) return "missing_source_item_run";

  if (edge.when && source.status === "success" && source.route !== edge.when) {
    return "route_mismatch";
  }
  if (source.status === "failed") return "source_failed";
  if (source.status === "skipped") return "source_skipped";
  return "source_not_success";
};

export const diagnoseNodeDependency = (
  run: Run,
  graph: DependencyDiagnosticGraph,
  nodeId: string,
  itemKey?: string,
): DependencyDiagnostic[] => {
  const workflowNode = graph.getWorkflowNodeById(nodeId);
  const policy: "all" | "any" = workflowNode?.dependencyPolicy === "any" ? "any" : "all";
  const incoming = graph.getIncomingEdges(nodeId);

  const itemRuns = (run.itemRuns ?? [])
    .filter((item) => item.nodeId === nodeId)
    .filter((item) => !itemKey || item.itemKey === itemKey);

  if (itemRuns.length === 0) return [];

  const ctx: DependencyCheckContext = {
    isCrossBranchEdge: (edge) => graph.isCrossBranchEdge(edge),
    isGroupId: (id) => graph.isGroupId(id),
    isWorkflowNodeEnabled: (id) => graph.isWorkflowNodeEnabled(id),
    isRoutePolicyNode: (id) => (graph.getWorkflowNodeById(id)?.routePolicy?.allowed.length ?? 0) > 0,
    getGroupItemRun: (groupId, key) =>
      (run.groupItemRuns ?? []).find((item) => item.groupId === groupId && item.itemKey === key) ?? null,
    getItemRun: (node, key) =>
      (run.itemRuns ?? []).find((item) => item.nodeId === node && item.itemKey === key) ?? null,
  };

  return itemRuns.map((item) => {
    const incomingDiagnostics = incoming.map((edge) => {
      const satisfied = isDependencySatisfied(item.itemKey, edge, ctx);
      const impossible = canNeverSatisfy(item.itemKey, edge, ctx);
      const reason = resolveReason(satisfied, impossible, ctx, edge, item.itemKey);
      return { from: edge.from, when: edge.when, satisfied, impossible, reason };
    });

    const satisfiedCount = incomingDiagnostics.filter((d) => d.satisfied).length;
    const impossibleCount = incomingDiagnostics.filter((d) => d.impossible).length;
    const outcome = resolveOutcome(satisfiedCount, impossibleCount, incoming.length, policy);

    return {
      itemKey: item.itemKey,
      nodeId: item.nodeId,
      incoming: incomingDiagnostics,
      policy,
      outcome,
    };
  });
};
