import { computeNodeScopes, isCrossBranchEdgeByScope } from "./branch-rules"
import { DEFAULT_BRANCH_ROUTE_VALUE, MAINLINE_ROUTE_VALUE } from "./routes"
import type { WorkflowDefinitionRuntime, WorkflowValidationResult } from "../types/workflow"

// ====== Validation ======

export const validateWorkflowGraph = (workflow: WorkflowDefinitionRuntime): WorkflowValidationResult => {
  if (workflow.nodes.length === 0) {
    return workflow.edges.length === 0 && workflow.groups.length === 0
      ? { ok: true }
      : {
          ok: false,
          error: "invalid_workflow_definition",
          detail:
            "An empty workflow cannot have edges or groups. Remove all edges and groups, or add at least one node.",
        }
  }
  const nodeIds = new Set(workflow.nodes.map((node) => node.id))
  if (nodeIds.size !== workflow.nodes.length) {
    return {
      ok: false,
      error: "invalid_workflow_definition",
      detail: "Duplicate node IDs detected. Each node must have a unique ID.",
    }
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
        detail: `Edge ${edge.from} -> ${edge.to} references a node or group that does not exist. Fix the edge endpoints or create the missing entity first.`,
      }
    }
    if (edge.from === edge.to) {
      return {
        ok: false,
        error: "invalid_workflow_definition",
        detail: `Self-loop detected on ${edge.from}: a node cannot depend on itself. Remove this edge.`,
      }
    }
    const key = `${edge.from}|${edge.when ?? ""}|${edge.to}`
    if (edgeDedupe.has(key)) {
      return {
        ok: false,
        error: "invalid_workflow_definition",
        detail: `Duplicate edge: ${edge.from} -> ${edge.to}. Each connection between two entities must be unique.`,
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
    return {
      ok: false,
      error: "mixed_outgoing_edge_kinds_forbidden",
      detail: `Node "${sourceId}" has both dependency (unconditional) and route (conditional) outgoing edges, but it is not a routing node. This would cause the node to execute unconditionally AND conditionally, leading to double execution. Either: (1) remove the route edges, (2) remove the dependency edge, or (3) enable routePolicy on this node to make it a routing node.`,
    }
  }

  // Cross-branch edge detection
  {
    const explicitScopes = new Map<string, string | null>()
    const mergeNodeIds = new Set<string>()
    for (const node of workflow.nodes) {
      if (node.branchScopeId != null) {
        explicitScopes.set(node.id, node.branchScopeId)
      }
      if (node.dependencyPolicy && node.dependencyPolicy !== "all") {
        mergeNodeIds.add(node.id)
      }
    }
    const nodeScopes = computeNodeScopes(workflow.nodes, workflow.edges, explicitScopes)
    for (const nodeId of mergeNodeIds) {
      nodeScopes.set(nodeId, null)
    }

    const scopeCrossEdges = workflow.edges.filter((edge) => isCrossBranchEdgeByScope(edge, nodeScopes))
    if (scopeCrossEdges.length > 0) {
      const edge = scopeCrossEdges[0]
      const fromScope = nodeScopes.get(edge.from) ?? "main"
      const toScope = nodeScopes.get(edge.to) ?? "main"
      return {
        ok: false,
        error: "cross_branch_edge_forbidden",
        detail: `Cross-branch dependency edge detected: "${edge.from}" (branch: ${fromScope}) -> "${edge.to}" (branch: ${toScope}). Unconditional edges cannot cross branch boundaries because branches execute conditionally. To connect branches, either: (1) use a merge node with dependencyPolicy="any", or (2) route both branches to a common downstream node.`,
      }
    }
  }

  const uniqueGroupIds = new Set<string>()
  const explicitGroupById = new Map(workflow.groups.map((group) => [group.id, group]))
  for (const group of workflow.groups) {
    if (uniqueGroupIds.has(group.id)) {
      return {
        ok: false,
        error: "invalid_workflow_definition",
        detail: `Duplicate parallel group ID: "${group.id}". Each group must have a unique ID.`,
      }
    }
    uniqueGroupIds.add(group.id)

    for (const member of group.members) {
      if (!nodeIds.has(member)) {
        return {
          ok: false,
          error: "invalid_workflow_definition",
          detail: `Parallel group "${group.id}" lists member "${member}" which does not exist as a node. Remove this member or create the node first.`,
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
        detail: `Node "${node.id}" declares it belongs to parallel group "${groupId}", but that group does not exist. Remove the parallelGroupId or create the group.`,
      }
    if (!group.members.includes(node.id)) {
      return {
        ok: false,
        error: "invalid_workflow_definition",
        detail: `Node "${node.id}" declares it belongs to parallel group "${groupId}", but the group's member list does not include it. Add "${node.id}" to the group's members, or clear the node's parallelGroupId.`,
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
          detail: `Parallel group "${group.id}" has a direct dependency edge to its member "${edge.to}". Instead, connect to the group entity itself — the group handles distributing work to its members. Remove this edge and add an edge from the upstream to the group.`,
        }
      if (memberSet.has(edge.from))
        return {
          ok: false,
          error: "invalid_workflow_definition",
          detail: `Direct dependency detected between members of parallel group "${group.id}": "${edge.from}" -> "${edge.to}". Members of a parallel group execute concurrently and cannot depend on each other. Remove this edge.`,
        }
      if (groupIncoming.has(edge.from))
        return {
          ok: false,
          error: "invalid_workflow_definition",
          detail: `The upstream node "${edge.from}" has a direct dependency to group member "${edge.to}" instead of to the group "${group.id}". Connect to the group entity — it handles distributing work to members. Remove this edge and add an edge from "${edge.from}" to "${group.id}".`,
        }
    }
  }

  for (const group of workflow.groups) {
    if (group.joinPolicy !== "all") {
      return {
        ok: false,
        error: "join_policy_not_supported",
        detail: `Parallel group "${group.id}" uses joinPolicy "${group.joinPolicy}", which is not implemented. Change joinPolicy to "all" — all members must complete before the group proceeds.`,
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
          detail: `Routing node "${node.id}" has ${allowed.length} route(s), but must have between 2 and 5 (including "yes" and "no"). Add or remove routes to meet this requirement.`,
        }
      }
      if (!allowed.includes(MAINLINE_ROUTE_VALUE) || !allowed.includes(DEFAULT_BRANCH_ROUTE_VALUE)) {
        return {
          ok: false,
          error: "invalid_workflow_definition",
          detail: `Routing node "${node.id}" is missing required routes. Every routing node must include "yes" (continue on mainline) and "no" (take default branch) in its allowed routes.`,
        }
      }
      const outgoingEdges = edgesBySource.get(node.id) ?? []
      const dependencyEdges = outgoingEdges.filter((edge) => edge.when === null)
      if (dependencyEdges.length > 1) {
        return {
          ok: false,
          error: "invalid_workflow_definition",
          detail: `Routing node "${node.id}" has ${dependencyEdges.length} unconditional (dependency) outgoing edges, but can have at most 1. The single unconditional edge represents the "yes" (mainline) path. Remove the extra dependency edges.`,
        }
      }
      const routeEdgeCounts = new Map<string, number>()
      for (const edge of outgoingEdges.filter((item) => item.when !== null)) {
        routeEdgeCounts.set(edge.when ?? "", (routeEdgeCounts.get(edge.when ?? "") ?? 0) + 1)
        if (edge.when === MAINLINE_ROUTE_VALUE) {
          return {
            ok: false,
            error: "invalid_workflow_definition",
            detail: `Routing node "${node.id}" has "yes" as a route edge. The "yes" (mainline) path must be an unconditional dependency edge (when=null), not a route edge. Change this edge's when to null.`,
          }
        }
        if (!allowed.includes(edge.when ?? "")) {
          return {
            ok: false,
            error: "invalid_workflow_definition",
            detail: `Routing node "${node.id}" has an edge with route "${edge.when}", but this route is not in its allowed list [${allowed.join(", ")}]. Either add "${edge.when}" to the allowed routes, or remove this edge.`,
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
            detail: `Routing node "${node.id}" route "${edge.when}" points to "${edge.to}", which is a mainline node. Route edges must target branch nodes or branch-only parallel groups. Change "${edge.to}"'s lane to "branch", or point this route to a different branch node.`,
          }
        }
      }
      for (const route of allowed.filter((item) => item !== MAINLINE_ROUTE_VALUE)) {
        if ((routeEdgeCounts.get(route) ?? 0) !== 1) {
          return {
            ok: false,
            error: "invalid_workflow_definition",
            detail: `Routing node "${node.id}" route "${route}" has ${routeEdgeCounts.get(route) ?? 0} target(s), but each route must have exactly 1 branch target. Add an edge from "${node.id}" to a branch node with when="${route}".`,
          }
        }
      }
    }
    if (node.dependencyPolicy !== undefined && node.dependencyPolicy !== "all" && node.dependencyPolicy !== "any") {
      return {
        ok: false,
        error: "invalid_workflow_definition",
        detail: `Node "${node.id}" has invalid dependencyPolicy "${node.dependencyPolicy}". Valid values are "all" (wait for all upstream) or "any" (proceed when any upstream completes).`,
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
      detail:
        "Dependency cycle detected: one or more nodes form a circular dependency chain. The pipeline cannot execute because execution order is ambiguous. Break the cycle by removing one of the edges in the loop.",
    }
  }

  return { ok: true }
}

export const validateWorkflowOutputConfig = (workflow: WorkflowDefinitionRuntime): WorkflowValidationResult => {
  const output = workflow.output ?? { mode: "mainline_last" as const, nodeId: null }
  if (workflow.nodes.length === 0) {
    return output.mode === "explicit" && output.nodeId
      ? {
          ok: false,
          error: "invalid_workflow_output_config",
          detail:
            'Output mode is "explicit" with nodeId set, but the workflow has no nodes. Remove the output config or add nodes.',
        }
      : { ok: true }
  }
  if (output.mode === "explicit") {
    if (!output.nodeId) {
      return {
        ok: false,
        error: "invalid_workflow_output_config",
        detail:
          'Output mode is "explicit" but no nodeId is specified. Set output.nodeId to the ID of the node whose result should be the pipeline\'s final output.',
      }
    }
    const node = workflow.nodes.find((n) => n.id === output.nodeId)
    if (!node) {
      return {
        ok: false,
        error: "invalid_workflow_output_config",
        detail: `Output node "${output.nodeId}" does not exist in the workflow. Change output.nodeId to an existing node, or create the node first.`,
      }
    }
    if (!node.enabled) {
      return {
        ok: false,
        error: "invalid_workflow_output_config",
        detail: `Output node "${output.nodeId}" is disabled. A disabled node cannot produce output. Enable the node, or change output.nodeId to an enabled node.`,
      }
    }
    if (node.lane !== "main") {
      return {
        ok: false,
        error: "invalid_workflow_output_config",
        detail: `Output node "${output.nodeId}" is a branch node, but only mainline nodes can be pipeline outputs. Change the node's lane to "main", or select a different output node.`,
      }
    }
    if (node.branchScopeId) {
      return {
        ok: false,
        error: "invalid_workflow_output_config",
        detail: `Output node "${output.nodeId}" belongs to a branch scope and cannot be used as a pipeline output. Select a mainline node that is not inside a branch scope.`,
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
    return {
      ok: false,
      error: "invalid_workflow_output_config",
      detail:
        'No enabled mainline nodes exist. The pipeline needs at least one enabled mainline node to produce output. Enable an existing node or change a branch node\'s lane to "main".',
    }
  }

  const allNodeIds = new Set(workflow.nodes.map((n) => n.id))
  const successors = new Map<string, string[]>()
  for (const id of allNodeIds) successors.set(id, [])
  for (const edge of workflow.edges) {
    const list = successors.get(edge.from)
    if (list) list.push(edge.to)
  }

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

  const routeNodeIds = new Set(workflow.nodes.filter((n) => n.routePolicy != null).map((n) => n.id))

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

  const sinkNodes = [...mainlineNodeIds].filter((id) => !canReachMainline.has(id) && !routeNodeIds.has(id))

  const orphanIds = new Set(
    [...mainlineNodeIds].filter((id) => (indegree.get(id) ?? 0) === 0 && (outdegree.get(id) ?? 0) === 0),
  )
  const allOrphans = orphanIds.size === mainlineNodeIds.size

  const effectiveSinks = allOrphans ? sinkNodes : sinkNodes.filter((id) => !orphanIds.has(id))

  if (effectiveSinks.length === 0) {
    return {
      ok: false,
      error: "invalid_workflow_output_config",
      detail:
        "Cannot determine the pipeline's output node: all mainline nodes are part of a dependency chain with no clear endpoint. Ensure at least one mainline node is not depended on by other mainline nodes (i.e., it is the final step).",
    }
  }
  if (effectiveSinks.length > 1) {
    const sinkIds = effectiveSinks.map((id) => `"${id}"`).join(", ")
    return {
      ok: false,
      error: "invalid_workflow_output_config",
      detail: `Multiple mainline nodes have no downstream dependencies: ${sinkIds}. The system cannot determine which one produces the final output. Add a dependency edge between them (e.g. make one depend on the other) so only one node is the pipeline's last step.`,
    }
  }
  return { ok: true }
}
