# Pipeline DAG Architecture — Overview

> This document is the entry index for the pipeline engine documentation.

## Document Navigation

| Document | Topic |
|------|------|
| [runtime-architecture.md](./runtime-architecture.md) | Component relationship diagrams, DAG construction, error handling, persistence |
| [execution-sequence.md](./execution-sequence.md) | Complete node execution flow, scheduling loop, data flow examples |
| [state-machine.md](./state-machine.md) | Run/NodeItemRun/GroupRun state transition rules |
| [routing-and-branching.md](./routing-and-branching.md) | Route branching, derived itemKey, branch isolation |
| [artifact-storage.md](./artifact-storage.md) | Artifact directory structure, indexing, export, cleanup |
| [pipeline-output-and-dispatch.md](./pipeline-output-and-dispatch.md) | Pipeline final output, cross-pipeline FIFO dispatch, inbound queue |
| [api-and-cli.md](./api-and-cli.md) | Scheduling control API, CLI command reference |
| [troubleshooting.md](./troubleshooting.md) | Diagnostic tools, common issue troubleshooting |

## Project Overview

The pipeline engine is an Agent collaboration orchestration runtime based on a **Directed Acyclic Graph (DAG)**. Each pipeline consists of a set of **workflow nodes** connected by **dependency edges** and **route edges** to form a DAG. The scheduler automatically picks ready nodes in topological order and delegates them to the executor, where remote agent sessions complete the actual work. Results are collected through structured receipts and propagated downstream along the DAG.

### Design Philosophy

- **Declarative definition, automatic scheduling** — Users only need to declare nodes and edges; the scheduler automatically advances based on dependency relationships and run states.
- **Nodes as Agent tasks** — Each node is bound to an agent session and collects execution results through a unified structured receipt (ResultEnvelope).
- **Artifact propagation chain** — Node artifacts propagate along DAG edges; downstream nodes can access the full JSON content of upstream artifacts during execution.
- **Branch isolation** — Route branch nodes are isolated from each other, preventing cross-branch artifact/dependency leakage.
- **Dual-mode scheduling** — Supports both `auto` (fully automatic advancement) and `manual` (manual single-step triggering) modes.
- **Concurrency control** — Parallel groups support simultaneous execution of multiple member nodes.

## Core Components

```
PipelineRegistry
├── PipelineLinkStore         — Link persistence (.data/pipeline-links.json)
├── PipelineLinkDispatcher    — Output → job dispatch
├── PipelineInboundQueue      — Inbound queue (.data/pipeline-inbound-queue.jsonl)
├── PipelineQueueDrainer      — FIFO drain + busy protection
│
└── PipelineRuntime (per pipeline)
    ├── WorkflowGraph         — Graph index (nodeById, edges, groups)
    ├── RuntimeStore          — Runtime state store + timeline + broadcast
    ├── SchedulerService      — Scheduling loop + batch run + retry + onRunCompleted
    ├── ExecutionService      — Node/parallel group execution + reject + abort
    ├── PipelineOutputStore   — Pipeline output store (outputs/index.jsonl)
    └── PipelineOutputResolver— Final output node derivation + output construction
```

## Code Entry Points

| Module | Path |
|------|------|
| Workflow definition | `src/pipeline/types/workflow.ts` |
| Graph index | `src/pipeline/workflow-graph.ts` |
| Runtime model | `src/pipeline/runtime-model.ts` |
| State machine | `src/pipeline/state-machine.ts` / `src/pipeline/state/` |
| Scheduler | `src/pipeline/scheduler-service.ts` |
| Executor | `src/pipeline/execution-service.ts` |
| Route manager | `src/pipeline/execution/route-item-manager.ts` |
| Dependency check | `src/pipeline/execution/dependency-check.ts` |
| Artifact storage | `src/pipeline/artifact-storage.ts` |
| Diagnostics | `src/pipeline/diagnostics/` |
| Identity model | `src/pipeline/identity/` |
| Pipeline output | `src/pipeline/output/pipeline-output-resolver.ts` |
| Dispatch scheduling | `src/pipeline/dispatch/pipeline-link-store.ts` / `pipeline-inbound-queue.ts` / `pipeline-link-dispatcher.ts` / `pipeline-queue-drainer.ts` |
| Registry | `src/app/pipeline-registry.ts` |
| Prompt injection | `src/pipeline/structured-output/prompt.ts` / `src/pipeline/execution/structured-node-runner.ts` |
