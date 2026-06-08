# TaskMeld Backend Architecture Documentation

## 1. Overall Architecture

This project is a pipeline-based agent collaboration execution platform. The backend uses a layered architecture, with clear responsibilities and well-defined boundaries between each layer.

### Layered Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                   CLI Entry Layer (src/cli/)                 │
│              taskmeld command routing, output rendering      │
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────┐
│                    WebSocket Transport Layer                  │
│  ┌──────────────────┐  ┌──────────────────┐                 │
│  │  server module    │  │ transport module  │                 │
│  │ HTTP (health+SPA) │  │ WS RPC + broadcast│                 │
│  └────────┬─────────┘  └────────┬─────────┘                 │
│           │                     │                            │
└───────────┼─────────────────────┼────────────────────────────┘
            │                     │
┌───────────▼─────────────────────▼────────────────────────────┐
│                    Service Layer (services/)                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│  │ pipeline │ │  agent   │ │ session  │ │ artifact │       │
│  │ service  │ │ service  │ │ service  │ │ service  │       │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘       │
│  ┌────┴─────┐ ┌────┴─────┐                                     │
│  │scheduler │ │  system  │                                     │
│  │ service  │ │  service │                                     │
│  └──────────┘ └──────────┘                                     │
└───────────────────────┬─────────────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────────────┐
│                 Application Assembly Layer (app/)             │
│  PipelineRegistry: pipeline registration, lifecycle,         │
│                    broadcast coordination                     │
│  AppContext: application-wide context (config, services,     │
│              gateway)                                         │
└───────────────────────┬─────────────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────────────┐
│               Pipeline Engine Layer (pipeline/)               │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐        │
│  │   runtime     │ │  execution   │ │  scheduler   │        │
│  │   model       │ │  service     │ │  service     │        │
│  └──────┬───────┘ └──────┬───────┘ └──────┬───────┘        │
│  ┌──────┴───────┐ ┌──────┴───────┐                           │
│  │  workflow     │ │  template    │                           │
│  │  graph        │ │  (DAG defs)   │                           │
│  └──────────────┘ └──────────────┘                           │
└───────────────────────┬─────────────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────────────┐
│                 Infrastructure Layer                          │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│  │ gateway  │ │artifacts │ │  logs    │ │timeline  │       │
│  │ external │ │ artifact │ │  runtime  │ │   log    │       │
│  │  comms   │ │ storage  │ │   logs   │ │ storage  │       │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘       │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow Overview

1. **Inbound request flow**: CLI / Web frontend → WebSocket RPC (transport) → Service layer (services) → PipelineRegistry → PipelineRuntime → Pipeline engine
2. **Outbound event flow**: Pipeline engine → PipelineRuntime → PipelineRegistry → WebSocket Broker (transport) → Web frontend
3. **External agent communication**: PipelineRuntime → GatewayClient → Remote agent gateway (WebSocket)
4. **Persistence flow**: Pipeline engine → RuntimeStore (run-state.json) / TimelineLogStore (timeline.log) / ArtifactDirs (artifact files)

---

## 2. Module Details

---

### 2.1 server Module — HTTP Server

**Path**: `src/server/`

**Responsibility**: Minimal HTTP server for health checks (CLI lifecycle detection) and static file serving (Web SPA).

**File**: `http-handler.ts`

| Function | Description |
|------|------|
| `createApiHandler(options)` | Creates HTTP request handler |
| `serveStatic(req, res)` | Serves static files from `web/dist/` with SPA fallback |

**HTTP Endpoints**:

| Method | Path | Description |
|------|------|------|
| `GET` | `/api/health` | Health check (returns serverId/pid/port) |
| `OPTIONS` | `*` | CORS preflight |
| `GET` | `*` | Static file serving (SPA fallback to index.html) |

> [!NOTE]
> All business API endpoints have been migrated to WebSocket RPC. See `src/transport/ws-methods/` for the WS method registry.

---

### 2.2 pipeline Module — Pipeline Execution Engine

**Path**: `src/pipeline/`

**Core sub-modules**:

#### 2.2.1 runtime-model (Runtime Data Model)

**File**: `runtime-model.ts`

Defines all core data structures for pipeline runtime:

| Type | Description |
|------|------|
| `TimelineItem` | Timeline entry (id, ts, text, level) |
| `NodeRun` | Node run state (id, executor, instruction, status, artifacts, dependsOn, rejectFeedbacks...) |
| `NodeItemRun` | Node item run state (cross-execution of node × itemKey in batch run scenarios) |
| `GroupRun` | Parallel group run state (members, joinPolicy, status) |
| `GroupItemRun` | Parallel group item run state |
| `Run` | Single run aggregation (id, status, nodes, itemRuns, groups, groupItemRuns) |
| `ArtifactManifest` | Artifact manifest (type, schemaVersion, path, hash, sourceNodeId) |
| `NormalizedSession` | Normalized session (id, title, raw) |

**Node state machine**:

```
queued → running → success
                 → failed
                 → rejected
blocked → queued
waiting → queued
        → running (wakeAt expires)
```

**Key functions**:
- `seedRun(templateNodes)` — Initialize Run from template nodes
- `seedRunWithItems(templateNodes, itemKeys)` — Initialize with itemKeys
- `touchRun(run)` — Update run timestamp and status aggregation
- `syncRunNodeStatusFromItemRuns(run)` — Aggregate node status from itemRuns
- `computeRunStatus(run)` — Determine the overall run status (running/success/failed)
- `aggregateNodeStatusFromItemRuns(itemRuns)` — Aggregate status by priority

#### 2.2.2 template (Workflow Template / DAG Definitions)

**File**: `template.ts`

Defines core types and read/write logic for pipeline DAG structures:

| Type | Description |
|------|------|
| `NodeExecutor` | Executor definition (agentId, role, fallbackAgentId, sessionId) |
| `OutputSpec` | Output specification (type, schemaVersion) |
| `PipelineTemplateNode` | Template node (id, title, executor, instruction, dependsOn, allowReject...) |
| `WorkflowNode` | Workflow node (includes additional metadata: lane, parallelGroupId, routePolicy, retryPolicy...) |
| `WorkflowEdge` | Workflow edge (from, to, when) — when is null for dependency edges, non-null for routing edges |
| `WorkflowGroup` | Parallel group (type: "parallel", members, joinPolicy) |
| `WorkflowDefinitionRuntime` | Complete workflow definition (version "3.0", scheduler, plugins, nodes, edges, groups) |
| `WorkflowPlugins` | Plugin configuration (remoteBatch, scheduler) |
| `WorkflowScheduler` | Scheduler configuration (enabled, mode, dispatchBy, maxConcurrency, loopGuard) |

**Validation rules** (`validateWorkflowGraph`):
- nodes cannot be empty and ids must be unique
- edges references must exist in nodeIds/groups
- self-loop edges and duplicate edges are forbidden
- a node cannot have both dependency and route outgoing edges simultaneously
- direct interconnections between parallel group members are forbidden
- the DAG must not contain cycles (topological sort validation)

**Persistence**:
- Workflow definitions stored as `workflow.json`
- Template nodes stored as `pipeline-template.json` (deprecated, now unified under workflow)
- Read/write functions support custom `workflowFilePath` for multi-pipeline isolation

#### 2.2.3 workflow-graph (Workflow Graph Computation)

**File**: `workflow-graph.ts`

Provides runtime indexing and querying for `WorkflowDefinitionRuntime`:

- `buildIndices(workflow)` — Build fast lookup indices for nodes, edges, and parallel groups
- `getIncomingEdges(targetId)` / `getOutgoingEdges(sourceId)` — Edge queries
- `getWorkflowNodeById(nodeId)` / `getWorkflowGroupById(groupId)` — Entity queries
- `isBranchNode(nodeId)` — Check whether a node is a branch node (all incoming edges are route edges)
- `isCrossBranchEdge(edge)` — Check whether an edge is a cross-branch regular edge (must be blocked to prevent artifact leakage)
- `getNodesWithWorkflowMeta(nodes)` — Attach lane/parallelGroupId metadata to NodeRun
- `syncRunGroupsFromWorkflow(run)` — Sync workflow parallel groups to Run

#### 2.2.4 execution-service (Node Execution Engine)

**File**: `execution-service.ts`

Core execution logic, responsible for driving the execution of a single node or an entire parallel group:

**Dependencies**:
- `GatewayClient` — Used to send structured output instructions to Agents
- `RuntimeStore` — Runtime state reads/writes
- `WorkflowGraph` — Workflow graph queries
- `artifactDir` / `rejectedArtifactDir` — Artifact directories

**Core methods**:

| Method | Description |
|------|------|
| `executeNode(node, opts?)` | Execute a single node (resolve session, send structured output request, wait for receipt) |
| `executeNodeItem(item, opts?)` | Execute a single node item (check retry limit first, skip disabled nodes, adapter/structured branching) |
| `executeGroupItem(item)` | Execute parallel group item (execute all member node items in parallel, aggregate artifacts) |

**Execution flow** (executeNode):

1. Resolve executor session via `SessionRegistry` (including fallback agent)
2. Set node status to `running`, increment attempt count
3. Call `StructuredNodeRunner.runNodeViaStructuredOutput()` to send execution instruction
4. Determine result based on structured receipt (ResultEnvelope):
   - `status=success` → Node marked successful, artifacts archived
   - `error.code=upstream_reject` + allowReject → Reject upstream node, reset downstream
   - `error.code=upstream_reject` + !allowReject → Node failed
   - Other failures → Node failed (haltPipeline=false, does not interrupt the entire pipeline)

**Rejection mechanism**:

1. After a node outputs a rejection, select target upstream node from `dependsOn`
2. Append rejectFeedbacks to the target node
3. Archive target node's existing artifacts to rejected directory
4. Collect downstream subgraph (`collectDownstreamSubgraph`), reset all affected node/group run states

#### 2.2.5 scheduler-service (Scheduling Engine)

**File**: `scheduler-service.ts`

Manages automatic/manual scheduling of pipeline nodes:

**Core methods**:

| Method | Description |
|------|------|
| `drainPipeline(reason)` | Main scheduling loop, repeatedly picks queued nodes to execute until no candidates remain or iteration cap is reached |
| `retryNodeExecution(nodeId, itemKey?)` | Manually retry a node (reset downstream, re-evaluate dependencies, trigger execution) |
| `startBatchRun(items, batchSize, opts?)` | Start a keyword pool batch run |
| `stopBatchRun()` | Request batch run stop (stops after current batch finishes) |
| `cancelBatchRun()` | Immediately cancel batch run (used when plugin shuts down) |

**Scheduling loop** (`drainPipeline`):

1. Check whether scheduler is enabled and in auto mode (manual_tick/batch/run explicitly started skip this check)
2. Call `markReadyItemsFromDependencies()` and `markReadyGroupsFromDependencies()` to advance dependencies
3. Select `queued` state candidates from itemRuns and groupItemRuns
4. Execute concurrently (limited by `maxConcurrency`), up to `maxGlobalIterations` iterations
5. If execution result has `haltPipeline=true`, interrupt the scheduling loop

**Dependency advancement** (`scheduler/dependency-state.ts`):

- `markReadyItemsFromDependencies()` — Evaluate all blocked/waiting node items: if their dependencies are all satisfied (success/skipped), promote to queued
- `markReadyGroupsFromDependencies()` — Same logic applied to parallel group items
- Supports `dependencyPolicy: "any"` (promote when any dependency is satisfied) and `"all"` (promote when all are satisfied)
- Cross-branch regular edges are blocked to prevent dependency leakage between branch nodes

#### 2.2.6 item-batch-controller (Batch Run Controller)

**File**: `item-batch-controller.ts`

Manages batched shard execution of keyword pools:

- `start(items, batchSize, opts?)` — Initialize batch run (validate state, compute batch count, start async loop)
- `runLoop(token, queue)` — Buffer queue consumed batch by batch, callback invoked after each batch completes
- `stop()` — Request graceful stop (stops after current batch finishes)
- `cancel()` — Immediate cancel (swap runToken to invalidate the current loop)
- Snapshot type `ItemBatchRunSnapshot` records complete batch run progress

#### 2.2.7 structured-output (Structured Output Subsystem)

**Path**: `src/pipeline/structured-output/`

| File | Responsibility |
|------|------|
| `contract.ts` | Defines `ResultEnvelope` receipt structure and validation logic (`validateEnvelope`) |
| `parser.ts` | Receipt parsing, extracts JSON from Agent response `<structured_output>` tags |
| `waiter.ts` | Polling wait for Agent to produce structured output receipt (based on Gateway event frames) |
| `prompt.ts` | Builds structured output prompt template sent to Agent |
| `index.ts` | Unified exports |

**ResultEnvelope structure**:

```typescript
type ResultEnvelope = {
  version: "2.0";
  runId: string; nodeId: string; requestId: string; sessionId: string;
  status: "success" | "failed";
  artifacts: ResultArtifact[];
  control?: { sleepUntil?: string; retryFromNodeId?: string };
  logs?: string[];
  error?: unknown;
};
```

**Validation flow** (`validateEnvelope`):
- Validates runId/nodeId/requestId/sessionId match
- success status must have artifacts
- Each artifact's type and schemaVersion must match outputSpec
- Route nodes (requireRouteContent) must have valid route content

#### 2.2.8 Execution Sub-modules (`execution/`)

| File | Responsibility |
|------|------|
| `session-registry.ts` | Manages executor → agent session mapping and caching |
| `readiness-state.ts` | Dependency readiness evaluation (`canPromoteToQueuedByDependency`) |
| `run-state-helpers.ts` | Runtime state helpers (getNodeById, getItemRun, collectDownstreamSubgraph, resetNodeForReplay...) |
| `structured-node-runner.ts` | Structured node runner: send instruction → poll wait → parse receipt |
| `route-item-manager.ts` | Route item management: handles route edge branching after node success |

#### 2.2.9 Other Helper Modules

| File | Responsibility |
|------|------|
| `execution-timeout.ts` | Timeout configuration (node execution 15 min, polling interval 300ms) |
| `artifact-storage.ts` | Artifact directory construction (`buildArtifactStorageDirs`) |
| `timeline-log-store.ts` | Timeline log persistence to NDJSON files |
| `execution-status.ts` | Build runtime status snapshot (`PipelineExecutionStatusPayload`) |
| `agent-activity.ts` / `tool-activity.ts` | Agent/tool activity tracking |

---

### 2.3 services Module — Service Layer

**Path**: `src/services/`

Serves as the intermediate layer between the HTTP API and the pipeline engine, providing unified business operation interfaces.

**Service listing**:

#### PipelineService (`pipeline-service.ts`)

| Method | Description |
|------|------|
| `listPipelines()` | List all pipelines (id + title) |
| `getPipeline(pipelineId)` | Get pipeline details (including run/scheduler/batchRun/workflow) |
| `getTimeline()` | Get merged timeline |
| `startPipeline(pipelineId)` | Start pipeline (auto-detects single/remote_batch mode) |
| `getPipelineExecutionStatus(pipelineId, target?)` | Query execution status (supports runId/batchRunId targeting) |
| `stopPipeline(pipelineId, target?)` | Stop batch run |
| `runPipeline(pipelineId)` | Compatibility entry, equivalent to startPipeline |
| `startBatchRun(input)` | Start local keyword batch run |
| `startRemoteBatchRun(input)` | Start remote keyword pool batch run (fetch URL → parse → shard) |
| `retryNode(input)` | Retry node |

**Run identity system** (`PipelineRunIdentityTarget`):
- Supports `runId` and `batchRunId` dimensions for locating run instances
- `matchPipelineIdentityTarget()` implements run instance matching
- Used for precise targeting by CLI status/stop commands

#### AgentService (`agent-service.ts`)

| Method | Description |
|------|------|
| `listAgents()` | List agents (with last activity time, inferred from session cache) |

#### SessionService (`session-service.ts`)

| Method | Description |
|------|------|
| `listSessions(options?)` | List sessions (optionally refresh) |
| `getSessionHistory(sessionId)` | Get session history |
| `sendMessage(input)` | Send message (supports auto/chat/sessions modes with fallback) |

#### ArtifactService (`artifact-service.ts`)

| Method | Description |
|------|------|
| `listArtifacts(query?)` | Query artifact listing |
| `getArtifactContent(query)` | Read single artifact content |
| `exportArtifactContents(query?)` | Export artifact contents (aggregated by date→pipeline→node) |

#### SchedulerService (`scheduler-service.ts`)

| Method | Description |
|------|------|
| `toggleScheduler(pipelineId, enabled)` | Toggle scheduler on/off |
| `setSchedulerMode(pipelineId, mode)` | Set scheduler mode (auto/manual) |

#### SystemService (`system-service.ts`)

| Method | Description |
|------|------|
| `getSnapshot()` | Get full system snapshot (gateway status + pipeline list + bootstrap data) |

#### Service Layer Separation Design (`read-services.ts`)

```
AppServices
├── readonly (read-only services)
│   ├── system:  SystemService
│   ├── pipeline: PipelineService
│   ├── agent:   AgentService
│   ├── session: SessionService
│   └── artifact: ArtifactService
└── writable (writable services)
    ├── pipeline: PipelineService write subset (startPipeline/stopPipeline/retryNode...)
    ├── session: SessionService write subset (sendMessage)
    └── scheduler: SchedulerService
```

The read-only / writable separation ensures that CLI read-only commands cannot accidentally trigger side effects.

---

### 2.4 wevra Module — Agent

**Path**: `src/wevra/`

Wevra is TaskMeld's built-in Agent that provides natural language interface to pipeline management and system operations.

#### Architecture Overview

```
WevraAgent (Facade)
├── brain: Brain              // LLM reasoning layer
├── toolRegistry: ToolRegistry
├── toolExecutor: ToolExecutor
├── conversations: ConversationManager
├── memory: WevraMemory
├── skills: SkillRegistry
├── loop: WevraLoop
├── config: WevraConfig
├── services: ReadonlyServices | null
├── app: PipelineRegistry | null
├── pluginRegistry: PluginRegistry | null
└── userGlobalPrefs: ToolPreferences
```

#### 2.4.1 Core Components

**WevraAgent** (`index.ts`)
- Facade class that assembles all subsystems
- Single entry point for all Agent operations
- Manages model configuration, thinking levels, and active chats

**Brain** (`brain/index.ts`)
- LLM reasoning engine wrapping OpenAICompatClient
- Supports synchronous and SSE streaming chat
- Multi-provider compatibility (DeepSeek, OpenAI, Xiaomi MiMo)
- DeepSeek `reasoning_content` passthrough
- Safe JSON parsing for incomplete tool calls
- Timeout and abort protection (120s default)

**WevraLoop** (`loop/agent-loop.ts`)
- ReAct (Reasoning + Acting) pattern implementation
- Multi-turn reasoning loop: think → call tools → observe → continue
- Maximum 25 iterations per conversation turn
- Mode injection (plan/normal/auto)
- Confirmation flow for write operations

**ToolRegistry** (`tools/registry.ts`)
- Map-based tool registry
- 28 built-in tools across 8 categories
- Tool definitions exported to LLM for function calling

**ToolExecutor** (`tools/executor.ts`)
- 5-step execution lifecycle: Lookup → Validate → Permission → Execute → Truncate
- Parallel execution via `Promise.all()`
- Permission checking based on tool annotations and user preferences
- 30s timeout per tool execution
- Output truncation at 30K characters

#### 2.4.2 Tool System

**Tool Categories:**

| Category | Count | Tools | Status |
|----------|-------|-------|--------|
| Pipeline | 12 | pipeline_list, pipeline_get, pipeline_create, pipeline_update, pipeline_delete, pipeline_status, pipeline_diagnose, pipeline_run, pipeline_stop, pipeline_plugin, pipeline_node, pipeline_validate | ✅ Connected |
| Agent | 6 | agent_list, agent_get, agent_create, agent_update, agent_delete, agent_send | ✅ Connected |
| System | 3 | system_status, system_gateway, system_time | ✅ Connected |
| Memory | 2 | memory_recall, memory_remember | ✅ Connected |
| Skill | 1 | skill_load | ✅ Connected |
| Artifact | 2 | artifact_list, artifact_get | ✅ Connected |
| Session | 3 | session_list, session_get, session_history | ✅ Connected |
| Web | 2 | web_search, web_fetch | ✅ Connected |

**Tool Annotations:**
```typescript
interface ToolAnnotations {
  readOnly: boolean              // Read-only operation
  destructive: boolean           // Destructive operation
  requiresConfirmation: boolean  // Requires user confirmation
  idempotent: boolean            // Idempotent operation
}
```

**Permission Decision Matrix (normal mode):**
- `readOnly=true` → allow
- `destructive=true` → confirm
- `requiresConfirmation=true` → confirm
- In `alwaysDeny` list → deny
- In `alwaysAllow` list → allow
- Otherwise → allow

#### 2.4.3 Agent Tools (New!)

Complete agent lifecycle management through natural language:

**CRUD Operations:**
- `agent_list` — List all registered agents with activity filtering
- `agent_get` — Get detailed agent info with optional session inclusion
- `agent_create` — Create new agent (requires confirmation)
- `agent_update` — Update agent name/workspace (requires confirmation)
- `agent_delete` — Delete agent permanently (requires confirmation, destructive)

**Communication:**
- `agent_send` — Send message to agent and wait for reply
  - Synchronous communication (waits for reply)
  - Custom session ID support for parallel conversations
  - Configurable timeout (10s - 5min)
  - Automatic execution (no confirmation needed)

**Session ID Format:**
```
agent:{sessionId}:{agentId}
Example: agent:main:agent-123
```

**Implementation:**
- Uses `AgentService` for CRUD operations (gateway RPC: agents.create, agents.update, agents.delete)
- Uses `SessionService.sendMessageAndWaitForReply()` for agent_send (gateway RPC: chat.send or sessions.send)
- All write operations require user confirmation
- Clear error messages with timeout distinction

#### 2.4.4 Conversation Manager

**Path**: `src/wevra/conversation/`

Persistent conversation management:

- **JSONL Storage** — One file per conversation, append-only
- **Message Cache** — In-memory cache for fast access
- **Crash Recovery** — Automatic repair of interrupted tool chains
- **Auto-archive** — Conversations inactive >24 hours auto-archived
- **Mode Tracking** — Per-conversation mode (plan/normal/auto)
- **Token Tracking** — Per-conversation token usage

**Storage Structure:**
```
{dataDir}/wevra/conversations/
├── index.json              ← All conversation metadata
├── {convId-1}.jsonl        ← Conversation 1 messages
├── {convId-2}.jsonl        ← Conversation 2 messages
└── ...
```

#### 2.4.5 Skill System

**Path**: `src/wevra/skills/`

Skills are behavior guidelines, not tools:

**Invocation Types:**
- `always` — Injected into every System Prompt
- `auto` — LLM loads via `skill_load` tool when needed
- `user` — User manually triggers
- `model` — LLM decides when to load

**Built-in Skills:**
1. **core-behavior** (always) — Basic behavior guidelines
2. **pipeline-management** (auto) — Pipeline creation workflow
3. **failure-diagnosis** (auto) — Failure analysis workflow

#### 2.4.6 Memory System

**Path**: `src/wevra/memory/`

Cross-session knowledge accumulation:

- **In-memory Storage** — Map-based, grouped by scope (global/pipeline)
- **Keyword Recall** — Simple substring matching with importance weighting
- **Auto-extraction** — (Stub) LLM automatically extracts memories from conversations
- **Tool Integration** — `memory_remember` and `memory_recall` tools

**Memory Entry Structure:**
```typescript
interface MemoryEntry {
  content: string
  type: 'fact' | 'preference' | 'event' | 'summary'
  scope: 'global' | 'pipeline'
  scopeRef?: string
  importance: number  // 0-1
  tags: string[]
  source: string
  createdAt: string
}
```

#### 2.4.7 Permission System

**Path**: `src/wevra/preferences.ts`

Three execution modes:

| Mode | Description | Available Tools |
|------|-------------|-----------------|
| `plan` | Read-only | Only `readOnly=true` tools |
| `normal` | Default | Read-only free, write/destructive need confirmation |
| `auto` | Automatic | All tools execute without confirmation |

**Preferences:**
- Per-conversation preferences
- Global user preferences
- Merged at runtime (conversation overrides global)
- Persisted to `{dataDir}/wevra/tool-preferences.json`

#### 2.4.8 Prompt Builder

**Path**: `src/wevra/loop/prompt-builder.ts`

System Prompt construction:

- **buildGlobalPrompt()** — Global conversation prompt with:
  - Identity section
  - Guidelines
  - Common workflows
  - Environment info
  - Global memory
  - Available skills index

- **buildPipelinePrompt()** — Pipeline-scoped prompt (Phase 4, not yet integrated)

- **Frozen Prompt** — System Prompt frozen at conversation creation for cache efficiency

#### 2.4.9 WebSocket Integration

**19 WS Methods:**

| Category | Methods |
|----------|---------|
| Core | wevra.chat, wevra.status, wevra.debug |
| Conversations | wevra.conversations.create/rename/archive/delete/list/view |
| Models | wevra.models, wevra.models.reload, wevra.models.set-thinking-level |
| Config | wevra.config.get, wevra.models.add-provider/update-provider/remove-provider/set-default |
| Preferences | wevra.tool-preferences.get/set-mode/always-allow/revoke/save-global |
| Confirmation | wevra.confirm |

**Stream Events:**
- thinking_start/delta/end
- text_start/delta/end
- tool_start/result
- step_finish
- confirm_request
- error

#### 2.4.10 Data Flow

```
User Input → Frontend → wsRequest("wevra.chat")
  → Transport layer injects mode marker
  → WevraAgent.chat()
    → ConversationManager appends user message, loads full history
    → WevraLoop.run()
      → Builds request: frozenPrompt + expandedHistory
      → Brain.streamChat() → SSE streaming reasoning
      → If tool_calls → ToolExecutor parallel execution
        → Permission check (resolvePermission)
        → Needs confirmation → onConfirm callback → Frontend dialog
        → Tool results appended to history → Back to Brain
      → No tool_calls → Returns text result
    → Messages persisted to JSONL via onMessage callback
  → Stream events broadcast to frontend via wevra.stream
```

#### 2.4.11 Multi-Provider Configuration

**Built-in Providers:**
- **DeepSeek** — V4 Flash/Pro (1M context, reasoning)
- **OpenAI** — GPT-5.4/5.5 (1M context, reasoning)
- **Xiaomi** — MiMo V2/V2.5 (up to 1M context)

**Custom Providers:**
```json
{
  "version": 1,
  "default": { "provider": "deepseek", "model": "deepseek-v4-flash" },
  "providers": {
    "custom-provider": {
      "baseUrl": "https://my-api.com/v1",
      "apiKey": "sk-xxx",
      "models": [{ "id": "my-model", "name": "My Model", "contextWindow": 128000 }]
    }
  }
}
```

#### 2.4.12 Development Status

**Phase 1 — Foundation ✅**
- Core framework, Brain, Loop, 28 tools, Conversation, Permission, Skills, Memory

**Phase 2 — Reliability 🔶 In Progress**
- Mode versioning, thinking persistence, abort support ✅
- Token management, loop detection, memory persistence ❌

**Phase 3 — Real Tool Integration ✅ Complete**
- All Pipeline tools (12) connected ✅
- All Agent tools (6) connected ✅
- All read-only tools connected ✅

**Phase 4 — Pipeline Scoping ❌ Not Started**
- Pipeline-scoped conversations
- Cross-pipeline access control

**Phase 5 — UX Polish ❌ Not Started**
- Frontend mode restore
- Global settings page

---

### 2.5 transport Module — WebSocket Transport

**Path**: `src/transport/`

Unified WebSocket transport layer handling both broadcast events and RPC requests.

#### ws-broker.ts — WebSocket Broadcast

```typescript
type WsBroker = {
  broadcast: (payload: unknown) => void;  // Broadcast to all connected clients
  close: () => void;                      // Close all connections
};
```

**How it works**:
1. `createWsBroker({ server, path, getBootstrapPayload })` creates the broker
2. Mounts WebSocket Server on the HTTP Server (`/api/ws`)
3. When a new connection is established, immediately sends `{ type: "bootstrap", payload: ... }` (full state snapshot)
4. Subsequent incremental events are pushed via `broadcast()`

#### ws-handler.ts — WebSocket RPC Handler

Handles incoming RPC requests from clients. Dispatches to registered WS methods.

#### ws-methods/ — WS Method Registry

All business API endpoints are now WebSocket RPC methods:

| Module | Methods | Description |
|------|------|------|
| `agents.ts` | `agent.list`, `agent.files.list`, `agent.files.get`, `agent.files.set` | Agent management |
| `sessions.ts` | `session.list`, `session.create`, `session.history`, `session.send` | Session management |
| `pipelines.ts` | `pipeline.list`, `pipeline.create`, `pipeline.delete`, `pipeline.rename` | Pipeline CRUD |
| `pipeline-runtime.ts` | `pipeline.current`, `pipeline.run`, `pipeline.stop`, `pipeline.status`, `pipeline.items`, `pipeline.node.retry`, `pipeline.executorBindings`, `pipeline.tick` | Pipeline execution |
| `pipeline-workflow.ts` | `pipeline.workflow.get`, `pipeline.workflow.save`, `pipeline.template`, `pipeline.plugins.get`, `pipeline.plugins.save` | Workflow management |
| `pipeline-batch.ts` | `pipeline.batchRun.status`, `pipeline.batchRun.start`, `pipeline.batchRun.startRemote`, `pipeline.batchRun.stop` | Batch run |
| `pipeline-scheduler.ts` | `pipeline.scheduler.toggle`, `pipeline.scheduler.mode` | Scheduler |
| `pipeline-links.ts` | `pipeline.link.list`, `pipeline.link.create`, `pipeline.link.update`, `pipeline.link.delete` | Cross-pipeline links |
| `pipeline-queue.ts` | `pipeline.queue.list`, `pipeline.queue.retry`, `pipeline.queue.cancel`, `pipeline.queue.drain` | Inbound queue |
| `artifacts.ts` | `artifact.list`, `artifact.content`, `artifact.export` | Artifact storage |
| `timeline.ts` | `timeline.list` | Timeline |
| `logs.ts` | `log.timeline`, `log.runs.list` | Runtime logs |
| `gateway.ts` | `gateway.status` | Gateway status |

**Broadcast event types**:
- `bootstrap` — Full state push (on new connection / pipeline change)
- `pipeline.updated` — Pipeline runtime update
- `timeline.updated` — Timeline update
- `gateway.status` — Gateway connection state change
- `gateway.frame` — Gateway event frame (health/tick high-frequency events are filtered out, not broadcast)
- `gateway.ready` — Gateway handshake complete
- `gateway.error` — Gateway error

---

### 2.6 gateway Module — External Communication Client

**Path**: `src/gateway/`

Communicates with remote agent gateways via WebSocket.

#### Gateway Protocol

**Frame types** (`GatewayFrame`):
- `req` — Request frame (type, id, method, params)
- `res` — Response frame (type, id, ok, payload, error)
- `event` — Event frame (type, event, payload, seq, stateVersion)

**Connection lifecycle**:
1. `idle` → `connecting` → `ws_open`
2. Wait for `connect.challenge` event
3. `challenged` → `connect_sent` → Wait for `hello-ok` response
4. `ready` (handshake successful)

**Connection state machine**:
```
idle → connecting → ws_open → challenged → connect_sent → ready
                                     ↓
                    failed_auth / failed_protocol / failed_timeout / failed_transport
```

#### GatewayClient (`gateway-client.ts`)

| Method | Description |
|------|------|
| `connect()` | Initiate connection (with ED25519 device signature authentication) |
| `close()` | Close connection (isManualClose=true, no reconnect) |
| `sendReq(method, params, opts?)` | Send request and wait for response (15s timeout) |
| `onEvent(handler)` | Register event listener |
| `getStatus()` | Get current connection status |
| `getSocket()` | Get raw WebSocket instance |

**Device authentication**:
- ED25519 key pair generated on first startup, persisted to `~/.taskmeld/openclaw-device.json` by default
- Private key used to sign device info on connection
- Supports v1 (no nonce) and v2 (with nonce) signature formats

**Reconnection mechanism**:
- Exponential backoff: `BASE_RECONNECT_MS * 2^attempt` (capped at 30s), with 20% random jitter
- Authentication failure (`failed_auth`) and protocol failure (`failed_protocol`) do not auto-reconnect
- Manual close (`isManualClose=true`) does not reconnect

**Type definitions** (`types.ts`):
- `GatewayConnectParams` — Connection parameters (minProtocol, client, role, scopes, auth, device...)
- `HelloOkPayload` — Handshake success response (protocol, policy, auth...)
- `SendReqOptions` — Request options (timeoutMs, sideEffect, idempotencyKey)

---

### 2.7 app Module — Application Assembly Layer

**Path**: `src/app/`

Responsible for assembling all modules into a runnable application context.

#### PipelineRegistry (`pipeline-registry.ts`)

Pipeline registry, manages the lifecycle of multiple pipelines:

```typescript
type PipelineRegistry = {
  // Lifecycle
  initialize(): Promise<void>;
  dispose(): void;

  // Pipeline CRUD
  listPipelines(): PipelineDefinition[];
  createPipeline(input): Promise<PipelineDefinition>;
  renamePipeline(pipelineId, title): PipelineDefinition;
  deletePipeline(pipelineId): { pipelineId: string };
  getPipelineRuntime(pipelineId): PipelineRuntime | null;
  getPrimaryRuntime(): PipelineRuntime;
  getPipelineDefinition(pipelineId): PipelineDefinition | null;

  // Aggregated data
  getBootstrapPayload(): object;  // Full state snapshot

  // Gateway event routing
  onGatewayStatus(status): void;
  onGatewayFrame(frame): void;
  onGatewayError(error): void;
  onGatewayReady(hello): void;

  // Sub-modules exposed to upper layers
  gateway: { client, getLatestStatus, getLatestHello, getLastFrame, ... };
  runtime: { setBroadcast, getCombinedTimeline };
};
```

**Multi-pipeline design**:
- Each pipeline has an independent `PipelineRuntime` instance
- Default pipeline ID is determined by configuration (default "A")
- Gateway events are broadcast to all pipelines
- Global broadcasts (gateway.status/ready/frame) only pass through one copy from the primary pipeline
- Timeline merging from all pipelines

#### PipelineRuntime (`pipeline-runtime.ts`)

Runtime instance for a single pipeline, assembles four subsystems: graph + store + execution + scheduler:

```
PipelineRuntime
├── runtime:    RuntimeStore (runtime state, timeline, broadcast)
├── gateway:    Gateway interaction (status/hello/frame, session cache)
├── workflow:   WorkflowGraph (workflow definitions and templates)
├── pipeline:   Execution and scheduling (executeNode, drainPipeline, batchRun...)
└── lifecycle:  initialize, dispose, event handling
```

#### RuntimeStore (`runtime-store.ts`)

Runtime state storage for a single pipeline:

- In-memory runtime state (`Run` object)
- Timeline (`TimelineItem[]`)
- Gateway status cache (`latestStatus`, `latestHello`, `lastFrame`)
- Persistence: run-state.json file reads/writes
- Broadcast interface: `emitPipeline()` and `pushTimeline()` trigger WebSocket broadcasts
- Recovery mechanism: restore previous run state from `run-state.json` on startup

#### AppContext (`create-app-context.ts`)

Application-wide context, the common entry point for CLI and Server:

```typescript
type AppContext = {
  config: ResolvedAppContextConfig;  // Resolved configuration
  app: PipelineRegistry;            // Pipeline registry
  services: { readonly, writable }; // Read-only / writable service layers
  api: { port, host, webOrigin };   // API server configuration
  gateway: {                        // Gateway connection management
    url, token, scopes, client,
    setHandlers, getHandlers, connect
  };
  initialize(): Promise<void>;
  dispose(): void;
};
```

**Dependency injection flow**:
1. `createAppContext(options)` → Parse environment variables / config
2. Create `GatewayClient` (lazy initialization)
3. Create `PipelineRegistry` → Load pipeline definitions → Create PipelineRuntime for each pipeline
4. Create `AppServices` (read-only / writable separation)
5. Return complete `AppContext`

#### AppConfig (`app-context-env.ts` / `pipeline-config.ts`)

| File | Responsibility |
|------|------|
| `app-context-env.ts` | Parse environment variables → application runtime config (port, domain, scopes, itemKeys) |
| `pipeline-config.ts` | Pipeline definition management (index.json persistence, CRUD, defaults) |

**Environment variables**:
- `OPENCLAW_GATEWAY_URL` — Gateway address
- `OPENCLAW_GATEWAY_TOKEN` — Gateway authentication token
- `OPENCLAW_GATEWAY_SCOPES` — Gateway permission scopes (default `operator.read,operator.write,operator.admin`)
- `OPENCLAW_PIPELINE_ITEMS` — Default itemKey list (default `global`)
- `API_PORT` / `API_HOST` / `WEB_ORIGIN` — Server configuration
- `PIPELINE_NODE_EXECUTION_TIMEOUT_MS` — Node execution timeout (default 15 minutes)
- `TASKMELD_DATA_DIR` — Override default data directory

**Data directory isolation**:
- **Production** (CLI): `~/.taskmeld/`
- **Development** (`npm run dev`): `<project>/.data/` (auto-detected via `tsx` in argv)
- **Testing** (`npm test`): `<project>/.data/` (auto-detected via test path in argv)
- Override: Set `TASKMELD_DATA_DIR` environment variable

**Persisted files** (relative to data dir):
- `pipelines/index.json` — Pipeline definition index
- `pipelines/<id>/workflow.json` — Workflow definition
- `pipelines/<id>/run-state.json` — Runtime state snapshot
- `pipelines/<id>/artifacts/` — Artifact directory
- `pipelines/_deleted/` — Deleted pipeline archive
- `logs/runs/<runId>/timeline.log` — Runtime log (NDJSON)

---

### 2.8 artifacts Module — Artifact Storage

**Path**: `src/artifacts/storage-service.ts`

Provides query and read capabilities for runtime artifacts.

**Artifact directory structure**:

```
artifacts/
├── success/
│   └── 2025-01-15/
│       └── run-xxx/
│           ├── envelopes/          # Structured output receipts
│           │   └── run-xxx-n1-node-n1-uuid-envelope.json
│           └── artifacts/          # Actual artifact files
│               ├── run-xxx-n1-0-output.json
│               └── run-xxx-n1-adapter-output.json
├── failed/
│   └── 2025-01-15/
│       └── run-xxx/
│           └── ...
└── rejected/                       # Artifacts archived due to rejection
    └── run-xxx-n1-rejected-by-n2-timestamp-filename
```

**Core functions**:

| Function | Description |
|------|------|
| `listStoredArtifacts(definitions, options?)` | Traverse all pipeline artifact directories, return artifact list (supports pipelineId/nodeId/date filtering) |
| `readStoredArtifactContent(definition, relativePath)` | Read single artifact file content (parse JSON, extract artifact.content) |
| `exportStoredArtifactContents(definitions, options?)` | Batch export artifact contents (three-level aggregation: date→pipeline→node) |

**Artifact parsing**:
- Preferentially extract `artifact.content` field
- Fall back to `envelope.artifacts[].content` + `envelope.logs`
- Path traversal protection: only allow reading files under the current pipeline's artifactDir

---

### 2.9 logs Module — Runtime Logs

**Path**: `src/logs/`

#### Log Types (`run-log-types.ts`)

```typescript
type RunLogEntry = {
  id: string; ts: string; level: "info" | "warn" | "error";
  runId: string; text: string; detail?: unknown;
};

type RunLogPage = {
  items: RunLogEntry[]; total: number;
  offset: number; limit: number;
  nextOffset: number | null; hasMore: boolean;
  parseErrorCount: number;
};
```

#### Log Service (`run-log-service.ts`)

| Method | Description |
|------|------|
| `listRuns()` | List all runtime log directories (sorted by name descending) |
| `queryTimeline(query)` | Paginated runtime log query (supports level/keyword/order filtering) |
| `readRawTimeline(runId)` | Return raw NDJSON log file path |

#### Log Reader (`run-log-reader.ts`)

- `readRunLogPage(logFile, query)` — Read NDJSON file, parse line by line, filter in memory, slice by pagination
- Supports filtering by runId, level, keyword
- Supports asc/desc ordering
- Supports pagination (offset + limit) or full read (limit=undefined)

---

## 3. Inter-Module Call Relationships

```
CLI (src/cli/)
  │
  ├──> services/read-services  (read-only operations)
  │      └──> PipelineRegistry
  │             └──> PipelineRuntime
  │                    ├──> RuntimeStore
  │                    ├──> WorkflowGraph
  │                    ├──> ExecutionService
  │                    │      ├──> GatewayClient (sendReq)
  │                    │      ├──> SessionRegistry
  │                    │      ├──> StructuredNodeRunner
  │                    │      └──> RouteItemManager
  │                    └──> SchedulerService
  │                           ├──> DependencyState
  │                           ├──> ItemBatchController
  │                           └──> ExecutionService
  │
  ├──> services/writable-services (write operations)
  │      └──> (same as above)
  │
  └──> GatewayClient (session message sending, etc.)
         └──> Remote Agent Gateway (WebSocket)

Server HTTP API (src/server/)
  │
  ├──> PipelineRegistry (direct calls)
  ├──> services/pipeline-service
  ├──> services/scheduler-service
  ├──> logs/run-log-service
  ├──> artifacts/storage-service
  └──> GatewayClient (agent list, files, sessions)

WebSocket Transport (src/transport/)
  │
  └──> PipelineRegistry.getBootstrapPayload()  (initial snapshot)
       PipelineRuntime.runtime.setBroadcast()   (incremental push)

Gateway Client (src/gateway/)
  │
  └──> Remote Agent Gateway (WebSocket bidirectional communication)
```

---

## 4. Key Types and Interfaces Summary

### Core Domain Types

| Type | Location | Description |
|------|------|------|
| `Run` | `pipeline/runtime-model.ts` | Single run state container |
| `NodeRun` | `pipeline/runtime-model.ts` | Node run state |
| `NodeItemRun` | `pipeline/runtime-model.ts` | Batch run node item run state |
| `GroupRun` | `pipeline/runtime-model.ts` | Parallel group run state |
| `ArtifactManifest` | `pipeline/runtime-model.ts` | Artifact manifest |
| `TimelineItem` | `pipeline/runtime-model.ts` | Timeline entry |
| `WorkflowDefinitionRuntime` | `pipeline/template.ts` | Workflow DAG definition |
| `PipelineTemplateNode` | `pipeline/template.ts` | Template node |
| `WorkflowNode` | `pipeline/template.ts` | Workflow node |
| `WorkflowEdge` | `pipeline/template.ts` | Workflow edge |
| `WorkflowGroup` | `pipeline/template.ts` | Parallel group |
| `ResultEnvelope` | `pipeline/structured-output/contract.ts` | Structured output receipt |
| `PipelineDefinition` | `app/pipeline-config.ts` | Pipeline definition |
| `ItemBatchRunSnapshot` | `pipeline/item-batch-controller.ts` | Batch run snapshot |
| `PipelineExecutionStatusPayload` | `pipeline/execution-status.ts` | Execution status snapshot |
| `RunLogEntry` / `RunLogPage` | `logs/run-log-types.ts` | Runtime log entry/page |
| `StoredArtifactItem` / `StoredArtifactContent` | `artifacts/storage-service.ts` | Artifact entry/content |

### Core Interfaces

| Interface | Location | Description |
|------|------|------|
| `Router` | `server/types.ts` | HTTP route registration and matching |
| `RouteHandler` | `server/types.ts` | Route handler function |
| `RequestContext` | `server/types.ts` | Request context |
| `PipelineScopedContext` | `server/types.ts` | Pipeline-scoped context |
| `GatewayClient` | `gateway/gateway-client.ts` | Gateway client |
| `PipelineRegistry` | `app/pipeline-registry.ts` | Pipeline registry |
| `PipelineRuntime` | `app/pipeline-runtime.ts` | Single pipeline runtime instance |
| `RuntimeStore` | `app/runtime-store.ts` | Runtime state storage |
| `WorkflowGraph` | `pipeline/workflow-graph.ts` | Workflow graph computation |
| `ExecutionService` | `pipeline/execution-service.ts` | Node execution engine |
| `SchedulerService` | `pipeline/scheduler-service.ts` | Scheduling engine |
| `WsBroker` | `transport/ws-broker.ts` | WebSocket broadcaster |
| `AppContext` | `app/create-app-context.ts` | Application-wide context |
| `PipelineService` | `services/pipeline-service.ts` | Pipeline business service |
| `AgentService` | `services/agent-service.ts` | Agent service |
| `SessionService` | `services/session-service.ts` | Session service |
| `ArtifactService` | `services/artifact-service.ts` | Artifact service |
| `SchedulerService` | `services/scheduler-service.ts` | Scheduler service |
| `SystemService` | `services/system-service.ts` | System snapshot service |

---

## 5. Persistence Overview

| Path | Format | Content |
|------|------|------|
| `~/.taskmeld/pipelines/index.json` | JSON | Pipeline definition index (version, defaultPipelineId, items) |
| `~/.taskmeld/pipelines/<id>/workflow.json` | JSON | Workflow DAG definition (v3.0) |
| `~/.taskmeld/pipelines/<id>/run-state.json` | JSON | Runtime state snapshot (savedAt, workflowVersion, run) |
| `~/.taskmeld/pipelines/<id>/artifacts/<status>/<date>/<runId>/` | Directory | Artifact files (envelopes + artifacts) |
| `~/.taskmeld/pipelines/_deleted/` | Directory | Deleted pipeline archive |
| `~/.taskmeld/logs/runs/<runId>/timeline.log` | NDJSON | Runtime timeline log |
| `~/.taskmeld/openclaw-device.json` | JSON | Device identity key |
