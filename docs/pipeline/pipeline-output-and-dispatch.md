# Pipeline Output and Cross-Pipeline Dispatch

> Pipeline-level final output definition, cross-pipeline FIFO dispatch chain, and inbound queue consumption mechanism.
> Core constraints: Multiple upstream outputs are not merged; the downstream consumes only one job at a time; new jobs are only enqueued (not overwritten) when the downstream is currently running.

## Architecture Overview

```
CLI / Web UI / REST API
        │
        ▼
PipelineRegistry (global dispatch hub)
  ├── PipelineLinkStore          ← .data/pipeline-links.json
  ├── PipelineLinkDispatcher     ← output → job dispatch
  ├── PipelineInboundQueue       ← .data/pipeline-inbound-queue.jsonl
  └── PipelineQueueDrainer       ← FIFO drain + busy protection
        │
        │  governs all PipelineRuntimes
        ▼
┌──────────────────────┐   ┌──────────────────────┐
│ PipelineRuntime(A)    │   │ PipelineRuntime(B)    │
│ Run → success         │   │                       │
│   → onRunCompleted ───┼──▶│ Inbound queue ← pend- │
│   → resolveOutput     │   │               ing job │
│   → storeOutput       │   │ → seedRun(pipeline_   │
│   → dispatch          │   │     link)             │
│   │                   │   │ → drainPipeline       │
└──────────────────────┘   │ → onRunCompleted ────▶ │
                           └──────────┬────────────┘
                                      │ (chain recursion)
                                      ▼
                               PipelineRuntime(C)
```

## Data Model

### PipelineOutput

After each pipeline Run succeeds, an output record is extracted from the final output node.

```ts
type PipelineOutput = {
  schemaVersion: 1;
  outputId: string;           // First 16 chars of SHA256 hash, stable dedup
  pipelineId: string;
  runId: string;
  batchRunId: string | null;
  itemKey: string | null;
  outputNodeId: string;       // Final output node ID
  artifactId: string;
  artifactRef: {
    pipelineId: string;
    runId: string;
    batchRunId: string | null;
    nodeId: string;
    itemKey: string | null;
    relativePath: string;
    absolutePath: string;     // Points to existing node artifact file
    type: string;
    schemaVersion: number;
    name: string;
    hash: string;
    createdAt: string;
  };
  producedAt: string;
};
```

Dedup key: `pipelineId + runId + batchRunId + itemKey + outputNodeId + artifactId + hash`.

### PipelineLink

```ts
type PipelineLink = {
  id: string;
  enabled: boolean;
  fromPipelineId: string;     // Upstream
  toPipelineId: string;       // Downstream
  trigger: "on_success";
  dispatchPolicy: "fifo";
  inputContract: {            // Optional: filter by type/schemaVersion
    requireType?: string;
    requireSchemaVersion?: number;
  } | null;
  onJobFailed: "continue" | "pause";
  maxPendingJobs: number;     // 1-10000, default 100
};
```

Constraints: `fromPipelineId !== toPipelineId`; multiple links for the same pair must differentiate via `inputContract`.

### PipelineInboundJob

```ts
type PipelineInboundJob = {
  jobId: string;              // job:{linkId}:{outputId}
  linkId: string;
  fromPipelineId: string;
  toPipelineId: string;
  status: "pending" | "running" | "success" | "failed" | "canceled";
  upstreamOutput: PipelineOutput;
  targetRunId: string | null;
  attempts: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
};
```

### Run Input/Output

Two new fields are added to the `Run` type:

```ts
type RunInput =
  | { trigger: "manual" }
  | { trigger: "pipeline_link"; inboundJobId: string; linkId: string; upstreamOutput: PipelineOutput };

type Run = {
  // ... original fields
  input?: RunInput;
  output?: PipelineOutput | null;
};
```

Backward compatibility: when recovering from disk, missing `input` defaults to `{ trigger: "manual" }`, missing `output` defaults to `null`.

### Workflow Output Configuration

`WorkflowDefinitionRuntime` gains an optional field controlling how the final output node is selected:

```ts
type WorkflowOutputConfig = {
  mode: "mainline_last" | "explicit";
  nodeId: string | null;
};
```

| mode | Behavior |
|------|------|
| `mainline_last` | Auto-derive the unique mainline sink node (default) |
| `explicit` | Use `nodeId` for explicit specification |

Validation when saving workflow: branch nodes cannot be configured as output nodes; when there are multiple sinks, must switch to explicit.

## Core Flow

### 1. Output Generation

```
A Run success
  → onRunCompleted (triggered by scheduler-service)
    → resolveOutputNodeId(workflow)       // Derive final output node
    → resolvePipelineOutput(workflow, run) // Read node artifact → construct PipelineOutput
    → outputStore.append(output)          // Dedup → write outputs/index.jsonl
    → dispatcher.dispatch(output)         // Match links → create InboundJob
    → drainer.requestDrainInboundQueue(to) // Trigger downstream consumption
```

No output is generated in the following cases: Run failed, output node failed/skipped/no artifact, artifact file missing or hash mismatch.

### 2. Dispatch and Enqueue

```
dispatcher.dispatch(output)
  → list enabled links where fromPipelineId = output.pipelineId
  → for each link:
      ✓ toPipelineId exists?
      ✓ inputContract matches? (type/schemaVersion)
      ✓ pending count < maxPendingJobs?
      ✓ Job for same link+output already exists? (dedup)
      → buildJobId(linkId, outputId)
      → Create PipelineInboundJob(status=pending)
      → appendEvent(job.created)
```

### 3. Queue Consumption

```
drainer.requestDrainInboundQueue(B)
  → B drainInFlight? → Reuse existing promise (single downstream drain lock)
  → drainOne(B):
      B busy? → Skip (batch run in progress, nodes running/incomplete)
      B idle? → Fetch earliest pending job
      Existing running job? → Skip
      → executeInboundJob(job):
          B.seedRun() → nextRun
          nextRun.input = { trigger: "pipeline_link", upstreamOutput, ... }
          appendEvent(job.running)
          B.drainPipeline("pipeline_link:job:...")
            (bypasses scheduler checks — pipeline_link: prefix)
          success → appendEvent(job.success)
          failed  → appendEvent(job.failed)
            onJobFailed=continue → fetch next
            onJobFailed=pause    → stop this queue
      → More pending? → recursively drainOne(B)
```

### 4. Downstream Prompt Injection

When building the prompt for B's entry node (a node with no upstream dependencies), if `run.input.trigger === "pipeline_link"`, the upstream output is loaded as external context:

```
buildNodePrompt()
  → run.input.trigger === "pipeline_link" && isSourceEntryNode
    → buildExternalPipelineArtifactInput(upstreamOutput)
      Read artifact file → verify hash → toPromptContentText()
    → ctx.externalPipelineArtifact = { sourcePipelineId, content, ... }

createNodeExecutionPrompt(ctx)
  → Insert before "same-pipeline upstream artifacts":
      ## External Pipeline Upstream Output
      Source: final output from Pipeline A
      Content: ...
```

Constraints: External output is only injected once into B's first entry node; subsequent nodes propagate via B's internal DAG; system tracking fields (outputId, artifactId, hash, etc.) are not included in the Agent prompt.

## Concurrency and Consistency

| Mechanism | Description |
|------|------|
| Single downstream drain lock | `drainInFlightByPipelineId` Map — only one drain promise for the same B |
| Busy protection | Do not start new job when a batch run is active or nodes/groups are running |
| Job dedup | `jobId = job:{linkId}:{outputId}` — same output not dispatched twice |
| Crash recovery | Restart replay JSONL → reset running jobs to pending → auto drain |

## State Machine

```
pending ──▶ running ──▶ success
  │                      │
  └──▶ canceled          └──▶ failed ──▶ pending (manual retry)
                                    canceled ──▶ pending (manual retry)
```

## Persistence

```
.data/
├── pipeline-links.json              ← Link configuration
├── pipeline-inbound-queue.jsonl     ← Queue event stream (append-only)
│    event: job.created | job.running | job.success | job.failed
│           | job.canceled | job.retry_requested
│    On restart: replay → build in-memory snapshot → running→pending → drain
│
└── pipelines/
    └── {pipelineId}/
        ├── workflow.json            ← Contains output config
        ├── run-state.json           ← Runtime state (includes input/output)
        └── outputs/
            └── index.jsonl          ← PipelineOutput records (deduped)
```

## Delete and Change Constraints

- Before deleting a pipeline: check for enabled link references, pending/running jobs, and busy status
- Modifying `workflow.output`: does not affect historical output, only affects subsequent runs
- Modifying link `inputContract`: does not affect already-created jobs, only affects subsequent dispatches

## API

| Method | Path | Description |
|------|------|------|
| `GET` | `/api/pipeline-links` | List all links |
| `POST` | `/api/pipeline-links` | Create a link |
| `PATCH` | `/api/pipeline-links/:linkId` | Modify a link |
| `DELETE` | `/api/pipeline-links/:linkId` | Delete a link |
| `GET` | `/api/pipelines/:pipelineId/outputs` | Query outputs |
| `GET` | `/api/pipelines/:pipelineId/queue` | Query queue |
| `POST` | `/api/pipelines/:pipelineId/queue/drain` | Trigger drain |
| `POST` | `/api/pipelines/:pipelineId/queue/:jobId/retry` | Retry |
| `POST` | `/api/pipelines/:pipelineId/queue/:jobId/cancel` | Cancel |

## CLI

```bash
taskmeld pipeline output <pipelineId> [--run <runId>]
taskmeld pipeline link list
taskmeld pipeline link create --from A --to B [--type <t>] [--schema <n>]
taskmeld pipeline link enable <linkId>
taskmeld pipeline link disable <linkId>
taskmeld pipeline link delete <linkId>
taskmeld pipeline queue <pipelineId>
taskmeld pipeline queue retry <pipelineId> <jobId>
taskmeld pipeline queue cancel <pipelineId> <jobId>
```

## Code Entry Points

| Module | Path |
|------|------|
| Output type | `src/pipeline/types/pipeline-output.ts` |
| Link type | `src/pipeline/types/pipeline-link.ts` |
| Workflow output config | `src/pipeline/types/workflow.ts` (WorkflowOutputConfig) |
| Output resolver | `src/pipeline/output/pipeline-output-resolver.ts` |
| Output store | `src/pipeline/output/pipeline-output-store.ts` |
| Link store | `src/pipeline/dispatch/pipeline-link-store.ts` |
| Inbound queue | `src/pipeline/dispatch/pipeline-inbound-queue.ts` |
| Dispatcher | `src/pipeline/dispatch/pipeline-link-dispatcher.ts` |
| Queue drainer | `src/pipeline/dispatch/pipeline-queue-drainer.ts` |
| Registry integration | `src/app/pipeline-registry.ts` |
| Scheduler integration | `src/pipeline/scheduler-service.ts` (onRunCompleted) |
| Prompt injection | `src/pipeline/structured-output/prompt.ts` |
| Prompt context | `src/pipeline/execution/structured-node-runner.ts` |
| Frontend dispatch panel | `web/src/widgets/pipeline-dispatch-board/` |
| CLI command | `src/cli/commands/pipeline.ts` |
