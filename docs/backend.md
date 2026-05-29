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
│                    HTTP/WS Transport Layer                    │
│  ┌──────────────────┐  ┌──────────────────┐                 │
│  │   server module   │  │  transport module │                 │
│  │  HTTP API + routes│  │  WebSocket broadcast│               │
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

1. **Inbound request flow**: CLI / Web frontend → HTTP API (server) → Service layer (services) → PipelineRegistry → PipelineRuntime → Pipeline engine
2. **Outbound event flow**: Pipeline engine → PipelineRuntime → PipelineRegistry → WebSocket Broker (transport) → Web frontend
3. **External agent communication**: PipelineRuntime → GatewayClient → Remote agent gateway (WebSocket)
4. **Persistence flow**: Pipeline engine → RuntimeStore (run-state.json) / TimelineLogStore (timeline.log) / ArtifactDirs (artifact files)

---

## 2. Module Details

---

### 2.1 server Module — HTTP API Layer

**Path**: `src/server/`

**File listing**:

| File | Responsibility |
|------|------|
| `types.ts` | Core type definitions: `ApiHandlerContext`, `RequestContext`, `RouteHandler`, `Router` interface |
| `router.ts` | Trie-based HTTP router implementation |
| `middleware.ts` | Middleware composer + CORS + error catching middleware |
| `http-utils.ts` | JSON request body parsing / JSON response sending utilities |
| `api-handler.ts` | Top-level API handler, assembles routes, middleware, service dependencies |
| `routes/health.ts` | Health check endpoint |
| `routes/gateway.ts` | Gateway status query |
| `routes/timeline.ts` | Timeline query |
| `routes/logs.ts` | Runtime log query |
| `routes/artifacts.ts` | Artifact listing/content/export |
| `routes/agents.ts` | Agent listing + file management |
| `routes/sessions.ts` | Session listing/history/message sending |
| `routes/pipelines.ts` | Pipeline CRUD |
| `routes/pipeline-workflow.ts` | Workflow/template/plugin read/write |
| `routes/pipeline-runtime.ts` | Pipeline run control (start/stop/retry) |
| `routes/pipeline-batch.ts` | Batch run management (local/remote) |
| `routes/pipeline-scheduler.ts` | Scheduler toggle/mode/manual tick |
| `routes/pipeline-identity.ts` | Run identity resolution (runId/batchRunId) |

#### Router Design

Trie-based route matcher:

```typescript
interface Router {
  register(method: string, path: string, handler: RouteHandler): void;
  match(method: string, pathname: string): { handler: RouteHandler; params: Record<string, string> } | null;
}
```

Supports three types of path segments:
- **Static segments**: `/api/health` exact match
- **Parameter segments**: `/api/pipelines/:pipelineId` extracts named parameters
- **Wildcard segments**: `/api/agents/:agentId/files/*name` matches remaining path

#### API Endpoint Overview

| Method | Path | Description |
|------|------|------|
| `GET` | `/api/health` | Service health check, returns serverId/pid/port |
| `GET` | `/api/gateway/status` | Gateway connection status, hello, lastFrame |
| `GET` | `/api/timeline` | Merged timeline across all pipelines |
| `GET` | `/api/logs/runs` | Runtime log directory listing |
| `GET` | `/api/logs/runs/:runId/timeline` | Paginated runtime log query (supports level/keyword/order) |
| `GET` | `/api/logs/runs/:runId/timeline/raw` | Raw NDJSON log file stream |
| `GET` | `/api/artifacts` | Artifact listing (supports pipelineId/nodeId/date filtering) |
| `GET` | `/api/artifacts/content` | Single artifact content read |
| `GET` | `/api/artifacts/export` | Aggregated artifact content export (date→pipeline→node→content) |
| `GET` | `/api/agents` | Agent listing (with last activity time) |
| `GET` | `/api/agents/:agentId/files` | Agent file listing |
| `GET` | `/api/agents/:agentId/files/*name` | Agent file content read |
| `POST` | `/api/agents/:agentId/files/*name` | Agent file write |
| `GET` | `/api/sessions` | Session listing (includes model info) |
| `GET` | `/api/sessions/:sessionId/history` | Session history |
| `POST` | `/api/sessions` | Create session |
| `POST` | `/api/sessions/:sessionId/send` | Send session message (auto/chat/sessions modes) |
| `GET` | `/api/pipelines` | Pipeline listing |
| `POST` | `/api/pipelines` | Create pipeline (supports cloneFrom) |
| `PATCH` | `/api/pipelines/:pipelineId` | Rename pipeline |
| `DELETE` | `/api/pipelines/:pipelineId` | Delete pipeline (archive to _deleted directory) |
| `GET` | `/api/pipelines/:pipelineId/template` | Template nodes |
| `GET` | `/api/pipelines/:pipelineId/workflow` | Workflow definition |
| `POST` | `/api/pipelines/:pipelineId/workflow` | Save workflow definition (with validation) |
| `GET` | `/api/pipelines/:pipelineId/plugins` | Plugin configuration |
| `POST` | `/api/pipelines/:pipelineId/plugins` | Update plugin configuration (remoteBatch/scheduler) |
| `GET` | `/api/pipelines/:pipelineId/current` | Current run snapshot |
| `GET` | `/api/pipelines/:pipelineId/status` | Pipeline run status |
| `POST` | `/api/pipelines/:pipelineId/run` | Start run (including remote batch run) |
| `POST` | `/api/pipelines/:pipelineId/stop` | Stop batch run |
| `GET` | `/api/pipelines/:pipelineId/executor-bindings` | Executor session bindings |
| `POST` | `/api/pipelines/:pipelineId/nodes/:nodeId/retry` | Retry node |
| `GET` | `/api/pipelines/:pipelineId/items` | Item Run listing |
| `GET` | `/api/pipelines/:pipelineId/batch-run/status` | Batch Run status |
| `POST` | `/api/pipelines/:pipelineId/batch-run/start` | Start local batch run |
| `POST` | `/api/pipelines/:pipelineId/batch-run/start-remote` | Start remote batch run |
| `POST` | `/api/pipelines/:pipelineId/batch-run/stop` | Stop batch run |
| `POST` | `/api/pipelines/:pipelineId/scheduler/toggle` | Toggle scheduler on/off |
| `POST` | `/api/pipelines/:pipelineId/scheduler/mode` | Set scheduler mode (auto/manual) |
| `POST` | `/api/pipelines/:pipelineId/tick` | Manually trigger a scheduler tick |

#### Request Handling Flow

1. `createApiHandler(options)` creates the request handler
2. All route modules register with the Router instance returned by `createRouter()`
3. Middleware chain: `errorMiddleware` → `corsMiddleware` → route handler
4. When each request arrives:
   - Match route, extract params
   - Build `RequestContext` (includes services, sendJson, readBody, getPipelineScope)
   - Inject `PipelineScopedContext` (only when the route includes the `:pipelineId` parameter)
   - Execute route handler through the middleware chain

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

### 2.4 transport Module — WebSocket Broadcast

**Path**: `src/transport/ws-broker.ts`

WebSocket broadcast mechanism based on the `ws` library:

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

**Broadcast event types**:
- `bootstrap` — Full state push (on new connection / pipeline change)
- `pipeline.updated` — Pipeline runtime update
- `timeline.updated` — Timeline update
- `gateway.status` — Gateway connection state change
- `gateway.frame` — Gateway event frame (health/tick high-frequency events are filtered out, not broadcast)
- `gateway.ready` — Gateway handshake complete
- `gateway.error` — Gateway error

---

### 2.5 gateway Module — External Communication Client

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

### 2.6 app Module — Application Assembly Layer

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

**Persisted files**:
- `~/.taskmeld/pipelines/index.json` — Pipeline definition index
- `~/.taskmeld/pipelines/<id>/workflow.json` — Workflow definition
- `~/.taskmeld/pipelines/<id>/run-state.json` — Runtime state snapshot
- `~/.taskmeld/pipelines/<id>/artifacts/` — Artifact directory
- `~/.taskmeld/pipelines/_deleted/` — Deleted pipeline archive
- `~/.taskmeld/logs/runs/<runId>/timeline.log` — Runtime log (NDJSON)

---

### 2.7 artifacts Module — Artifact Storage

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

### 2.8 logs Module — Runtime Logs

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
