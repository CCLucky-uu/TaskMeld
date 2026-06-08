<p align="center">
  <strong>English</strong>
  &nbsp;·&nbsp;
  <a href="./README.zh-CN.md">简体中文</a>
  &nbsp;·&nbsp;
  <a href="https://taskmeld.com">Website</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/taskmeld"><img src="https://img.shields.io/npm/v/taskmeld.svg?style=flat-square&color=cb3837&labelColor=161b22&logo=npm&logoColor=white" alt="npm version"/></a>
  <a href="./package.json"><img src="https://img.shields.io/node/v/taskmeld.svg?style=flat-square&color=5fa04e&labelColor=161b22&logo=nodedotjs&logoColor=white" alt="node"/></a>
</p>

<br/>

<h1 align="center">TaskMeld</h1>
<h3 align="center">Agent Pipeline Orchestration Platform</h3>
<p align="center">Compose <strong>OpenClaw agents</strong> into executable pipelines — define, run, observe, and iterate with <strong>Wevra Agent</strong>.</p>

<br/>

> [!TIP]
> **The Stack:**
> - **OpenClaw** — Agent execution runtime (pipeline nodes)
> - **TaskMeld** — Pipeline orchestration engine (DAG, scheduling, artifacts)
> - **Wevra** — Built-in Agent (operates pipelines via natural language)

<br/>

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     User / Wevra Agent                    │
│         (Natural language pipeline management)               │
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────┐
│                    TaskMeld (This Repo)                      │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Pipeline Engine (DAG · Scheduler · State Machine)    │   │
│  │  • Node dependency graphs                            │   │
│  │  • Parallel groups & routing branches                │   │
│  │  • Per-node retry & artifact tracking                │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Wevra Agent (28 tools · ReAct loop · Memory)      │   │
│  │  • Pipeline CRUD & monitoring                        │   │
│  │  • Agent lifecycle management                        │   │
│  │  • Failure diagnosis & optimization                  │   │
│  └──────────────────────────────────────────────────────┘   │
└───────────────────────────┬─────────────────────────────────┘
                            │ Gateway RPC
┌───────────────────────────▼─────────────────────────────────┐
│                    OpenClaw Gateway                          │
│  (Agent registry · Session management · Event relay)         │
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────┐
│                  OpenClaw Agent Runtime                      │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐      │
│  │  Node 1  │ │  Node 2  │ │  Node 3  │ │  Node 4  │      │
│  │ (Agent A)│ │ (Agent B)│ │ (Agent C)│ │ (Agent D)│      │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘      │
│  (Each pipeline node binds an OpenClaw agent)                │
└─────────────────────────────────────────────────────────────┘
```

**How it works:**
1. **TaskMeld** orchestrates pipelines as DAGs with dependencies, routing, and retries
2. Each pipeline node binds an **OpenClaw agent** that executes the actual work
3. **Wevra Agent** operates the entire stack through natural language

<br/>

## 🚀 Why TaskMeld?

### The Problem
Managing complex agent pipelines requires constant manual intervention: creating configurations, monitoring runs, diagnosing failures, and iterating on designs. This is time-consuming, error-prone, and doesn't scale.

### The Solution: Three-Layer Stack

| Layer | Component | Role |
|-------|-----------|------|
| **Execution** | OpenClaw | Agent runtime — each node runs an OpenClaw agent |
| **Orchestration** | TaskMeld | Pipeline engine — DAG, scheduling, state management |
| **Intelligence** | Wevra | Agent — operates pipelines via natural language |

### Why Not Just OpenClaw?

OpenClaw supports direct agent-to-agent communication, so why add TaskMeld?

**OpenClaw alone:**
- Point-to-point calls — agents communicate directly, no orchestration
- No execution history — once a call completes, the context is lost
- Manual coordination — you define the flow in code each time
- No retry or recovery — if something fails, you start over

**With TaskMeld:**
- **DAG orchestration** — Define complex dependencies, parallel groups, and routing branches declaratively
- **State persistence** — Every execution is recorded; retry failed nodes, resume interrupted runs
- **Artifact tracking** — Complete lineage of data flowing between agents
- **Scheduled execution** — Cron-based or event-driven triggers
- **Wevra Agent** — Manage the entire stack through natural language

**In short:** OpenClaw executes agents; TaskMeld orchestrates them.

**Result:** Transform from *you operate the pipelines* to *Wevra operates the pipelines, and you direct*.

<br/>

## ✨ Key Features

### 🔧 Pipeline Engine (Core)

- **DAG Orchestration** — Node dependency graphs, parallel groups, routing branches
- **Per-Node Retry** — Automatic retry with configurable policies
- **State Persistence** — All state stored as JSON files, zero external database
- **Artifact Tracking** — Complete lineage of pipeline outputs
- **OpenClaw Integration** — Seamless agent execution via Gateway

### 🤖 Wevra Agent

- **28 Built-in Tools** — Pipeline CRUD, Agent management, System monitoring, Memory, Skills
- **Natural Language Interface** — "List all pipelines", "Run the data processing pipeline", "What failed in the last run?"
- **Multi-Provider LLM Support** — DeepSeek, OpenAI, Xiaomi MiMo, and custom providers
- **ReAct Loop** — Standard Reasoning + Acting pattern for intelligent task execution
- **Real-time Streaming** — WebSocket-based streaming of thinking process and execution results
- **Permission Control** — Three modes: Plan (read-only), Normal (confirm writes), Auto (full access)
- **Cross-Session Memory** — Remembers preferences, patterns, and solutions

### 🔌 OpenClaw Integration

- **Agent Registry** — List, create, update, delete agents via Gateway
- **Session Management** — Send messages, track conversations, view history
- **Event Relay** — Real-time events from agent execution
- **Delegated Execution** — Pipeline nodes delegate work to OpenClaw agents

### 🖥️ Multi-Interface Access

- **Web Console** — React 19 dashboard with DAG visualization, WevraChatPanel, and monitoring
- **CLI Tool** — Full lifecycle management for automation and scripting
- **WebSocket API** — 19 methods for real-time control and observability

<br/>

## 🎯 Use Cases

### 1. Intelligent Pipeline Management
```
You: Create a pipeline that processes daily sales data using OpenClaw agents
Wevra: [Creates pipeline with 4 nodes, each binding an OpenClaw agent]
       Pipeline created. Each node will execute via OpenClaw agents.
       Would you like me to schedule it to run daily at 9 AM?
```

### 2. Agent Lifecycle Management
```
You: List all OpenClaw agents and their status
Wevra: [Calls agent_list via Gateway]
       You have 5 agents: DataCollector, Analyzer, Reporter, Cleaner, Notifier
       
You: Create a new OpenClaw agent for customer segmentation
Wevra: [Creates agent via Gateway]
       Agent "Segmenter" created and ready for pipeline assignment.
```

### 3. Autonomous Failure Recovery
```
You: The sales pipeline failed last night. What happened?
Wevra: [Analyzes pipeline status and OpenClaw agent logs]
       Root cause: OpenClaw agent "DataCollector" timed out on Node 2.
       Impact: 3 downstream nodes skipped.
       Action: I've increased the timeout and added a fallback agent.
```

### 4. Cross-System Orchestration
```
You: Create a pipeline that chains 3 OpenClaw agents: collect → analyze → report
Wevra: [Creates DAG with dependencies]
       Pipeline configured. Agent execution order:
       1. DataCollector (OpenClaw) → artifacts
       2. Analyzer (OpenClaw) → consumes artifacts → produces analysis
       3. Reporter (OpenClaw) → consumes analysis → generates report
```

<br/>

## 📦 Prerequisites

- Node ≥ 18
- **OpenClaw ≥ 5.20** (Agent execution runtime)
- Windows (macOS and Linux not yet tested)

> [!IMPORTANT]
> OpenClaw is required for pipeline execution. Each pipeline node binds an OpenClaw agent that performs the actual work. TaskMeld orchestrates these agents; OpenClaw executes them.

<br/>

## 🔧 Install

~~~bash
npm install -g taskmeld
~~~

<br/>

## 🚀 Quick Start

~~~bash
# Initialize — guided setup for OpenClaw Gateway connection
taskmeld init

# Start the backend daemon
taskmeld server start

# List available pipelines
taskmeld pipeline list

# Run a pipeline (executes OpenClaw agents)
taskmeld pipeline start <pipelineId>

# Watch a pipeline run in real time
taskmeld pipeline watch <pipelineId>
~~~

| Command | Description |
|---|---|
| `taskmeld pipeline list` | List available pipelines |
| `taskmeld pipeline start <id>` | Start a pipeline run (executes OpenClaw agents) |
| `taskmeld pipeline watch <id>` | Monitor a run in real-time via WebSocket |
| `taskmeld pipeline status <id>` | Get current pipeline status |
| `taskmeld pipeline stop <id>` | Stop a running pipeline |
| `taskmeld pipeline retry-node <id> <node>` | Retry a failed node |
| `taskmeld server start` | Start the backend daemon |
| `taskmeld agent list` | List registered OpenClaw agents |
| `taskmeld artifact list` | Browse pipeline artifacts |

Full command reference: `taskmeld --help` or [CLI docs](docs/cli.md).

<br/>

## 💬 Chat with Wevra

After starting the server, access the Web Console at `http://0.0.0.0:54320` and use the Wevra chat panel:

```
You: What OpenClaw agents do I have?
Wevra: You have 5 agents registered: DataCollector, Analyzer, Reporter, Cleaner, Notifier

You: Create a pipeline using DataCollector and Analyzer
Wevra: [Creates pipeline with 2 nodes binding these OpenClaw agents]
       Pipeline created. Node 1 uses DataCollector, Node 2 uses Analyzer.

You: Run the pipeline and monitor execution
Wevra: Pipeline started. Monitoring OpenClaw agent execution...
       Node 1 (DataCollector): ✅ Complete
       Node 2 (Analyzer): ✅ Complete
       All agents completed successfully.
```

<br/>

## 🏗️ Directory Structure

| Directory | Purpose |
|-----------|---------|
| `src/wevra/` | **Wevra Agent** — Brain, Loop, Tools, Memory, Skills |
| `src/pipeline/` | Pipeline engine (DAG, scheduler, execution) |
| `src/transport/` | WebSocket transport (19 methods) |
| `src/services/` | Service layer (PipelineService, AgentService, SessionService) |
| `src/gateway/` | **OpenClaw Gateway** integration |
| `web/` | React frontend with WevraChatPanel |

<br/>

## 📊 Development Status

### ✅ Phase 1 — Foundation Complete
- Pipeline engine (DAG, scheduler, state machine)
- OpenClaw Gateway integration
- Wevra Agent (28 tools, ReAct loop)
- CLI and WebSocket API
- Web console with DAG visualization

### ✅ Phase 2 — Reliability Complete
- Mode marker versioning
- Thinking level persistence
- Per-conversation busy state + abort
- Confirmation re-execution fix

### ✅ Phase 3 — Real Tool Integration Complete
- All Pipeline tools (12) connected ✅
- All Agent tools (6) connected (CRUD + send via OpenClaw Gateway) ✅
- All read-only tools connected ✅

### 🔶 Phase 4 — In Progress
- Pipeline-scoped conversations
- Cross-pipeline access control

<br/>

## 🛠️ Development

```bash
npm install          # Install dependencies
npm run build        # Build
npm run typecheck    # Type check only
npm run lint         # Lint
npm test             # Run tests
npm run dev:web      # Start frontend dev server (Vite HMR)
```

| Layer | Technology |
|-------|------------|
| Language | TypeScript (strict, CommonJS) |
| Runtime | Node.js |
| Agent | Wevra (custom, zero dependencies) |
| Agent Execution | **OpenClaw** |
| Backend HTTP | Node.js built-in `http` |
| WebSocket | `ws` |
| Frontend | React 19 + Vite 7 |
| CSS | Tailwind CSS 4 |
| Testing | Vitest |

<br/>

## 🌟 Roadmap

### Current
- ✅ DAG pipeline engine with OpenClaw agent execution
- ✅ Wevra Agent with 28 tools
- ✅ Agent lifecycle management via OpenClaw Gateway
- ✅ CLI, WebSocket API, and Web console

### Upcoming
- 🔶 Pipeline-scoped conversations
- 🔶 Cross-pipeline access control
- 🔶 Enhanced memory system

### Future
- 📋 Multi-agent collaboration patterns
- 📋 Advanced scheduling (cron, event-driven)
- 📋 Plugin ecosystem

<br/>

## 🤝 Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

**Areas where help is needed:**
- Testing on macOS and Linux
- Additional LLM provider integrations
- OpenClaw agent tool implementations
- Documentation improvements

<br/>

## 📄 License

MIT — see [LICENSE](LICENSE)

<br/>

---

<p align="center">
  <strong>OpenClaw + TaskMeld + Wevra = Automated Agent Pipelines</strong><br/>
  <sub>Execute · Orchestrate · Automate</sub>
</p>
