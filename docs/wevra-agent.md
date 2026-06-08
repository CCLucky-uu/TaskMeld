# Wevra Agent Documentation

Wevra is TaskMeld's built-in agent for natural language pipeline management. It communicates with the service layer through tools, enabling conversational control over pipelines, agents, and system operations.

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Tools Reference](#tools-reference)
  - [Pipeline Tools](#pipeline-tools) (12 tools)
  - [Agent Tools](#agent-tools) (6 tools)
  - [System Tools](#system-tools) (3 tools)
  - [Memory Tools](#memory-tools) (2 tools)
  - [Skill Tools](#skill-tools) (1 tool)
  - [Artifact Tools](#artifact-tools) (2 tools)
  - [Session Tools](#session-tools) (3 tools)
  - [Web Tools](#web-tools) (2 tools)
- [Conversation Modes](#conversation-modes)
- [WebSocket API](#websocket-api)
- [Configuration](#configuration)
- [Architecture Details](#architecture-details)

---

## Overview

Wevra operates as a single agent instance that interacts with TaskMeld services through a tool-based architecture. The LLM calls tools via function calling; tools call services internally.

**Key characteristics:**
- Zero-dependency framework using native `fetch` for OpenAI-compatible APIs
- 28 built-in tools across 8 categories
- ReAct (Reasoning + Acting) loop for multi-turn execution
- Three-layer architecture: OpenClaw (execution) → TaskMeld (orchestration) → Wevra (intelligence)

---

## Architecture

```
User Input
    ↓
WevraChatPanel (Frontend)
    ↓ WebSocket
WevraAgent (Server)
    ├─ Brain (LLM reasoning)
    ├─ WevraLoop (ReAct loop)
    ├─ ToolExecutor (28 tools)
    ├─ ConversationManager (JSONL)
    └─ Memory (in-memory)
    ↓ Gateway RPC
OpenClaw Gateway
    ↓
OpenClaw Agents (Execution)
```

---

## Tools Reference

### Pipeline Tools

#### pipeline_list

List all registered pipelines.

**Parameters:** None

**Example:**
```
What pipelines do I have?
```

**Returns:** Array of pipeline summaries (ID, title, status)

---

#### pipeline_get

View full details of a specific pipeline.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `pipelineId` | string | Yes | Pipeline ID |

**Example:**
```
Show me the data processing pipeline
```

**Returns:** Pipeline details including nodes, edges, configuration, and run status

---

#### pipeline_create

Create a new pipeline.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | Yes | Pipeline name |
| `description` | string | No | Pipeline description |

**Example:**
```
Create a pipeline called "Daily Sales Report"
```

**Returns:** Created pipeline details

**Note:** Requires user confirmation

---

#### pipeline_update

Update an existing pipeline.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `pipelineId` | string | Yes | Pipeline ID |
| `name` | string | No | New name |
| `description` | string | No | New description |

**Example:**
```
Rename pipeline A to "Production Data Sync"
```

**Returns:** Updated pipeline details

**Note:** Requires user confirmation

---

#### pipeline_delete

Delete a pipeline permanently.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `pipelineId` | string | Yes | Pipeline ID |

**Example:**
```
Delete the old test pipeline
```

**Returns:** Deletion confirmation

**Note:** Requires user confirmation (destructive operation)

---

#### pipeline_status

Get current execution status of a pipeline.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `pipelineId` | string | Yes | Pipeline ID |

**Example:**
```
What's the status of the data processing pipeline?
```

**Returns:** Current run status, node states, and progress

---

#### pipeline_diagnose

Analyze pipeline failures and suggest fixes.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `pipelineId` | string | Yes | Pipeline ID |

**Example:**
```
Why did the sales pipeline fail?
```

**Returns:** Root cause analysis, impact assessment, and suggested fixes

---

#### pipeline_run

Start a pipeline execution.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `pipelineId` | string | Yes | Pipeline ID |

**Example:**
```
Run the data processing pipeline
```

**Returns:** Run ID and initial status

**Note:** Requires user confirmation

---

#### pipeline_stop

Stop a running pipeline.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `pipelineId` | string | Yes | Pipeline ID |

**Example:**
```
Stop the data processing pipeline
```

**Returns:** Stop confirmation

**Note:** Requires user confirmation

---

#### pipeline_plugin

Manage pipeline plugins (scheduler, batch runner).

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `pipelineId` | string | Yes | Pipeline ID |
| `action` | string | Yes | Action: `list`, `get`, `enable`, `disable`, `config` |
| `pluginId` | string | No | Plugin ID (required for get/enable/disable/config) |
| `config` | object | No | Plugin configuration (for config action) |

**Example:**
```
Enable the scheduler plugin for pipeline A
```

**Returns:** Plugin status and configuration

**Note:** Requires user confirmation

---

#### pipeline_node

Manage pipeline nodes (add, update, delete, connect).

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `pipelineId` | string | Yes | Pipeline ID |
| `action` | string | Yes | Action: `add`, `update`, `delete`, `connect` |
| `nodeId` | string | No | Node ID (required for update/delete/connect) |
| `config` | object | No | Node configuration (for add/update) |

**Example:**
```
Add a new node to pipeline A
```

**Returns:** Node details

**Note:** Requires user confirmation

---

#### pipeline_validate

Validate pipeline configuration before running.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `pipelineId` | string | Yes | Pipeline ID |

**Example:**
```
Validate the data processing pipeline before running
```

**Returns:** Validation results with errors and warnings

---

### Agent Tools

#### agent_list

List all registered OpenClaw agents.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `includeInactive` | boolean | No | Include agents inactive >24 hours (default: true) |

**Example:**
```
List all agents
Show only active agents
```

**Returns:** Array of agent summaries (ID, last active time)

---

#### agent_get

Get detailed information about a specific agent.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `agentId` | string | Yes | Agent ID |
| `includeSessions` | boolean | No | Include active sessions (default: false) |

**Example:**
```
Show me details for the DataCollector agent
```

**Returns:** Agent details including metadata and optional sessions

---

#### agent_create

Create a new OpenClaw agent.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | Yes | Agent name |
| `workspace` | string | No | Workspace path (auto-generated if not provided) |

**Example:**
```
Create an agent called "DataValidator"
```

**Returns:** Created agent details

**Note:** Requires user confirmation

---

#### agent_update

Update an existing agent configuration.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `agentId` | string | Yes | Agent ID |
| `name` | string | No | New name |
| `workspace` | string | No | New workspace path |

**Example:**
```
Rename agent A to "Production Validator"
```

**Returns:** Updated agent details

**Note:** Requires user confirmation

---

#### agent_delete

Delete an agent permanently.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `agentId` | string | Yes | Agent ID |
| `deleteFiles` | boolean | No | Delete workspace files (default: false) |

**Example:**
```
Delete the test agent
```

**Returns:** Deletion confirmation

**Note:** Requires user confirmation (destructive operation)

---

#### agent_send

Send a message to an agent and wait for reply.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `agentId` | string | Yes | Agent ID |
| `message` | string | Yes | Message to send |
| `sessionId` | string | No | Session ID (default: "main") |
| `timeoutMs` | number | No | Timeout in ms (default: 120000, max: 300000) |

**Example:**
```
Ask the DataCollector about today's data volume
```

**Returns:** Agent's reply

**Note:** Synchronous execution, waits for reply

---

### System Tools

#### system_status

Get system health and status.

**Parameters:** None

**Example:**
```
What's the system status?
```

**Returns:** Version, platform, memory, uptime, and gateway connection status

---

#### system_gateway

Get OpenClaw Gateway connection details.

**Parameters:** None

**Example:**
```
Show me the gateway connection status
```

**Returns:** Gateway connection details and configuration

---

#### system_time

Query current system time.

**Parameters:** None

**Example:**
```
What time is it?
```

**Returns:** Local time, day of week, timestamp, timezone, and UTC offset

---

### Memory Tools

#### memory_recall

Search memory for relevant information.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | Search query |
| `scope` | string | No | Scope: `global` or `pipeline` (default: global) |
| `topK` | number | No | Number of results (default: 5) |

**Example:**
```
What do you remember about API rate limits?
```

**Returns:** Array of matching memory entries

---

#### memory_remember

Store information in memory.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `content` | string | Yes | Memory content |
| `type` | string | No | Type: `fact`, `preference`, `event`, `summary` (default: fact) |
| `scope` | string | No | Scope: `global` or `pipeline` (default: global) |
| `importance` | number | No | Importance: 0-1 (default: 0.5) |
| `tags` | string[] | No | Tags for categorization |

**Example:**
```
Remember that our API has rate limits of 100 requests per minute
```

**Returns:** Confirmation

---

### Skill Tools

#### skill_load

Load a skill definition.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `skillName` | string | Yes | Skill name |

**Example:**
```
Load the pipeline management skill
```

**Returns:** Full skill content

**Available skills:**
- `core-behavior` — Basic behavior guidelines (always active)
- `pipeline-management` — Pipeline creation workflow
- `failure-diagnosis` — Failure analysis workflow

---

### Artifact Tools

#### artifact_list

List pipeline artifacts.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `pipelineId` | string | No | Filter by pipeline ID |

**Example:**
```
Show me artifacts from the data processing pipeline
```

**Returns:** Array of artifact summaries

---

#### artifact_get

Get artifact content.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `artifactId` | string | Yes | Artifact ID |

**Example:**
```
Show me the content of artifact A
```

**Returns:** Parsed artifact content

---

### Session Tools

#### session_list

List all agent sessions.

**Parameters:** None

**Example:**
```
List all sessions
```

**Returns:** Array of session summaries

---

#### session_get

Get session details.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sessionId` | string | Yes | Session ID |

**Example:**
```
Show me details for session A
```

**Returns:** Session details

---

#### session_history

Get session conversation history.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sessionId` | string | Yes | Session ID |

**Example:**
```
Show me the conversation history for session A
```

**Returns:** Formatted conversation history

---

### Web Tools

#### web_search

Search the web using DuckDuckGo.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | Search query |

**Example:**
```
Search for OpenClaw documentation
```

**Returns:** Array of search results (title, URL, snippet)

---

#### web_fetch

Fetch and extract content from a URL.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `url` | string | Yes | URL to fetch |

**Example:**
```
Fetch the content from https://example.com
```

**Returns:** Extracted text content

---

## Conversation Modes

### Plan Mode

- **Available tools:** Read-only only
- **Use case:** Exploration, analysis, planning
- **Behavior:** Can query but cannot modify

### Normal Mode (Default)

- **Available tools:** All
- **Use case:** General operations
- **Behavior:** Read-only automatic, write/destructive require confirmation

### Auto Mode

- **Available tools:** All
- **Use case:** Automation, trusted workflows
- **Behavior:** All operations automatic, no confirmation

---

## WebSocket API

Wevra exposes 19 WebSocket methods:

| Category | Methods |
|----------|---------|
| Core | `wevra.chat`, `wevra.status`, `wevra.debug` |
| Conversations | `wevra.conversations.create`, `wevra.conversations.rename`, `wevra.conversations.archive`, `wevra.conversations.delete`, `wevra.conversations.list`, `wevra.conversations.view` |
| Models | `wevra.models`, `wevra.models.reload`, `wevra.models.set-thinking-level` |
| Config | `wevra.config.get`, `wevra.models.add-provider`, `wevra.models.update-provider`, `wevra.models.remove-provider`, `wevra.models.set-default` |
| Preferences | `wevra.tool-preferences.get`, `wevra.tool-preferences.set-mode`, `wevra.tool-preferences.always-allow`, `wevra.tool-preferences.revoke`, `wevra.tool-preferences.save-global` |
| Confirmation | `wevra.confirm` |

---

## Configuration

### Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `WEVRA_LLM_BASE_URL` | LLM API base URL | `https://api.deepseek.com` |
| `WEVRA_LLM_API_KEY` | LLM API key | `sk-xxx` |
| `WEVRA_LLM_MODEL` | Default model ID | `deepseek-v4-flash` |
| `WEVRA_THINKING_LEVEL` | Default thinking level | `medium` |

### Configuration File

Location: `~/.taskmeld/wevra/models.json`

```json
{
  "version": 1,
  "default": {
    "provider": "deepseek",
    "model": "deepseek-v4-flash"
  },
  "enabledModels": [
    "deepseek/deepseek-v4-flash",
    "openai/gpt-5.4-mini"
  ],
  "providers": {
    "deepseek": {
      "apiKey": "sk-xxx"
    },
    "custom-provider": {
      "baseUrl": "https://my-api.com/v1",
      "apiKey": "sk-xxx",
      "models": [
        {
          "id": "my-model",
          "name": "My Model",
          "contextWindow": 128000,
          "maxTokens": 16384,
          "reasoning": false
        }
      ]
    }
  }
}
```

### Supported Providers

| Provider | Models | Context | Reasoning |
|----------|--------|---------|-----------|
| DeepSeek | V4 Flash, V4 Pro | 1M | Yes |
| OpenAI | GPT-5.4, GPT-5.5 | 1M | Yes |
| Xiaomi | MiMo V2, V2.5 | 1M | Yes |
| Custom | Any OpenAI-compatible | Varies | Configurable |

---

## Architecture Details

### Core Components

**WevraAgent** — Facade class that assembles all subsystems

**Brain** — LLM reasoning engine
- Native `fetch` implementation
- Multi-provider compatibility
- SSE streaming support
- Timeout protection (120s default)

**WevraLoop** — ReAct pattern implementation
- Multi-turn reasoning loop
- Maximum 25 iterations per turn
- Mode injection (plan/normal/auto)

**ToolExecutor** — Tool execution engine
- 5-step lifecycle: Lookup → Validate → Permission → Execute → Truncate
- Parallel execution via `Promise.all()`
- 30s timeout per tool
- 30K character output limit

**ConversationManager** — JSONL-based persistence
- One file per conversation
- Message cache for fast access
- Crash recovery (interrupted tool chain repair)
- Auto-archive after 24 hours inactivity

### Tool Annotations

Each tool declares properties that control permission behavior:

| Property | Description |
|----------|-------------|
| `readOnly` | Read-only operation |
| `destructive` | Destructive operation |
| `requiresConfirmation` | Requires user confirmation |
| `idempotent` | Idempotent operation |

### Permission Decision Matrix (Normal Mode)

| Condition | Decision |
|-----------|----------|
| `readOnly=true` | Allow |
| `destructive=true` | Confirm |
| `requiresConfirmation=true` | Confirm |
| In `alwaysDeny` list | Deny |
| In `alwaysAllow` list | Allow |
| Otherwise | Allow |

---

## Related Documentation

- [Backend Architecture](backend.md) — Server implementation details
- [CLI Reference](cli.md) — Command-line interface
- [Pipeline Overview](pipeline/overview.md) — Pipeline concepts
