import { computeNodeScopes, isCrossBranchEdgeByScope } from "./branch-rules"
import { DEFAULT_BRANCH_ROUTE_VALUE, MAINLINE_ROUTE_VALUE } from "./routes"
import type { WorkflowDefinitionRuntime, WorkflowValidationResult } from "../types/workflow"

// ====== Validation ======

export const validateWorkflowGraph = (workflow: WorkflowDefinitionRuntime): WorkflowValidationResult => {
  if (workflow.nodes.length === 0) {
    return workflow.edges.length === 0 && workflow.groups.length === 0
      ? { ok: true }
      : { ok: false, error: "invalid_workflow_definition", detail: "Empty workflow cannot contain edges or groups" }
  }
  const nodeIds = new Set(workflow.nodes.map((node) => node.id))
  if (nodeIds.size !== workflow.nodes.length) {
    return { ok: false, error: "invalid_workflow_definition", detail: "workflow.nodes contains duplicate IDs" }
  }
  const groupIds = new Set(workflow.groups.map((group) => group.id))
  const entityIds = new Set<string>([...nodeIds, ...groupIds])

  const outgoing = new Map<string, string[]>()
  const indegree = new Map<string, number>()
  for (const node of workflow.nodes) {
    outgoing.set(node.id, [])
    indegree.set(node.id, 0)
  }
  for (const group of workflow.groups) {
    outgoing.set(group.id, [])
    indegree.set(group.id, 0)
  }

  const edgeDedupe = new Set<string>()
  for (const edge of workflow.edges) {
    if (!entityIds.has(edge.from) || !entityIds.has(edge.to)) {
      return {
        ok: false,
        error: "invalid_workflow_definition",
        detail: `Edge references non-existent entity: ${edge.from} -> ${edge.to}`,
      }
    }
    if (edge.from === edge.to) {
      return {
        ok: false,
        error: "invalid_workflow_definition",
        detail: `Self-loop edge detected: ${edge.from} -> ${edge.to}`,
      }
    }
    const key = `${edge.from}|${edge.when ?? ""}|${edge.to}`
    if (edgeDedupe.has(key)) {
      return {
        ok: false,
        error: "invalid_workflow_definition",
        detail: `Duplicate edge detected: ${edge.from} -> ${edge.to}`,
      }
    }
    edgeDedupe.add(key)
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to])
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1)
  }

  const outgoingKindsBySource = new Map<string, Set<"dependency" | "route">>()
  const edgesBySource = new Map<string, Array<{ from: string; to: string; when: string | null }>>()
  for (const edge of workflow.edges) {
    const kind: "dependency" | "route" = edge.when === null ? "dependency" : "route"
    const kinds = outgoingKindsBySource.get(edge.from) ?? new Set<"dependency" | "route">()
    kinds.add(kind)
    outgoingKindsBySource.set(edge.from, kinds)
    edgesBySource.set(edge.from, [...(edgesBySource.get(edge.from) ?? []), edge])
  }
  for (const [sourceId, kinds] of outgoingKindsBySource.entries()) {
    if (kinds.size <= 1) continue
    const sourceNode = workflow.nodes.find((node) => node.id === sourceId)
    if (sourceNode?.routePolicy) continue
    // Non-routing nodes are still forbidden from mixing dependency and route edges on the same node, to prevent unconditional passthrough leading to double execution.
    return {
      ok: false,
      error: "mixed_outgoing_edge_kinds_forbidden",
      detail: `Node ${sourceId} has both dependency and route outgoing edges, which is not allowed`,
    }
  }

  // Phase 2: Cross-branch edge detection based on explicit scope.
  // computeNodeScopes + isCrossBranchEdgeByScope use explicit branchScopeId (derived from route edges when missing).
  {
    const explicitScopes = new Map<string, string | null>()
    const mergeNodeIds = new Set<string>()
    for (const node of workflow.nodes) {
      if (node.branchScopeId != null) {
        explicitScopes.set(node.id, node.branchScopeId)
      }
      // merge nodes (dependencyPolicy !== "all") are explicit branch convergence points, accepting dependency edges from different scopes
      if (node.dependencyPolicy && node.dependencyPolicy !== "all") {
        mergeNodeIds.add(node.id)
      }
    }
    const nodeScopes = computeNodeScopes(workflow.nodes, workflow.edges, explicitScopes)
    // Clear scope for merge nodes to avoid them being misjudged as cross-branch (consistent with buildIndices in workflow-graph.ts)
    for (const nodeId of mergeNodeIds) {
      nodeScopes.set(nodeId, null)
    }

    const scopeCrossEdges = workflow.edges.filter((edge) => isCrossBranchEdgeByScope(edge, nodeScopes))
    if (scopeCrossEdges.length > 0) {
      return {
        ok: false,
        error: "cross_branch_edge_forbidden",
        detail: `Cross-branch unconditional edge is not allowed: ${scopeCrossEdges[0].from} -> ${scopeCrossEdges[0].to} (from branch ${nodeScopes.get(scopeCrossEdges[0].from) ?? "main"} -> to branch ${nodeScopes.get(scopeCrossEdges[0].to) ?? "main"}, cross-branch dependency edges require an explicit merge node)`,
      }
    }
  }

  const uniqueGroupIds = new Set<string>()
  const explicitGroupById = new Map(workflow.groups.map((group) => [group.id, group]))
  for (const group of workflow.groups) {
    if (uniqueGroupIds.has(group.id)) {
      return { ok: false, error: "invalid_workflow_definition", detail: `Duplicate parallel group ID: ${group.id}` }
    }
    uniqueGroupIds.add(group.id)

    for (const member of group.members) {
      if (!nodeIds.has(member)) {
        return {
          ok: false,
          error: "invalid_workflow_definition",
          detail: `Parallel group ${group.id} references non-existent member ${member}`,
        }
      }
    }
  }

  for (const node of workflow.nodes) {
    const groupId = node.parallelGroupId?.trim()
    if (!groupId) continue
    const group = explicitGroupById.get(groupId)
    if (!group)
      return {
        ok: false,
        error: "invalid_workflow_definition",
        detail: `Node ${node.id} references non-existent parallel group ${groupId}`,
      }
    if (!group.members.includes(node.id)) {
      return {
        ok: false,
        error: "invalid_workflow_definition",
        detail: `Node ${node.id} is not a member of its declared parallel group ${groupId}`,
      }
    }
  }

  for (const group of workflow.groups) {
    const memberSet = new Set(group.members)
    const groupIncoming = new Set(workflow.edges.filter((edge) => edge.to === group.id).map((edge) => edge.from))

    for (const edge of workflow.edges) {
      if (edge.when !== null) continue
      if (!memberSet.has(edge.to)) continue
      if (edge.to === group.id) continue
      if (edge.from === group.id)
        return {
          ok: false,
          error: "invalid_workflow_definition",
          detail: `Parallel group ${group.id} cannot directly connect to member nodes`,
        }
      if (memberSet.has(edge.from))
        return {
          ok: false,
          error: "invalid_workflow_definition",
          detail: `Direct dependencies between members of parallel group ${group.id} are not allowed`,
        }
      if (groupIncoming.has(edge.from))
        return {
          ok: false,
          error: "invalid_workflow_definition",
          detail: `The entry node of parallel group ${group.id} cannot directly connect to members`,
        }
    }
  }

  for (const group of workflow.groups) {
    // joinPolicy only supports "all"; any/quorum are not implemented at runtime, explicitly reject on save
    if (group.joinPolicy !== "all") {
      return {
        ok: false,
        error: "join_policy_not_supported",
        detail: `Parallel group ${group.id} has unsupported joinPolicy "${group.joinPolicy}", only "all" is currently supported`,
      }
    }
  }

  for (const node of workflow.nodes) {
    if (node.routePolicy) {
      const { allowed } = node.routePolicy
      if (allowed.length < 2 || allowed.length > 5) {
        return {
          ok: false,
          error: "invalid_workflow_definition",
          detail: `Node ${node.id} has an invalid route set size`,
        }
      }
      if (!allowed.includes(MAINLINE_ROUTE_VALUE) || !allowed.includes(DEFAULT_BRANCH_ROUTE_VALUE)) {
        return {
          ok: false,
          error: "invalid_workflow_definition",
          detail: `Node ${node.id} must include "yes" and "no" routes when routing is enabled`,
        }
      }
      const outgoingEdges = edgesBySource.get(node.id) ?? []
      const dependencyEdges = outgoingEdges.filter((edge) => edge.when === null)
      if (dependencyEdges.length > 1) {
        return {
          ok: false,
          error: "invalid_workflow_definition",
          detail: `Node ${node.id} can have at most 1 "yes" mainline dependency edge`,
        }
      }
      const routeEdgeCounts = new Map<string, number>()
      for (const edge of outgoingEdges.filter((item) => item.when !== null)) {
        routeEdgeCounts.set(edge.when ?? "", (routeEdgeCounts.get(edge.when ?? "") ?? 0) + 1)
        if (edge.when === MAINLINE_ROUTE_VALUE) {
          return {
            ok: false,
            error: "invalid_workflow_definition",
            detail: `Node ${node.id} cannot save "yes" as a route edge`,
          }
        }
        if (!allowed.includes(edge.when ?? "")) {
          return {
            ok: false,
            error: "invalid_workflow_definition",
            detail: `Node ${node.id} has an undeclared route edge: ${edge.when}`,
          }
        }
        const targetNode = workflow.nodes.find((candidate) => candidate.id === edge.to)
        const targetGroup = workflow.groups.find((group) => group.id === edge.to)
        const targetGroupMembers = targetGroup
          ? targetGroup.members
              .map((memberId) => workflow.nodes.find((candidate) => candidate.id === memberId))
              .filter(Boolean)
          : []
        const isBranchTarget =
          targetNode?.lane === "branch" ||
          (targetGroupMembers.length > 0 && targetGroupMembers.every((member) => member?.lane === "branch"))
        if (!isBranchTarget) {
          return {
            ok: false,
            error: "invalid_workflow_definition",
            detail: `Node ${node.id} route "${edge.when}" can only target branch nodes or branch parallel groups`,
          }
        }
      }
      for (const route of allowed.filter((item) => item !== MAINLINE_ROUTE_VALUE)) {
        if ((routeEdgeCounts.get(route) ?? 0) !== 1) {
          return {
            ok: false,
            error: "invalid_workflow_definition",
            detail: `Node ${node.id} route "${route}" must have exactly 1 branch target`,
          }
        }
      }
    }
    if (node.dependencyPolicy !== undefined && node.dependencyPolicy !== "all" && node.dependencyPolicy !== "any") {
      return {
        ok: false,
        error: "invalid_workflow_definition",
        detail: `Node ${node.id} has an invalid dependencyPolicy`,
      }
    }
  }

  const queue = [...[...entityIds].filter((id) => (indegree.get(id) ?? 0) === 0)]
  let visited = 0
  while (queue.length > 0) {
    const nodeId = queue.shift()!
    visited += 1
    for (const nextId of outgoing.get(nodeId) ?? []) {
      const nextDegree = (indegree.get(nextId) ?? 0) - 1
      indegree.set(nextId, nextDegree)
      if (nextDegree === 0) {
        queue.push(nextId)
      }
    }
  }

  if (visited !== entityIds.size) {
    return {
      ok: false,
      error: "invalid_workflow_definition",
      detail: "Workflow contains a cycle, cannot perform topological sort",
    }
  }

  return { ok: true }
}

export const validateWorkflowOutputConfig = (workflow: WorkflowDefinitionRuntime): WorkflowValidationResult => {
  const output = workflow.output ?? { mode: "mainline_last" as const, nodeId: null }
  if (workflow.nodes.length === 0) {
    return output.mode === "explicit" && output.nodeId
      ? { ok: false, error: "invalid_workflow_output_config", detail: "Empty workflow cannot specify an output node" }
      : { ok: true }
  }
  if (output.mode === "explicit") {
    if (!output.nodeId) {
      return { ok: false, error: "invalid_workflow_output_config", detail: "nodeId is required when mode=explicit" }
    }
    const node = workflow.nodes.find((n) => n.id === output.nodeId)
    if (!node) {
      return {
        ok: false,
        error: "invalid_workflow_output_config",
        detail: `Output node ${output.nodeId} does not exist`,
      }
    }
    if (!node.enabled) {
      return {
        ok: false,
        error: "invalid_workflow_output_config",
        detail: `Output node ${output.nodeId} must be enabled`,
      }
    }
    if (node.lane !== "main") {
      return {
        ok: false,
        error: "invalid_workflow_output_config",
        detail: `Output node ${output.nodeId} must be a mainline node`,
      }
    }
    if (node.branchScopeId) {
      return {
        ok: false,
        error: "invalid_workflow_output_config",
        detail: `Output node ${output.nodeId} cannot belong to a branch scope`,
      }
    }
    return { ok: true }
  }

  // mode === "mainline_last" — auto-derive unique mainline sink via reachability
  const mainlineNodeIds = new Set(
    workflow.nodes
      .filter((n) => n.enabled && n.lane === "main" && !n.branchScopeId && !n.routeSourceNodeId && !n.routeValue)
      .map((n) => n.id),
  )

  if (mainlineNodeIds.size === 0) {
    return { ok: false, error: "invalid_workflow_output_config", detail: "No available mainline nodes" }
  }

  // Build full adjacency (all nodes, all edges) for reachability DFS
  const allNodeIds = new Set(workflow.nodes.map((n) => n.id))
  const successors = new Map<string, string[]>()
  for (const id of allNodeIds) successors.set(id, [])
  for (const edge of workflow.edges) {
    const list = successors.get(edge.from)
    if (list) list.push(edge.to)
  }

  // Build indegree/outdegree in full graph (used for orphan detection)
  const indegree = new Map<string, number>()
  const outdegree = new Map<string, number>()
  for (const id of allNodeIds) {
    indegree.set(id, 0)
    outdegree.set(id, 0)
  }
  for (const edge of workflow.edges) {
    outdegree.set(edge.from, (outdegree.get(edge.from) ?? 0) + 1)
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1)
  }

  // Route nodes are routers, never endpoints
  const routeNodeIds = new Set(workflow.nodes.filter((n) => n.routePolicy != null).map((n) => n.id))

  // DFS from each mainline candidate: can it reach another mainline node?
  const canReachMainline = new Set<string>()
  for (const nodeId of mainlineNodeIds) {
    const visited = new Set<string>()
    const stack = [...(successors.get(nodeId) ?? [])]
    while (stack.length > 0) {
      const current = stack.pop()!
      if (visited.has(current)) continue
      visited.add(current)
      if (mainlineNodeIds.has(current)) {
        canReachMainline.add(nodeId)
        break
      }
      for (const next of successors.get(current) ?? []) {
        if (!visited.has(next)) stack.push(next)
      }
    }
  }

  // A sink is a mainline node that:
  //   - cannot reach another mainline node (no downstream path)
  //   - is NOT a route node (routers forward to branches, not endpoints)
  const sinkNodes = [...mainlineNodeIds].filter((id) => !canReachMainline.has(id) && !routeNodeIds.has(id))

  // Orphans: disconnected nodes (no in/out edges at all) are not real sinks.
  // But if ALL candidates are orphans, treat them as valid (single-node case).
  const orphanIds = new Set(
    [...mainlineNodeIds].filter((id) => (indegree.get(id) ?? 0) === 0 && (outdegree.get(id) ?? 0) === 0),
  )
  const allOrphans = orphanIds.size === mainlineNodeIds.size

  const effectiveSinks = allOrphans
    ? sinkNodes // all candidates are orphans, keep as-is
    : sinkNodes.filter((id) => !orphanIds.has(id)) // exclude orphans

  if (effectiveSinks.length === 0) {
    return { ok: false, error: "invalid_workflow_output_config", detail: "Cannot derive a unique mainline sink node" }
  }
  if (effectiveSinks.length > 1) {
    return {
      ok: false,
      error: "invalid_workflow_output_config",
      detail: `Multiple mainline sink nodes found: ${effectiveSinks.join(", ")}, switch to mode=explicit and specify nodeId`,
    }
  }
  return { ok: true }
}
