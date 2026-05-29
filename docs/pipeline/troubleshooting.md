# Troubleshooting

## Scheduling Diagnostics

### API

```
GET /api/pipelines/:pipelineId/nodes/:nodeId/diagnostics?itemKey=xxx
```

Returns `DependencyDiagnostic[]`, explaining why each item run is in blocked/waiting/skipped state.

### CLI

```
taskmeld pipeline diagnose <pipelineId> <nodeId> [--item <itemKey>]
```

### Diagnostic Reason Codes

| ReasonCode | Meaning |
|------------|------|
| `dependency_satisfied` | Upstream dependency is satisfied |
| `source_not_success` | Upstream node is not yet successful (still running/blocked/queued) |
| `source_failed` | Upstream node execution failed |
| `source_skipped` | Upstream node was skipped |
| `route_mismatch` | Route value mismatch (source.route !== edge.when) |
| `cross_branch_edge_blocked` | Cross-branch normal edge is blocked |
| `group_not_success` | Upstream parallel group is not successful |
| `source_disabled_dependency_satisfied` | Upstream disabled node, normal edge treated as satisfied |
| `source_disabled_route_impossible` | Upstream disabled node, route edge cannot be satisfied |
| `missing_source_item_run` | Missing source node item run |
| `missing_group_item_run` | Missing parallel group item run |

### Code Entry Point

- `src/pipeline/diagnostics/dependency-diagnostic.ts`

---

## Common Issues

### Node Stuck in blocked State

1. Use the diagnostics API/CLI to inspect dependency status
2. Confirm all upstream nodes have reached success
3. Check if it is a parallel group member (member nodes must be launched through the group)
4. Check for cross-branch normal edges causing unsatisfiable dependencies

### Node Not Executing After Route Branching

1. Confirm the actual route values produced by the router node
2. Check if route edge `when` values match the produced values
3. Confirm that nodes not hitting any branch have status skipped (not blocked)

### Artifacts Not Propagating to Downstream

1. Check if the outgoing edge is a cross-branch edge (cross-branch edges are blocked)
2. Confirm the edge is a normal edge (not a route edge)
3. Check if the downstream item is on the correct itemKey

### Batch Run Stopping Midway

1. Check for hard failures (haltPipeline=true)
2. Check if the scheduler's maxGlobalIterations limit was reached
3. Check the batch controller status

### Parallel Group Not Executing

1. Confirm all member nodes of the group exist
2. Confirm the group's incoming edge dependencies are satisfied
3. Confirm groupItemRun has been initialized
4. Note that joinPolicy currently only supports "all"

### Scheduler Not Auto-Advancing

1. Check if the scheduler plugin is enabled (`plugins.scheduler.enabled`)
2. Check if the scheduler switch is on (`scheduler.enabled`)
3. Check the scheduling mode (manual mode requires manual tick)
4. Use `taskmeld scheduler toggle <id> --enabled <true|false>` to toggle the switch
