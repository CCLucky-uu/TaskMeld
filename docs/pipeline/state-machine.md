# State Machine

> Authoritative code entry point for state transitions: `src/pipeline/state-machine.ts` (VALID_TRANSITIONS + transitionStatus), `src/pipeline/state/` (markItem* / markNode* / markGroupItem* / markGroup* API).
>
> State transitions are gated by `StateTransitionCommand`: `execute`, `dependency`, `sleep`, `retry_reset`, `reject_reset`, `route_backfill`, `group_aggregate`.

## Pipeline-Level (Run) State

```
                    ┌──────────────┐
         seedRun    │   running    │
      ────────────► │              │
                    └───┬──────┬──┘
                        │      │
    All nodes+groups    │      │  Any node/group
    success/skipped     │      │  failed
                        │      │
                        ▼      ▼
                 ┌──────────┐  ┌──────────┐
                 │ success  │  │  failed  │
                 └──────────┘  └──────────┘
```

## Node-Level (NodeItemRun) State

```
                         seedItemRun
                              │
                              ▼
                    ┌──────────────────┐
                    │     blocked      │  (has unsatisfied dependencies)
                    └────────┬─────────┘
                             │ All dependencies satisfied
                             ▼
                    ┌──────────────────┐
           ┌───────│     queued       │  (ready, waiting for scheduler to pick)
           │        └────────┬─────────┘
           │                 │ executeNodeItem()
           │                 ▼
           │        ┌──────────────────┐
           │        │    running       │  (executing, attempt++)
           │        └──┬──┬──┬────┬────┘
           │           │  │  │    │
           │  success  │  │  │    │  timeout/exception
           │           │  │  │    │
           │           ▼  ▼  ▼    ▼
           │     ┌──────┐ ┌──────┐ ┌──────────┐
           │     │success│ │failed│ │ rejected │
           │     └──┬───┘ └──┬───┘ └─────┬────┘
           │        │        │            │
           │        │        │            │
           │        ▼        ▼            ▼
           │     ┌────────────────────────────┐
           └────►│         waiting            │  (sleepUntil / dependency-outcome)
                 └────────────┬───────────────┘
                              │ wakeAt expired / dependency satisfied
                              ▼
                      ┌──────────────┐
                      │ queued/success│
                      └──────────────┘

                       skipped      node disabled or dependency unsatisfiable
```

Path descriptions:
- `blocked → queued → running → success | failed | rejected` — Normal execution path
- `running → waiting` — Execution paused via `sleepUntil`
- `success | failed | rejected → waiting` — Envelope `control.sleepUntil` delay
- `waiting → success` — Sleep expired, wake up
- `waiting → queued` — Dependency satisfied, wake into ready queue
- `queued | blocked → skipped` — Disabled or dependency can never be satisfied

## Parallel Group (GroupRun / GroupItemRun) State

GroupRun reuses `NodeRunStatus` (8 states). Aggregation logic drives transitions via the `group_aggregate` command:

```
blocked → queued → running → success
                    ↓        → failed
                 waiting
```

The `markGroup*` and `markGroupItem*` family of functions cover the main execution path states (queued/running/success/failed/blocked/waiting), excluding `rejected`/`skipped` variants (groups do not need these two states).

## State Priority (for Aggregation)

| Status | Priority |
|------|--------|
| failed | 100 |
| running | 90 |
| rejected | 80 |
| waiting | 70 |
| queued | 60 |
| blocked | 50 |
| success | 40 |
| skipped | 30 |

When multiple item runs aggregate into a NodeRun, the highest-priority state is taken.
When `itemRuns` is empty, the aggregated result is `blocked`.

## Valid Transition Table

Complete transition definitions are in `src/pipeline/state-machine.ts` `VALID_TRANSITIONS`, gated by `StateTransitionCommand`:

| Source State | execute | dependency | sleep | retry_reset | route_backfill |
|--------|---------|------------|-------|-------------|----------------|
| queued | running, failed | waiting, blocked, skipped | — | queued | running, success, failed, rejected, waiting, skipped, blocked |
| running | success, failed, rejected, waiting | — | — | queued, blocked, skipped | — |
| waiting | — | queued, skipped, blocked | success | queued | — |
| blocked | — | queued, waiting, skipped | — | queued, skipped | running, success, failed, rejected, skipped, queued, waiting, blocked |
| success | — | queued, blocked, skipped | waiting | queued, blocked, skipped | success, running, failed, rejected, queued, blocked, skipped, waiting |
| failed | — | queued, blocked, skipped | waiting | queued, blocked, running | success |
| rejected | — | queued, blocked, skipped | waiting | queued, blocked | success |
| skipped | — | queued, blocked | — | queued, blocked | running, success, failed, rejected, queued, blocked, skipped, waiting |

> `reject_reset` allowed transitions are similar to `retry_reset` (excluding `failed → running`). `group_aggregate` allows a wider range of transitions for group aggregation.

## State Machine API

Code entry point: `src/pipeline/state/index.ts`

Unified state transition functions replace direct `status =` assignment:

```ts
// NodeItemRun series (8 functions)
markItemQueued(item, ctx)   // → queued
markItemRunning(item, ctx)  // → running, attempt++, startedAt, clear finishedAt/lastError/wakeAt
markItemSuccess(item, ctx)  // → success, finishedAt, clear lastError
markItemFailed(item, ctx)   // → failed, finishedAt, lastError
markItemRejected(item, ctx) // → rejected, finishedAt, lastError
markItemSkipped(item, ctx)  // → skipped, finishedAt, clear wakeAt/lastError
markItemWaiting(item, ctx)  // → waiting, wakeAt (when ctx.wakeAt has value)
markItemBlocked(item, ctx)  // → blocked
```

```ts
// NodeRun series (8 functions, same as above)
markNodeQueued / markNodeRunning / markNodeSuccess / markNodeFailed
markNodeRejected / markNodeSkipped / markNodeWaiting / markNodeBlocked
```

```ts
// GroupItemRun series (7 functions, no rejected)
markGroupItemQueued / markGroupItemRunning / markGroupItemSuccess
markGroupItemFailed / markGroupItemSkipped / markGroupItemBlocked
markGroupItemWaiting / markGroupItemReset
```

```ts
// GroupRun series (6 functions, no rejected/skipped)
markGroupQueued / markGroupRunning / markGroupSuccess
markGroupFailed / markGroupBlocked / markGroupWaiting / markGroupReset
```

Each Reset function (`markItemReset`, `markGroupItemReset`, `markGroupReset`) is used for retry/replay scenarios, allowing items to be reset to a specified target state.
