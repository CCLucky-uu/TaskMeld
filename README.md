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

<h3 align="center">Agent Pipeline Orchestration Platform</h3>
<p align="center">Compose OpenClaw agents into executable pipelines — define, run, observe, and iterate. File-based persistence, zero external database.</p>

<br/>

> [!TIP]
> TaskMeld is the pipeline runtime for OpenClaw. OpenClaw handles agent execution; TaskMeld chains agents into DAG workflows with routing, retries, and artifact tracking.

<br/>

## Prerequisites

- Node ≥ 18
- OpenClaw ≥ 5.20
- Windows (macOS and Linux are not yet tested)

## Install

~~~bash
npm install -g taskmeld
~~~

<br/>

## Quick Start

~~~bash
# Initialize — guided setup for OpenClaw Gateway connection
taskmeld init

# Start the backend daemon
taskmeld server start

# List available pipelines
taskmeld pipeline list

# Run a pipeline
taskmeld pipeline start <pipelineId>

# Watch a pipeline run in real time
taskmeld pipeline watch <pipelineId>
~~~

| Command | When |
|---|---|
| `taskmeld pipeline list` | See what pipelines are available |
| `taskmeld pipeline start <id>` | Kick off a pipeline run |
| `taskmeld pipeline watch <id>` | Follow a run live via WebSocket |
| `taskmeld pipeline status <id>` | One-shot status snapshot |
| `taskmeld pipeline stop <id>` | Stop a running pipeline |
| `taskmeld pipeline retry-node <id> <node>` | Retry a failed node |
| `taskmeld server start` | Start the backend daemon |
| `taskmeld agent list` | List registered agents |
| `taskmeld artifact list` | Browse pipeline artifacts |

Full command reference: `taskmeld --help` or [CLI docs](docs/cli.md).

<br/>

## Features

- **DAG Pipeline Engine** — Node dependency graph, parallel groups, routing branches, per-node retry, state persistence
- **CLI Tool** — Full lifecycle: list, run, status, stop, retry, watch (WebSocket streaming)
- **WebSocket API** — Unified WS transport for control and real-time observability
- **Web Console** — React 19 dashboard with DAG visualization, agent sessions, artifact browser, log viewer
- **Gateway Integration** — WebSocket client for OpenClaw Gateway auth, event relay, and agent session delegation
- **File-based Persistence** — All state stored as JSON and log files under `~/.taskmeld/` (`TASKMELD_DATA_DIR` can override it); zero external database

<br/>

## Architecture

```
CLI (taskmeld)  ·  Web Console (React)
        │                │
   WS RPC ─────── WS Broker
        │                │
     App Assembly (registry + runtime)
              │
     Pipeline Engine (DAG · scheduler · state machine)
              │
     Gateway Client (OpenClaw — auth, events, sessions)
```

| Directory | Purpose |
|-----------|---------|
| `src/cli/` | CLI entry, routing, output rendering |
| `src/pipeline/` | Pipeline engine (runtime, scheduler, execution, DAG) |
| `src/server/` | HTTP server (health check + static files) |
| `src/transport/` | WebSocket transport (broadcast + RPC methods) |
| `src/gateway/` | External Gateway WebSocket client |
| `src/services/` | Service layer (read/write facades) |
| `src/app/` | Application assembly (registry, runtime, context) |
| `src/artifacts/` | Artifact storage |
| `src/logs/` | Timeline log storage |
| `web/` | React management frontend |

<br/>

## Development Status

> [!WARNING]
> TaskMeld is in its initial testing phase. Features are being built out incrementally, APIs may evolve between releases, and some surfaces are still rough. Production use is at your own discretion — we welcome early adopters and feedback.

<br/>

## Roadmap

### Now

- **Pipeline execution** — Node-driven: each node binds an OpenClaw agent. The CLI exposes a full command set that external agents can invoke programmatically (`pipeline list`, `pipeline start`, `pipeline status`, etc.).
- **Agent management** — Primarily read-only (chat, edit core files like `agent.md` / `memory.md` / `soul.md`). Creating agents and configuring skills still requires switching to OpenClaw directly.
- **Data storage** — File-based persistence (JSON + log files under `~/.taskmeld/` by default), zero external dependencies.

### Next

- **Built-in autonomous agent** — A first-class runtime component that owns the full pipeline lifecycle: scheduling runs, creating and reviewing pipeline definitions, triaging failures, and curating artifacts. The goal is to move from *you operate the pipelines* to *the agent operates the pipelines, and you steer*.
- **Agent lifecycle management** — Agent creation, skill configuration, and core file editing unified within TaskMeld, driven by the built-in agent — no more switching to OpenClaw.
- **Database-backed storage** — Evolve from file-based persistence to a database storage layer, improving query performance, concurrent access, and scalability while keeping a zero-dependency path for single-node setups.

<br/>

## Development

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
| Backend HTTP | Node.js built-in `http` |
| WebSocket | `ws` |
| Frontend | React 19 + Vite 7 |
| CSS | Tailwind CSS 4 |
| Testing | Vitest |
| Linting | ESLint 9 |

<br/>

## Documentation

- [CLI Reference](docs/cli.md)
- [Backend Architecture](docs/backend.md)
- [Frontend Architecture](docs/web.md)
- [Pipeline Engine](docs/pipeline/)
- [Contributing](CONTRIBUTING.md)

<br/>

---

<p align="center">
  <sub>MIT — see <a href="./LICENSE">LICENSE</a></sub>
</p>
