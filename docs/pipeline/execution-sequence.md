# Execution Sequence

## Scheduling Loop (`drainPipeline`)

```
drainPipeline(reason, signal?)
│
├── Gate: Non-manual_tick / batch: / run / run: / pipeline_link: / retry: triggers
│   Check in order: scheduler plugin enabled? enabled? mode=auto?
│   (Any unsatisfied → return {executed:0, hardFailed:false})
│
├── Dedup: If drainInFlight already exists → merge into existing drain, return same Promise
│
├── Enter drain loop (while true):
│   │
│   ├── signal?.aborted → stopScheduling
│   ├── executed >= maxGlobalIterations → break (reached limit)
│   │
│   ├── Inner fill loop:
│   │   while (!stopScheduling && !signal?.aborted
│   │          && active.size < maxConcurrency
│   │          && executed < maxIterations):
│   │     [1] markReadyItemsFromDependencies()
│   │     [2] markReadyGroupsFromDependencies()
│   │     [3] batch = pickNextRunnableBatch(available slots)
│   │     [4] batch empty → break inner loop
│   │     [5] for each item → launchItem(item)  ──►
│   │     [6] manualTick → stopScheduling, break inner loop
│   │
│   ├── active.size === 0 → break (no active tasks)
│   │
│   ├── await Promise.race(active)
│   ├── signal?.aborted → stopScheduling
│   ├── Check settled results:
│   │   ├── rejected / success → continue loop
│   │   └── Hard failure (haltPipeline) → stopScheduling
│   │
│   └── manualTick + stopScheduling
│       → await Promise.all(active), break
│
└── Loop end → syncRunNodeStatusFromItemRuns() + touchRun() + emitPipeline()
```

## Concurrency Control

- `maxConcurrency`: Maximum concurrent count (default 3, range 1-20)
- `loopGuard.maxGlobalIterations`: Maximum iterations per drain (default 200, range 10-100000)
- `loopGuard.maxPerItemLoop`: Maximum loops per item (default 8, range 1-100)

## Scheduling Modes

| Mode | Behavior |
|------|------|
| `auto` | Auto-advance after each state change |
| `manual` | Execute only one tick; requires manual user advancement |
| `manual` + retry | Only execute the target retry node; do not trigger full drain |

## Batch Run Scheduling

```
itemBatchController.start(items, batchSize)
│
├── Slice keyword pool into N batches
├── Status: idle → running
│
└── runLoop:
    while (queue.length > 0):
      ├── Take batchSize keywords
      ├── executeBatch({ batchItems, batchIndex })
      │   ├── seedRun new Run
      │   ├── drainPipeline("batch:N/M")
      │   └── Check hardFailed → decide whether to continue
      └── batchIndex++
```

---

## Complete Node Execution Flow

```
executeNodeItem(item, opts?)
│
├── 1. Find corresponding NodeRun (not found → failed)
├── 2. Check enabled (workflowNode.enabled=false → skipped)
├── 3. Check retry limit (attempt >= maxAttempts → failed)
├── 4. Retry backoff (wait when attempt > 0 and retryBackoffMs > 0)
├── 5. markItemRunning(item) (attempt++, startedAt=now)
│
├── 6. nodeRunner.executeNode(node, { itemKey, dependencyIds })
│   │
│   ├── 6a. resolveExecutorSession
│   │   ├── Prefer pinned sessionId
│   │   ├── Then cached mapping
│   │   ├── Then fallbackAgentId
│   │   └── Finally refreshSessionsFromGateway() and retry
│   │
│   ├── 6b. markNodeRunning + runNodeViaStructuredOutput
│   │   ├── Load upstream dependency artifacts (buildDependencyArtifactInputs)
│   │   ├── Inject batch keywords (source entry nodes only)
│   │   ├── Build prompt → sendAndWaitForEnvelope
│   │   │   ├── Match ResultEnvelope through Gateway event stream
│   │   │   ├── validateEnvelope (runId/nodeId/requestId/sessionId)
│   │   │   ├── Validate artifact type/schemaVersion matches outputSpec
│   │   │   ├── Contract validation failure → retry with corrected prompt (max 1 time)
│   │   │   └── Timeout / still failing after correction → throw contract_violation
│   │   ├── Save envelope + artifact to disk
│   │   └── Return { envelope, artifacts }
│   │
│   └── 6c. handleNodeEnvelopeResult
│       ├── status="success" → markNodeSuccess
│       ├── upstream_reject + allowReject → handleNodeReject (rejected)
│       ├── upstream_reject + !allowReject → markNodeFailed
│       └── status="failed" → markNodeFailed (business failure)
│
├── 7. Mark item final status (markItemSuccess / markItemRejected / markItemFailed)
├── 8. applyEnvelopeOutcomeToItem
│   ├── Route node: Create derived item runs based on route values
│   ├── Non-route node: Advance downstream item states along normal dependency edges
│   └── sleepUntil: item.status = "waiting"
│
└── Exception catch → classifyNodeFailure
    (timeout / runtime_exception / unknown → haltPipeline)
```

## Artifact Propagation

```
Node execution succeeds
│
├── persistEnvelopeFile → envelopes/ directory + index
├── persistArtifactFile → artifacts/ directory + index
│
├── applyEnvelopeOutcomeToItem()
│   └── Iterate outgoing edges:
│       ├── Skip route edges (non-route nodes)
│       ├── Skip cross-branch edges (different lane and not parallel)
│       └── Set downstream item status = "queued"
│
└── On downstream execution, load full JSON content
    of upstream artifacts via buildDependencyArtifactInputs()
```

## Structured Receipt Contract

```
ResultEnvelope (version "2.0")
├── runId, nodeId, requestId, sessionId  (must match exactly)
├── status: "success" | "failed"
├── artifacts: ResultArtifact[]
│   ├── type, schemaVersion  (must match outputSpec)
│   ├── name?, meta?  (optional)
│   └── content: JsonValue
├── control?: { sleepUntil?, retryFromNodeId? }
├── logs?: string[]
└── error?: unknown
```

---

## Data Flow Example

```
DAG Definition:
┌─────────────────────────────────────────────────────────────┐
│   n1 (requirements analysis)                                 │
│    │  (normal edge)                                          │
│    ▼                                                        │
│   n2 (solution design)                                       │
│    │  (normal edge)                                          │
│    ▼                                                        │
│   n5 (router node, routePolicy=["web","mobile"])             │
│    │                                                        │
│    ├──(route:web)──► n6 (Web dev, lane=branch)              │
│    │                   │ (normal edge, cross-branch blocked) │
│    │                   ▼                                     │
│    │                  n8 (Web test, lane=branch)             │
│    │                                                        │
│    └──(route:mobile)► n7 (Mobile dev, lane=branch)          │
│                        │ (normal edge, cross-branch blocked) │
│                        ▼                                     │
│                       n9 (Mobile test, lane=branch)          │
│                                                             │
│   n10 (merge approval, depends on [n8,n9])                   │
│    │  (normal edge)                                          │
│    ▼                                                        │
│   n11 (deploy)                                               │
└─────────────────────────────────────────────────────────────┘

Execution Sequence:

Phase 1: n1 → n2 (mainline sequence)
Phase 2: n5 routing → create derived items: n5::web, n5::mobile
Phase 3: n6/n7 branch parallel execution (cross-branch edges blocked)
Phase 4: n8/n9 → n10 (merge approval) → n11 (deploy)
```
