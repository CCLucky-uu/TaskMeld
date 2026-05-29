import { computeNodeScopes, isCrossBranchEdgeByScope } from "./branch-rules";
import { DEFAULT_BRANCH_ROUTE_VALUE, MAINLINE_ROUTE_VALUE } from "./routes";
import type { WorkflowDefinitionRuntime, WorkflowValidationResult } from "../types/workflow";

// ====== Validation ======

export const validateWorkflowGraph = (workflow: WorkflowDefinitionRuntime): WorkflowValidationResult => {
  if (workflow.nodes.length === 0) {
    return workflow.edges.length === 0 && workflow.groups.length === 0
      ? { ok: true }
      : { ok: false, error: "invalid_workflow_definition", detail: "空 workflow 不能包含 edges 或 groups" };
  }
  const nodeIds = new Set(workflow.nodes.map((node) => node.id));
  if (nodeIds.size !== workflow.nodes.length) {
    return { ok: false, error: "invalid_workflow_definition", detail: "workflow.nodes 存在重复 id" };
  }
  const groupIds = new Set(workflow.groups.map((group) => group.id));
  const entityIds = new Set<string>([...nodeIds, ...groupIds]);

  const outgoing = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  for (const node of workflow.nodes) {
    outgoing.set(node.id, []);
    indegree.set(node.id, 0);
  }
  for (const group of workflow.groups) {
    outgoing.set(group.id, []);
    indegree.set(group.id, 0);
  }

  const edgeDedupe = new Set<string>();
  for (const edge of workflow.edges) {
    if (!entityIds.has(edge.from) || !entityIds.has(edge.to)) {
      return { ok: false, error: "invalid_workflow_definition", detail: `边引用了不存在实体: ${edge.from} -> ${edge.to}` };
    }
    if (edge.from === edge.to) {
      return { ok: false, error: "invalid_workflow_definition", detail: `检测到自环边: ${edge.from} -> ${edge.to}` };
    }
    const key = `${edge.from}|${edge.when ?? ""}|${edge.to}`;
    if (edgeDedupe.has(key)) {
      return { ok: false, error: "invalid_workflow_definition", detail: `检测到重复边: ${edge.from} -> ${edge.to}` };
    }
    edgeDedupe.add(key);
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to]);
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
  }

  const outgoingKindsBySource = new Map<string, Set<"dependency" | "route">>();
  const edgesBySource = new Map<string, Array<{ from: string; to: string; when: string | null }>>();
  for (const edge of workflow.edges) {
    const kind: "dependency" | "route" = edge.when === null ? "dependency" : "route";
    const kinds = outgoingKindsBySource.get(edge.from) ?? new Set<"dependency" | "route">();
    kinds.add(kind);
    outgoingKindsBySource.set(edge.from, kinds);
    edgesBySource.set(edge.from, [...(edgesBySource.get(edge.from) ?? []), edge]);
  }
  for (const [sourceId, kinds] of outgoingKindsBySource.entries()) {
    if (kinds.size <= 1) continue;
    const sourceNode = workflow.nodes.find((node) => node.id === sourceId);
    if (sourceNode?.routePolicy) continue;
    // 非分流节点仍禁止同一节点混合依赖边和路由边，避免无条件放行导致重复执行。
    return {
      ok: false,
      error: "mixed_outgoing_edge_kinds_forbidden",
      detail: `节点 ${sourceId} 同时存在 dependency 与 route 出边，已禁止保存`,
    };
  }

  // Phase 2: 基于显式 scope 的跨支线边检测。
  // computeNodeScopes + isCrossBranchEdgeByScope 使用显式 branchScopeId（缺失时从 route 边推导）。
  {
    const explicitScopes = new Map<string, string | null>();
    const mergeNodeIds = new Set<string>();
    for (const node of workflow.nodes) {
      if (node.branchScopeId != null) {
        explicitScopes.set(node.id, node.branchScopeId);
      }
      // merge 节点（dependencyPolicy !== "all"）是显式分支汇聚点，接受来自不同 scope 的依赖边
      if (node.dependencyPolicy && node.dependencyPolicy !== "all") {
        mergeNodeIds.add(node.id);
      }
    }
    const nodeScopes = computeNodeScopes(workflow.nodes, workflow.edges, explicitScopes);
    // 对 merge 节点清除 scope，避免其被误判为跨支线（与 workflow-graph.ts 的 buildIndices 保持一致）
    for (const nodeId of mergeNodeIds) {
      nodeScopes.set(nodeId, null);
    }

    const scopeCrossEdges = workflow.edges.filter(
      (edge) => isCrossBranchEdgeByScope(edge, nodeScopes),
    );
    if (scopeCrossEdges.length > 0) {
      return {
        ok: false,
        error: "cross_branch_edge_forbidden",
        detail: `禁止跨支线无条件边: ${scopeCrossEdges[0].from} -> ${scopeCrossEdges[0].to}（from 分支 ${nodeScopes.get(scopeCrossEdges[0].from) ?? "main"} -> to 分支 ${nodeScopes.get(scopeCrossEdges[0].to) ?? "main"}，跨支线依赖边需要显式 merge 节点）`,
      };
    }
  }

  const uniqueGroupIds = new Set<string>();
  const explicitGroupById = new Map(workflow.groups.map((group) => [group.id, group]));
  for (const group of workflow.groups) {
    if (uniqueGroupIds.has(group.id)) {
      return { ok: false, error: "invalid_workflow_definition", detail: `并行组 id 重复: ${group.id}` };
    }
    uniqueGroupIds.add(group.id);

    for (const member of group.members) {
      if (!nodeIds.has(member)) {
        return { ok: false, error: "invalid_workflow_definition", detail: `并行组 ${group.id} 引用了不存在成员 ${member}` };
      }
    }
  }

  for (const node of workflow.nodes) {
    const groupId = node.parallelGroupId?.trim();
    if (!groupId) continue;
    const group = explicitGroupById.get(groupId);
    if (!group) return { ok: false, error: "invalid_workflow_definition", detail: `节点 ${node.id} 引用了不存在并行组 ${groupId}` };
    if (!group.members.includes(node.id)) {
      return { ok: false, error: "invalid_workflow_definition", detail: `节点 ${node.id} 未加入其声明的并行组 ${groupId}` };
    }
  }

  for (const group of workflow.groups) {
    const memberSet = new Set(group.members);
    const groupIncoming = new Set(
      workflow.edges
        .filter((edge) => edge.to === group.id)
        .map((edge) => edge.from),
    );

    for (const edge of workflow.edges) {
      if (edge.when !== null) continue;
      if (!memberSet.has(edge.to)) continue;
      if (edge.to === group.id) continue;
      if (edge.from === group.id) return { ok: false, error: "invalid_workflow_definition", detail: `并行组 ${group.id} 不能直接连入成员节点` };
      if (memberSet.has(edge.from)) return { ok: false, error: "invalid_workflow_definition", detail: `并行组 ${group.id} 成员之间禁止直接依赖` };
      if (groupIncoming.has(edge.from)) return { ok: false, error: "invalid_workflow_definition", detail: `并行组 ${group.id} 的入口节点不能直连成员` };
    }
  }

  for (const group of workflow.groups) {
    // joinPolicy 仅支持 "all"；any/quorum 运行时未实现，保存时显式拒绝
    if (group.joinPolicy !== "all") {
      return {
        ok: false,
        error: "join_policy_not_supported",
        detail: `并行组 ${group.id} 的 joinPolicy "${group.joinPolicy}" 未支持，当前仅支持 "all"`,
      };
    }
  }

  for (const node of workflow.nodes) {
    if (node.routePolicy) {
      const { allowed } = node.routePolicy;
      if (allowed.length < 2 || allowed.length > 5) {
        return { ok: false, error: "invalid_workflow_definition", detail: `节点 ${node.id} 的路由集合长度非法` };
      }
      if (!allowed.includes(MAINLINE_ROUTE_VALUE) || !allowed.includes(DEFAULT_BRANCH_ROUTE_VALUE)) {
        return { ok: false, error: "invalid_workflow_definition", detail: `节点 ${node.id} 开启分流后必须包含 yes 和 no` };
      }
      const outgoingEdges = edgesBySource.get(node.id) ?? [];
      const dependencyEdges = outgoingEdges.filter((edge) => edge.when === null);
      if (dependencyEdges.length > 1) {
        return { ok: false, error: "invalid_workflow_definition", detail: `节点 ${node.id} 的 yes 主线依赖边最多只能有 1 条` };
      }
      const routeEdgeCounts = new Map<string, number>();
      for (const edge of outgoingEdges.filter((item) => item.when !== null)) {
        routeEdgeCounts.set(edge.when ?? "", (routeEdgeCounts.get(edge.when ?? "") ?? 0) + 1);
        if (edge.when === MAINLINE_ROUTE_VALUE) {
          return { ok: false, error: "invalid_workflow_definition", detail: `节点 ${node.id} 的 yes 不能保存为路由边` };
        }
        if (!allowed.includes(edge.when ?? "")) {
          return { ok: false, error: "invalid_workflow_definition", detail: `节点 ${node.id} 存在未声明的路由边: ${edge.when}` };
        }
        const targetNode = workflow.nodes.find((candidate) => candidate.id === edge.to);
        const targetGroup = workflow.groups.find((group) => group.id === edge.to);
        const targetGroupMembers = targetGroup
          ? targetGroup.members.map((memberId) => workflow.nodes.find((candidate) => candidate.id === memberId)).filter(Boolean)
          : [];
        const isBranchTarget = targetNode?.lane === "branch" || (targetGroupMembers.length > 0 && targetGroupMembers.every((member) => member?.lane === "branch"));
        if (!isBranchTarget) {
          return { ok: false, error: "invalid_workflow_definition", detail: `节点 ${node.id} 的路由 ${edge.when} 只能指向支线节点或支线并行组` };
        }
      }
      for (const route of allowed.filter((item) => item !== MAINLINE_ROUTE_VALUE)) {
        if ((routeEdgeCounts.get(route) ?? 0) !== 1) {
          return { ok: false, error: "invalid_workflow_definition", detail: `节点 ${node.id} 的路由 ${route} 必须配置且只能配置 1 个支线目标` };
        }
      }
    }
    if (node.dependencyPolicy !== undefined && node.dependencyPolicy !== "all" && node.dependencyPolicy !== "any") {
      return { ok: false, error: "invalid_workflow_definition", detail: `节点 ${node.id} 的 dependencyPolicy 非法` };
    }
  }

  const queue = [...[...entityIds].filter((id) => (indegree.get(id) ?? 0) === 0)];
  let visited = 0;
  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    visited += 1;
    for (const nextId of outgoing.get(nodeId) ?? []) {
      const nextDegree = (indegree.get(nextId) ?? 0) - 1;
      indegree.set(nextId, nextDegree);
      if (nextDegree === 0) {
        queue.push(nextId);
      }
    }
  }

  if (visited !== entityIds.size) {
    return { ok: false, error: "invalid_workflow_definition", detail: "工作流存在环路，无法拓扑排序" };
  }

  return { ok: true };
};

export const validateWorkflowOutputConfig = (workflow: WorkflowDefinitionRuntime): WorkflowValidationResult => {
  const output = workflow.output ?? { mode: "mainline_last" as const, nodeId: null };
  if (workflow.nodes.length === 0) {
    return output.mode === "explicit" && output.nodeId
      ? { ok: false, error: "invalid_workflow_output_config", detail: "空 workflow 不能指定输出节点" }
      : { ok: true };
  }
  if (output.mode === "explicit") {
    if (!output.nodeId) {
      return { ok: false, error: "invalid_workflow_output_config", detail: "mode=explicit 时 nodeId 必填" };
    }
    const node = workflow.nodes.find((n) => n.id === output.nodeId);
    if (!node) {
      return { ok: false, error: "invalid_workflow_output_config", detail: `输出节点 ${output.nodeId} 不存在` };
    }
    if (!node.enabled) {
      return { ok: false, error: "invalid_workflow_output_config", detail: `输出节点 ${output.nodeId} 必须 enabled` };
    }
    if (node.lane !== "main") {
      return { ok: false, error: "invalid_workflow_output_config", detail: `输出节点 ${output.nodeId} 必须是主线节点` };
    }
    if (node.branchScopeId) {
      return { ok: false, error: "invalid_workflow_output_config", detail: `输出节点 ${output.nodeId} 不能属于支线 scope` };
    }
    return { ok: true };
  }

  // mode === "mainline_last" — auto-derive unique mainline sink via reachability
  const mainlineNodeIds = new Set(
    workflow.nodes
      .filter((n) => n.enabled && n.lane === "main" && !n.branchScopeId && !n.routeSourceNodeId && !n.routeValue)
      .map((n) => n.id),
  );

  if (mainlineNodeIds.size === 0) {
    return { ok: false, error: "invalid_workflow_output_config", detail: "没有可用的主线节点" };
  }

  // Build full adjacency (all nodes, all edges) for reachability DFS
  const allNodeIds = new Set(workflow.nodes.map((n) => n.id));
  const successors = new Map<string, string[]>();
  for (const id of allNodeIds) successors.set(id, []);
  for (const edge of workflow.edges) {
    const list = successors.get(edge.from);
    if (list) list.push(edge.to);
  }

  // Build indegree/outdegree in full graph (used for orphan detection)
  const indegree = new Map<string, number>();
  const outdegree = new Map<string, number>();
  for (const id of allNodeIds) { indegree.set(id, 0); outdegree.set(id, 0); }
  for (const edge of workflow.edges) {
    outdegree.set(edge.from, (outdegree.get(edge.from) ?? 0) + 1);
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
  }

  // Route nodes are routers, never endpoints
  const routeNodeIds = new Set(
    workflow.nodes.filter((n) => n.routePolicy != null).map((n) => n.id),
  );

  // DFS from each mainline candidate: can it reach another mainline node?
  const canReachMainline = new Set<string>();
  for (const nodeId of mainlineNodeIds) {
    const visited = new Set<string>();
    const stack = [...(successors.get(nodeId) ?? [])];
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (visited.has(current)) continue;
      visited.add(current);
      if (mainlineNodeIds.has(current)) {
        canReachMainline.add(nodeId);
        break;
      }
      for (const next of successors.get(current) ?? []) {
        if (!visited.has(next)) stack.push(next);
      }
    }
  }

  // A sink is a mainline node that:
  //   - cannot reach another mainline node (no downstream path)
  //   - is NOT a route node (routers forward to branches, not endpoints)
  const sinkNodes = [...mainlineNodeIds].filter(
    (id) => !canReachMainline.has(id) && !routeNodeIds.has(id),
  );

  // Orphans: disconnected nodes (no in/out edges at all) are not real sinks.
  // But if ALL candidates are orphans, treat them as valid (single-node case).
  const orphanIds = new Set(
    [...mainlineNodeIds].filter(
      (id) => (indegree.get(id) ?? 0) === 0 && (outdegree.get(id) ?? 0) === 0,
    ),
  );
  const allOrphans = orphanIds.size === mainlineNodeIds.size;

  const effectiveSinks = allOrphans
    ? sinkNodes // all candidates are orphans, keep as-is
    : sinkNodes.filter((id) => !orphanIds.has(id)); // exclude orphans

  if (effectiveSinks.length === 0) {
    return { ok: false, error: "invalid_workflow_output_config", detail: "无法推导唯一主线 sink 节点" };
  }
  if (effectiveSinks.length > 1) {
    return {
      ok: false,
      error: "invalid_workflow_output_config",
      detail: `存在多个主线 sink 节点: ${effectiveSinks.join(", ")}，请切换到 mode=explicit 并指定 nodeId`,
    };
  }
  return { ok: true };
};

export const validateWorkflowDefinition = (workflow: WorkflowDefinitionRuntime): WorkflowValidationResult =>
  validateWorkflowGraph(workflow);
