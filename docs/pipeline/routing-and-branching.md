# Route Branching and Branch Isolation

> Code entry points: `src/pipeline/execution/route-item-manager.ts`, `src/pipeline/execution/dependency-check.ts`, `src/pipeline/workflow-graph.ts` (isCrossBranchEdge), `src/pipeline/workflow/branch-rules.ts` (computeNodeScopes / isCrossBranchEdgeByScope)

## Normal Dependency Edge vs Route Edge

```
Normal dependency edge (when=null)     Route edge (when="route_a")
╔═══════╗                               ╔═══════╗
║  n1   ║                               ║  n5   ║ (router node)
║       ║────artifact propagation──►    ║       ║
╚═══╤═══╝                               ╚══╤═╤═╤╝
    │                                      │ │ │
    │  (unconditional)                     │ │ └── when="route_c" ──► n8
    ▼                                      │ └──── when="route_b" ──► n7
╔═══════╗                                  └────── when="route_a" ──► n6
║  n2   ║
╚═══════╝
```

## Readiness Evaluation Logic

The scheduler calls `markReadyItemsFromDependencies()` on each tick:

```
for each item in ItemRuns:
├── if node is disabled → skipped
├── if status is "running" | "success" | "failed" → skip
├── if status is sleep-waiting (wakeAt not reached) → skip
├── if node in parallel group → blocked
├── if no incoming edges → can promote to queued
└── else → resolveDependencyOutcome():
    ├── policy="all": All satisfied→queued, all impossible→skipped, else→waiting
    └── policy="any": Any satisfied→queued, all impossible→skipped, else→waiting
```

## Dependency Satisfaction Evaluation

`isDependencySatisfied(itemKey, edge)`:

```
1. if isCrossBranchEdge(edge) → return false
2. if edge.from is group → groupItemRun.status === "success"
3. if edge.from is disabled node → normal edge: true, route edge: false
4. else → source.status === "success"
   if edge.when → also requires source.route === edge.when
```

`canNeverSatisfy(itemKey, edge)`:

```
1. if isCrossBranchEdge(edge) → return true
2. if edge.from group → status === "failed" | "skipped"
3. if edge.from disabled → route edge: true
4. else → source.status === "failed" | "skipped"
   if success + edge.when + route mismatch → true
```

## Route Branching (applyEnvelopeOutcomeToItem)

```
Node execution succeeds (has envelope)
│
├── item.route = null (clear old route value)
│
├── Router node (routePolicy.allowed non-empty)?
│   ├── Clear old derived itemRuns (clearDerivedRouteItemRuns)
│   ├── Collect route buckets
│   └── for each bucket:
│       ├── Build derived itemKey: {parentItemKey}::{nodeId}:{route}
│       ├── initializeDerivedRouteItemKey
│       │   ├── Hit branch: Reset initial state (queued)
│       │   ├── No branch hit: skipped
│       │   └── Ancestor path: Copy state from source item
│       └── Advance downstream along matched route edges
│
├── sleepUntil → item.status = "waiting" (when wakeAt not reached)
│
└── Non-router node (suppressOutgoing not set):
    └── Advance downstream along normal edges
        ├── Skip route edges (edge.when !== null)
        └── Skip cross-branch edges (isCrossBranchEdge)
```

## Derived itemKey

Format: `{parentItemKey}::{nodeId}:{route}`

- On retry, old derivations are cleaned up by prefix matching (`{itemKey}::{nodeId}:`)
- Each route creates an independent item run, without interference

## Branch Node Isolation

### Branch Nodes and Scope Determination

Branch determination uses the Phase 2 **scope propagation algorithm** (`computeNodeScopes`):

1. Derive to-scope from the route edge's from (via `from:when` or inheriting upstream scope)
2. BFS-propagate scope along normal dependency edges to downstream nodes in the same branch
3. scope non-null → branch node, scope is null → mainline node

```typescript
// Actual implementation in workflow-graph.ts
const isBranchNode = (nodeId: string) => {
  const scope = indices.nodeScopes.get(nodeId);
  return scope != null;
};
```

### Cross-Branch Edge Determination

Based on scope comparison (`isCrossBranchEdgeByScope`): unconditional edge (when === null), and from and to are in different scopes.

Determination rules:

| from scope | to scope | Cross-branch? |
|-----------|----------|---------|
| null | null | No — both are mainline |
| S | S | No — same branch |
| S | null | No — branch propagates to mainline |
| null | S | **Yes** — mainline cannot unconditionally depend on branch |
| S1 | S2 | **Yes** — between different branches |

### Blocking Points

| Location | File | Effect |
|------|------|------|
| Dependency satisfaction check | `dependency-check.ts` → `isDependencySatisfied()` | Cross-branch normal dependency not satisfied |
| Dependency satisfiability check | `dependency-check.ts` → `canNeverSatisfy()` | Cross-branch normal dependency never satisfiable |
| Artifact propagation | `route-item-manager.ts` → `applyEnvelopeOutcomeToItem()` | Branch nodes do not propagate along cross-branch edges |

### Effect

```
Router n5 ──(route:web)──► branch n6    branch n7
          ──(route:mobile)──────────► branch n7
                              ↓              ↓
                          Independent    Independent
                          execution      execution
                          (no cross-     (no cross-
                           artifact)      artifact)
```
