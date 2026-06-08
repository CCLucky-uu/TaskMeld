# Changelog

All notable changes to this project will be documented in this file.

## [0.2.1] - 2026-06-08

### Fixed

- **Wevra model switching not working**: model selection now persists per-conversation and is correctly passed to the LLM on each request
- **Lazy brain initialization**: server no longer returns "No LLM model configured" after adding providers via UI without restart
- **Stale closure in send()**: selecting a different model immediately takes effect on the next message
- **Thinking level race condition**: eliminated concurrent state overwrite when opening the panel
- **Thinking level initial state**: default `"high"` matches backend default instead of `"medium"`
- **Context window not updating**: switching models now updates the context usage ring
- **New conversation model display**: shows the configured default model name instead of placeholder "model"

### Changed

- **Per-conversation model persistence**: each conversation stores its selected model in `index.json`, restored on switch
- **Model management modal redesign**: "Add Provider" tab first with DeepSeek pre-selected; "Models" tab shows all configured models grouped by provider with radio-button default selection and toggle-slider enable/disable
- **Model enable/disable API**: new `wevra.models.enable` / `wevra.models.disable` WebSocket methods; disabling the default model auto-switches to the next available
- **Auto-open model config**: modal pops up automatically when no models are configured on first launch
- **`getModelsConfigPublic` returns all models**: includes disabled models with `enabled` field for UI rendering
- **ConversationManager default thinking level**: new conversations initialize with `thinkingLevel: "high"` instead of undefined

## [0.2.0] - 2026-06-08

### Added

- **Wevra Agent**: Built-in AI agent for natural language pipeline management
  - 28 built-in tools covering Pipeline, Agent, System, Memory, Skill, Artifact, Session, and Web operations
  - ReAct (Reasoning + Acting) loop for intelligent task execution
  - Multi-provider LLM support (DeepSeek, OpenAI, Xiaomi MiMo, custom providers)
  - Real-time streaming of thinking process and execution results via WebSocket
  - Three permission modes: Plan (read-only), Normal (confirm writes), Auto (full access)
  - Cross-session memory system for knowledge accumulation
  - Skill system with 3 built-in skills (core-behavior, pipeline-management, failure-diagnosis)
  - Conversation management with JSONL persistence and crash recovery
- **Agent Tools**: Complete agent lifecycle management (6 tools)
  - `agent_list`: List all registered agents with activity filtering
  - `agent_get`: Get agent details with optional session inclusion
  - `agent_create`: Create new agent (requires confirmation)
  - `agent_update`: Update agent name/workspace (requires confirmation)
  - `agent_delete`: Delete agent permanently (requires confirmation)
  - `agent_send`: Send message to agent and wait for reply (synchronous)
- **Pipeline Tools**: Full pipeline management (12 tools)
  - Pipeline CRUD, run/stop, diagnosis, plugin management, node management, pre-run validation
- **Web Console**: WevraChatPanel for natural language interaction
  - Message bubbles, conversation sidebar, mode switching, confirmation dialogs
  - Model selection, context usage bar, debug panel
- **WebSocket API**: 19 methods for Wevra management
  - `wevra.chat`, `wevra.conversations.*`, `wevra.models.*`, `wevra.config.*`, `wevra.tool-preferences.*`, `wevra.confirm`

### Changed

- Version bumped to 0.2.0 to reflect major feature addition
- README updated to highlight Wevra as core competitive advantage
- Three-layer architecture documented: OpenClaw (execution) + TaskMeld (orchestration) + Wevra (intelligence)

### Technical

- Zero-dependency Agent framework using native `fetch` for OpenAI-compatible APIs
- ~350 lines of code for entire reasoning layer
- Tool-based architecture: LLM calls tools, tools call services
- Frozen prompt mechanism for cache efficiency
- Per-conversation mode tracking and preference management

## [0.1.50] - 2026-06-02

### Added

- CLI: `agent create`, `agent update`, `agent delete` commands for agent management
- Web: Create, edit, delete agent modals with action buttons in agent list
- Backend: `agent.create`, `agent.update`, `agent.delete`, `agent.defaultWorkspace` WebSocket methods
- Auto-resolve default workspace path on agent creation (env → config.json → relative fallback)
- Auto-detect and persist workspace root from gateway config on connect

### Fixed

- Hardcoded English error messages in agent modals replaced with i18n keys
- Escape key not closing agent modals
- Edit agent modal now pre-populates current name and workspace values

## [0.1.41] - 2026-05-31

### Added

- i18n infrastructure with i18next
- Settings page with language selector, default to English
- All frontend widgets/pages migrated to use translation keys
- CLI commands migrated to use translation keys
- Backend Chinese messages replaced with English

### Fixed

- Server static file serving path for web dist

## [0.1.3] - 2026-05-30

### Added

- WebSocket transport migration
- Isolated dev data directory
- Frontend refactoring

## [0.1.2] - 2026-05-29

### Added

- CLI tool `taskmeld` with commands: pipeline, agent, server, scheduler, artifact, system
- `taskmeld init` interactive guided setup for OpenClaw Gateway connection
- User-level config storage (~/.taskmeld/config.json)
- HTTP REST API with Trie-based router and middleware pipeline
- WebSocket real-time broadcast (bootstrap snapshot + incremental events)
- React 19 management console (DAG visualization, agent sessions, artifact browser, log viewer)
- DAG pipeline engine with parallel groups, routing branches, per-node retry
- User-level data storage (~/.taskmeld/), zero external database dependency
- OpenClaw Gateway WebSocket client integration
- MIT License

[0.2.1]: https://github.com/CCLucky-uu/TaskMeld/releases/tag/v0.2.1
[0.2.0]: https://github.com/CCLucky-uu/TaskMeld/releases/tag/v0.2.0
[0.1.50]: https://github.com/CCLucky-uu/TaskMeld/releases/tag/v0.1.50
[0.1.41]: https://github.com/CCLucky-uu/TaskMeld/releases/tag/v0.1.41
[0.1.3]: https://github.com/CCLucky-uu/TaskMeld/releases/tag/v0.1.3
[0.1.2]: https://github.com/CCLucky-uu/TaskMeld/releases/tag/v0.1.2
