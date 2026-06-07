/**
 * Pure-functional branch determination rules.
 * No external dependencies, accepts only data parameters. Shared by workflow/validate and execution/dependency-check.
 */

/** Node scope cache: nodeId → scopeId (e.g. "router:a"), null means mainline. */
export type NodeScopeMap = Map<string, string | null>

// ====== Phase 2: Branch rules based on explicit branchScopeId ======

/**
 * Derive each node's branch scope from the workflow's route edges.
 * Scope identifier = routerNodeId:routeValue, e.g. "router:a".
 * Mainline nodes have null scope.
 */
export const computeNodeScopes = (
  nodes: Array<{ id: string }>,
  edges: Array<{ from: string; to: string; when: string | null }>,
  explicitScopes?: Map<string, string | null>,
): NodeScopeMap => {
  const scopes = new Map<string, string | null>()

  // Initialize: use explicit scope if provided, otherwise null
  for (const node of nodes) {
    scopes.set(node.id, explicitScopes?.get(node.id) ?? null)
  }

  // Derive scope from route edges: when from's scope is known, to's scope = fromScope != null ? fromScope : "from:when"
  for (const edge of edges) {
    if (edge.when === null) continue
    const fromScope = scopes.get(edge.from)
    const targetScope = fromScope != null ? fromScope : `${edge.from}:${edge.when}`
    const existing = scopes.get(edge.to)
    if (existing == null) {
      scopes.set(edge.to, targetScope)
    }
  }

  // Propagate scope along unconditional dependency edges: BFS ensures downstream nodes within the same branch inherit the upstream scope.
  // When multiple paths reach a node, merge if scopes agree; on conflict preserve the first-set scope.
  let changed = true
  while (changed) {
    changed = false
    for (const edge of edges) {
      if (edge.when !== null) continue // Only propagate unconditional dependency edges
      const fromScope = scopes.get(edge.from)
      if (fromScope == null) continue // Don't propagate if upstream has no scope
      const toScope = scopes.get(edge.to)
      if (toScope == null) {
        scopes.set(edge.to, fromScope)
        changed = true
      }
    }
  }

  return scopes
}

/**
 * Determine whether an edge is a cross-branch unconditional edge based on scope.
 * Cross-branch: when is null and from and to are in different scopes.
 */
export const isCrossBranchEdgeByScope = (
  edge: { from: string; to: string; when: string | null },
  nodeScopes: NodeScopeMap,
): boolean => {
  if (edge.when !== null) return false
  const fromScope = nodeScopes.get(edge.from) ?? null
  const toScope = nodeScopes.get(edge.to) ?? null
  // Same scope → within the same branch, allowed
  if (fromScope === toScope) return false
  // from has scope, to has no scope → branch node propagating to mainline, don't block (scope inherits along dependency edges)
  if (fromScope != null && toScope == null) return false
  // from has no scope (mainline), to has scope (branch) → forbidden: mainline cannot unconditionally depend on branch-internal nodes
  // from and to both have scope but different → forbidden: cross-branch dependency between different branches
  return fromScope !== toScope
}

/** Get a node's branch identity based on scope. null scope = mainline. */
export const getBranchScope = (nodeId: string, nodeScopes: NodeScopeMap): string | null =>
  nodeScopes.get(nodeId) ?? null
