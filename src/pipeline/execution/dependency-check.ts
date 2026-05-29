import { MAINLINE_ROUTE_VALUE } from "../workflow/routes";

export type DependencyEdge = {
  from: string;
  to: string;
  when: string | null;
};

export type DependencyCheckContext = {
  isCrossBranchEdge: (edge: DependencyEdge) => boolean;
  isGroupId: (nodeOrGroupId: string) => boolean;
  isWorkflowNodeEnabled: (nodeId: string) => boolean;
  isRoutePolicyNode: (nodeId: string) => boolean;
  getGroupItemRun: (groupId: string, itemKey: string) => { status: string } | undefined | null;
  getItemRun: (nodeId: string, itemKey: string) => { status: string; route?: string | null } | undefined | null;
};

export const isDependencySatisfied = (
  itemKey: string,
  edge: DependencyEdge,
  ctx: DependencyCheckContext,
): boolean => {
  if (ctx.isCrossBranchEdge(edge)) return false;
  if (ctx.isGroupId(edge.from)) {
    const sourceGroup = ctx.getGroupItemRun(edge.from, itemKey);
    if (!sourceGroup) return false;
    return sourceGroup.status === "success";
  }
  if (!ctx.isWorkflowNodeEnabled(edge.from)) {
    return edge.when === null;
  }
  const source = ctx.getItemRun(edge.from, itemKey);
  if (!source) return false;
  if (source.status !== "success") return false;
  if (!edge.when) {
    return ctx.isRoutePolicyNode(edge.from) ? source.route === MAINLINE_ROUTE_VALUE : true;
  }
  return source.route === edge.when;
};

export const canNeverSatisfy = (
  itemKey: string,
  edge: DependencyEdge,
  ctx: DependencyCheckContext,
): boolean => {
  if (ctx.isCrossBranchEdge(edge)) return true;
  if (ctx.isGroupId(edge.from)) {
    const sourceGroup = ctx.getGroupItemRun(edge.from, itemKey);
    if (!sourceGroup) return false;
    return sourceGroup.status === "failed" || sourceGroup.status === "skipped";
  }
  if (!ctx.isWorkflowNodeEnabled(edge.from)) {
    return edge.when !== null;
  }
  const source = ctx.getItemRun(edge.from, itemKey);
  if (!source) return false;
  if (source.status === "failed" || source.status === "skipped" || source.status === "stopped") return true;
  if (source.status === "success" && edge.when === null && ctx.isRoutePolicyNode(edge.from)) {
    return source.route !== MAINLINE_ROUTE_VALUE;
  }
  if (source.status === "success" && edge.when && source.route !== edge.when) return true;
  return false;
};
