# API and CLI Reference

## Scheduling Control API

### API Endpoints

| Method | Path | Description |
|------|------|------|
| GET | `/api/pipelines/:pipelineId/current` | Current run info |
| GET | `/api/pipelines/:pipelineId/status` | Pipeline status |
| POST | `/api/pipelines/:pipelineId/run` | Start a run |
| POST | `/api/pipelines/:pipelineId/stop` | Stop a run |
| POST | `/api/pipelines/:pipelineId/scheduler/toggle` | Toggle scheduler enabled state |
| POST | `/api/pipelines/:pipelineId/scheduler/mode` | Set scheduling mode |
| POST | `/api/pipelines/:pipelineId/tick` | Manually trigger a scheduling tick |
| POST | `/api/pipelines/:pipelineId/nodes/:nodeId/retry` | Retry a node |
| GET | `/api/pipelines/:pipelineId/nodes/:nodeId/diagnostics` | Node scheduling diagnostics |
| GET | `/api/pipelines/:pipelineId/executor-bindings` | Executor session bindings |

Batch run related:

| Method | Path | Description |
| ------ | ------ | ------ |
| GET | `/api/pipelines/:pipelineId/items` | Item Run list |
| POST | `/api/pipelines/:pipelineId/batch-run/start` | Start local batch run |
| POST | `/api/pipelines/:pipelineId/batch-run/start-remote` | Start remote batch run |
| POST | `/api/pipelines/:pipelineId/batch-run/stop` | Stop batch run |
| GET | `/api/pipelines/:pipelineId/batch-run/status` | Batch run status |

Artifact related:

| Method | Path | Description |
| ------ | ------ | ------ |
| GET | `/api/artifacts` | Artifact list |
| GET | `/api/artifacts/content` | Artifact content preview |
| GET | `/api/artifacts/export` | Artifact export |
| POST | `/api/artifacts/cleanup` | Clean up old artifacts |
| POST | `/api/artifacts/rebuild-index` | Rebuild artifact index |

### API Code Entry Points

| Route File | Responsibility |
| ---------- | ------ |
| `src/server/routes/pipeline-runtime.ts` | Runtime: current/status/run/stop/retry/executor-bindings |
| `src/server/routes/pipeline-scheduler.ts` | Scheduler: toggle/mode/tick |
| `src/server/routes/pipeline-diagnostics.ts` | Diagnostics: diagnostics |
| `src/server/routes/pipeline-batch.ts` | Batch run: items/batch-run |
| `src/server/routes/artifacts.ts` | Artifacts: list/content/export/cleanup/rebuild-index |

---

## CLI Command Reference

```text
taskmeld pipeline list                       — List all pipelines
taskmeld pipeline get <id>                   — View pipeline details
taskmeld pipeline start <id>                 — Start a run
taskmeld pipeline status <id>                — View status
taskmeld pipeline stop <id>                  — Stop a run
taskmeld pipeline retry-node <id> <nodeId>   — Retry a node
taskmeld pipeline diagnose <id> <nodeId>     — Node scheduling diagnostics
taskmeld pipeline watch <id>                 — Watch execution progress continuously

taskmeld scheduler toggle <id> --enabled <true|false>  — Toggle scheduler enabled state
taskmeld scheduler mode <id> --mode <auto|manual>       — Set scheduling mode

taskmeld agent list                          — List agent sessions
taskmeld agent session [agentId]             — View session details
taskmeld agent send <agentId> <msg>          — Send message to agent

taskmeld artifact list                       — Artifact list
taskmeld artifact show <pipelineId> <path>   — View artifact content
taskmeld artifact export                     — Export artifacts
taskmeld artifact cleanup <pipelineId>       — Clean up old artifacts
taskmeld artifact index rebuild              — Rebuild artifact index

taskmeld system snapshot                     — System snapshot
taskmeld server ensure|start|status|stop     — Backend server management
```

### Output Format

- Default `md` (Markdown table)
- `-f json` or `--format json` switches to JSON output
- `--envelope` only available in `-f json` mode, displays raw envelope data
- Only supports `md` (default) and `json` formats

### CLI Code Entry Points

| Command Module | Path |
| ---------- | ------ |
| pipeline | `src/cli/commands/pipeline.ts` |
| scheduler | `src/cli/commands/scheduler.ts` |
| agent | `src/cli/commands/agent.ts` |
| artifact | `src/cli/commands/artifact.ts` |
| server | `src/cli/commands/server.ts` |
| system | `src/cli/commands/system.ts` |
| router | `src/cli/router.ts` |
