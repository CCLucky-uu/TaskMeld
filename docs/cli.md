# taskmeld CLI Documentation

`taskmeld` is the command-line tool for TaskMeld — a pipeline-driven agent collaboration execution platform. It provides pipeline management, result querying, scheduler control, session interaction, and service management capabilities.

```bash
taskmeld <resource> <action> [args] [--flags]
```

---

## Table of Contents

- [Global Options](#global-options)
- [Output Formats](#output-formats)
- [Exit Codes](#exit-codes)
- [Pipeline Management](#pipeline-management)
  - [pipeline list](#pipeline-list) — List pipelines
  - [pipeline get](#pipeline-get) — View pipeline details
  - [pipeline start](#pipeline-start) — Start a pipeline run
  - [pipeline status](#pipeline-status) — Query run status
  - [pipeline result](#pipeline-result) — View run results
  - [pipeline watch](#pipeline-watch) — Monitor a run
  - [pipeline stop](#pipeline-stop) — Stop a run
  - [pipeline retry-node](#pipeline-retry-node) — Retry a node
- [Artifact Management](#artifact-management)
- [Agents & Sessions](#agents--sessions)
- [Scheduler Control](#scheduler-control)
- [Service Management](#service-management)
- [System Snapshot](#system-snapshot)
- [Architecture](#architecture)

---

## Global Options

| Option | Type | Description |
| --- | --- | --- |
| `-f`, `--format` | `json\|md` | Output format, default `md` |
| `--envelope` | flag | Only effective with `-f json`; wraps output in `{ ok, command, data, meta }` |
| `-h`, `--help` | flag | Show help for the current command |
| `--version` | flag | Show version number |

---

## Output Formats

### Markdown (default)

Human-readable formatted text. List commands output tables; detail commands output sectioned information.

### JSON

Raw JSON data, suitable for script consumption.

```bash
taskmeld pipeline list -f json
```

### JSON Envelope

```bash
taskmeld pipeline list -f json --envelope
```

```json
{
  "ok": true,
  "command": "pipeline.list",
  "data": { "..." : "..." },
  "meta": { "ts": "2026-05-15T00:00:00.000Z" }
}
```

### Error Output

Errors are always output to stderr in JSON format:

```json
{
  "ok": false,
  "command": "pipeline.start",
  "error": {
    "code": "PIPELINE_NOT_FOUND",
    "message": "Pipeline not found: X",
    "details": null
  },
  "meta": { "ts": "2026-05-15T00:00:00.000Z" }
}
```

---

## Exit Codes

| Exit Code | Meaning |
| --- | --- |
| `0` | Success |
| `1` | Unexpected error |
| `2` | Argument error |
| `3` | Resource not found |
| `4` | Business execution error |
| `5` | Local service unavailable |

---

## Pipeline Management

A Pipeline is the core orchestration unit, composed of a node graph, scheduler configuration, and plugins.

### pipeline list

List all registered pipelines.

```bash
taskmeld pipeline list [-f json|md]
```

```bash
taskmeld pipeline list
taskmeld pipeline list -f json
```

**Markdown output:** A two-column table with `ID` and `Title` columns.

---

### pipeline get

View full details of a specific pipeline, including the node graph, scheduler configuration, and plugin status.

```bash
taskmeld pipeline get <pipelineId> [-f json|md]
```

| Argument | Description |
| --- | --- |
| `<pipelineId>` | Pipeline ID, required |

```bash
taskmeld pipeline get A
```

**Output sections:** Basic (basic info), Nodes (node list), Scheduler Plugin (scheduler configuration), Batch Plugin (batch plugin configuration, shown only when enabled).

---

### pipeline start

Start a pipeline run. The command returns immediately once the run is accepted, without waiting for execution to complete.

```bash
taskmeld pipeline start <pipelineId> [--watch] [--timeout <ms>] [--interval <ms>] [-f json|md]
```

| Option | Description |
| --- | --- |
| `<pipelineId>` | Pipeline ID, required |
| `--watch` | Wait for run to complete after starting |
| `--timeout` | Watch timeout in ms, default `600000` |
| `--interval` | Watch polling interval in ms, default `1200` |

```bash
taskmeld pipeline start A
taskmeld pipeline start A --watch
taskmeld pipeline start A --watch --timeout 300000
```

**Single-run output:** Pipeline ID, Run ID, Status, and Nodes table.

**Batch-run output:** Additionally includes Batch Run ID, Remote URL, Total Fetched, Batch Size, and Total Batches.

---

### pipeline status

Query the current run state of a pipeline. Supports lookup by pipeline ID, run ID, or batch run ID.

```bash
taskmeld pipeline status [<pipelineId>] [--run-id <id>] [--batch-run-id <id>] [-f json|md]
```

| Option | Description |
| --- | --- |
| `<pipelineId>` | Query active run by pipeline ID |
| `--run-id` | Query by exact run ID |
| `--batch-run-id` | Query by exact batch run ID |

> At least one of `<pipelineId>`, `--run-id`, or `--batch-run-id` is required.

```bash
taskmeld pipeline status A
taskmeld pipeline status A --run-id run-123
taskmeld pipeline status A --batch-run-id batch:A:2026-05-08T18:34:08.978Z
```

**Active-run output sections:**

| Section | Description |
| --- | --- |
| Summary | Pipeline ID, Mode, Run ID, Run Status, Active/Pending Nodes, Updated At, Last Error |
| Batch Run | Batch run progress (shown only in `mode: remote_batch`) |
| Current Batch | Current batch details (shown only in `mode: remote_batch`) |

**Idle-state output:** Shows "No active pipeline run" along with last run information. Batch-run pipelines show the last batch run ID; single-run pipelines show the last run ID.

---

### pipeline result

View artifact contents for each node after a pipeline run. Reads execution envelopes from the `envelopes/` directory, extracting content and optional logs.

```bash
taskmeld pipeline result <pipelineId> [--node <nodeId>] [--logs] [-f json|md]
```

| Option | Description |
| --- | --- |
| `<pipelineId>` | Pipeline ID, required |
| `--node` | Filter to the specified node |
| `--logs` | Also display processing logs |

```bash
taskmeld pipeline result B
taskmeld pipeline result B --node n1
taskmeld pipeline result A --logs
taskmeld pipeline result B -f json
```

**Non-batch output:** One section per node that has artifacts or errors, displaying the Content.

**Batch output:** Grouped by batch (batch-1, batch-2, ...), with each group showing results per node. Skipped nodes or nodes with no artifacts are not displayed.

**Content source:** Reads execution envelope JSON files from the `envelopes/` directory. Derives the directory from artifact paths first, falling back to scanning `success`/`failed`/`rejected` status directories.

---

### pipeline watch

Continuously monitor a pipeline run until completion or timeout.

```bash
taskmeld pipeline watch [<pipelineId>] [--run-id <id>] [--batch-run-id <id>] [--timeout <ms>] [--interval <ms>] [-f json|md]
```

| Option | Description |
| --- | --- |
| `<pipelineId>` | Monitor active run by pipeline ID |
| `--run-id` | Monitor by exact run ID |
| `--batch-run-id` | Monitor by exact batch run ID |
| `--timeout` | Timeout in ms, default `600000` |
| `--interval` | Polling interval in ms, default `1200` |

```bash
taskmeld pipeline watch A
taskmeld pipeline watch --run-id run-123
taskmeld pipeline watch --batch-run-id batch:A:2026-05-08T18:34:08.978Z --timeout 900000
```

> `watch` prioritizes WebSocket event streams and automatically falls back to interval polling when unavailable. `watch` only monitors and does not initiate new runs.

---

### pipeline stop

Stop the run of a specific pipeline.

```bash
taskmeld pipeline stop [<pipelineId>] [--run-id <id>] [--batch-run-id <id>] [-f json|md]
```

```bash
taskmeld pipeline stop A
taskmeld pipeline stop --batch-run-id batch:A:2026-05-08T18:34:08.978Z
```

> `stop` is primarily intended for stopping batch-run tasks. For single runs, it returns a `SINGLE_RUN_STOP_NOT_SUPPORTED` business error.

---

### pipeline retry-node

Retry a specific node or node entry (batch runs only).

```bash
taskmeld pipeline retry-node <pipelineId> <nodeId> [--item <itemKey>] [-f json|md]
```

| Argument / Option | Description |
| --- | --- |
| `<pipelineId>` | Pipeline ID, required |
| `<nodeId>` | Node ID, required |
| `--item` | Specify the item key to retry (batch-run scenarios) |

```bash
taskmeld pipeline retry-node A n1
taskmeld pipeline retry-node A n2 --item keyword_001
```

---

## Artifact Management

### artifact list

List artifact metadata, with optional filtering by pipeline and node.

```bash
taskmeld artifact list [--pipeline <id>] [--node <id>] [-f json|md]
```

| Option | Description |
| --- | --- |
| `--pipeline` | Filter by pipeline ID |
| `--node` | Filter by node ID |

```bash
taskmeld artifact list
taskmeld artifact list --pipeline A
taskmeld artifact list --pipeline A --node n1
```

---

## Agents & Sessions

### agent list

List registered agents and their running status.

```bash
taskmeld agent list [-f json|md]
```

**Output columns:** Agent ID, Name, Workspace, Runtime, Model Primary, Last Active At.

---

### session list

List active sessions.

```bash
taskmeld session list [-f json|md]
```

### session send

Send a message to a specific session (reads from stdin).

```bash
taskmeld session send <sessionId> --stdin [--mode auto|chat|sessions] [-f json|md]
```

| Argument / Option | Description |
| --- | --- |
| `<sessionId>` | Session ID, required |
| `--stdin` | Read message content from stdin, required |
| `--mode` | Send mode, default `auto` |

```bash
echo "Hello, agent!" | taskmeld session send agent:A:main --stdin
```

---

## Scheduler Control

### scheduler toggle

Enable or disable the scheduler for a specific pipeline.

```bash
taskmeld scheduler toggle <pipelineId> --enabled <true|false> [-f json|md]
```

```bash
taskmeld scheduler toggle A --enabled true
taskmeld scheduler toggle A --enabled false
```

### scheduler mode

Switch scheduler mode.

```bash
taskmeld scheduler mode <pipelineId> --mode <auto|manual> [-f json|md]
```

```bash
taskmeld scheduler mode A --mode manual
```

---

## Service Management

Manage the lifecycle of the local control-plane daemon. All service commands communicate with the local daemon via HTTP.

### server ensure

Ensure the local daemon is running and healthy. Prefers reusing an existing instance.

```bash
taskmeld server ensure [-f json|md]
```

### server start

Explicitly start the local daemon.

```bash
taskmeld server start [-f json|md]
```

### server status

Check daemon health, ownership, and PID information.

```bash
taskmeld server status [-f json|md]
```

### server stop

Stop the local daemon.

```bash
taskmeld server stop [-f json|md]
```

> The daemon starts as a detached process, independent of the CLI lifecycle. Uses PID file + health checks to prevent duplicate starts. Start timeout is 15s; stop timeout is 10s.

---

## System Snapshot

### system snapshot

Output a global system snapshot including pipeline list and run status.

```bash
taskmeld system snapshot [-f json|md]
```

> Prioritizes connecting to the Gateway for the latest data; falls back to local cache on connection failure.

---

## Architecture

### Command Routing

The CLI uses a two-level routing scheme `<resource> <action>`, uniformly defined by `CLI_ROUTES` in `src/cli/router.ts`. Each command module exports a `*Routes` array, and `collectRoutesFromModule` aggregates them automatically.

### Argument Parsing

The `parseFlagsAndArgs` parser supports:

| Format | Example |
| --- | --- |
| Positional argument | `pipeline start A` |
| Short flag | `-f json`, `-h` |
| Long flag | `--format json`, `--format=json`, `--watch` |
| Boolean flag | Flag with no value is automatically treated as `true` |

### Bootstrap Modes

Routes automatically select an execution context based on `bootstrap` metadata:

| Mode | Description |
| --- | --- |
| Default | Embedded local service, direct read/write of persisted data |
| `runtimeApiOnly` | Communicate with local daemon via HTTP API |
| `runtimeApiOnly + ensureServerReady` | Ensure daemon is running before execution |
| `gateway: required` | Must establish a Gateway WebSocket connection |
| `gateway: warmup` | Attempt Gateway connection, fall back to local cache on failure |

### Output Rendering

Renderers are located in `src/cli/renderers/`:

| Component | Responsibility |
| --- | --- |
| `engine/markdown.ts` | Generate Markdown table/section output per command spec |
| `engine/json.ts` | Direct data serialization or envelope wrapping |
| `engine/utils.ts` | Common data access utilities |
| `specs/*.ts` | Independent Markdown output format definitions per command |

Render pipeline: `command key → RenderSpec → extractIr() → formatMarkdown() / formatJson()`

### Error Handling

Uses the unified `CliError` type (`src/cli/errors.ts`), containing `code`, `exitCode`, and `details`. The routing layer automatically catches exceptions and converts them to standardized JSON error output to stderr.
