# Changelog

All notable changes to this project will be documented in this file.

## [0.2.4] - 2026-06-12

### Added

- **Openclaw Gateway agent/skill/session tools**: Wevra Agent now manages Openclaw agents through the gateway instead of local abstractions
  - `gateway.ts`: `agent_list`, `agent_create`, `agent_update`, `agent_delete`, `gateway_session` tools
  - `gateway-skill-service.ts`: `skills.install` RPC supporting clawhub/upload/installer modes
  - `gateway_skill_install` and `skills_list` tools in `skill.ts`
  - `pipeline_node` tool validates `agentId` references against registered Openclaw agents
  - Prompt builder loads gateway skills context for LLM awareness of available skills
  - `docs/gateway-rpc-discovery.md`: reverse-engineered gateway RPC schemas reference

### Changed

- **Agent tools architecture**: removed built-in `agent.ts` (353 lines), replaced with `gateway.ts` (588 lines) routing all agent operations through Openclaw Gateway
- **Session tools**: now route through gateway for session history and config retrieval
- **Agent loop**: removed hard `maxIterations=25` cap; loop terminates naturally when LLM produces no tool calls
- **Model config**: inherit `contextWindow`/`maxTokens` from `BUILTIN_PROVIDERS` when missing from persisted config
- **`getModelsConfigPublic()`**: returns `templates` field with full provider metadata as single source of truth
- **Frontend model config**: `ModelConfigModal` uses backend templates instead of duplicated `PROVIDER_TEMPLATES` constant
- **Deprecated models removed**: dropped Xiaomi MiMo V2 Flash, MiMo V2 Pro, MiMo V2 Omni

### Fixed

- **Typecheck script**: generate `version.ts` before running `tsc` to prevent missing module errors

## [0.2.3] - 2026-06-11

### Added

- **Blueprint preview and visualization tool**: Interactive flow diagram for pipeline blueprints
  - `blueprint` tool for Wevra Agent to generate and visualize pipelines
  - `BlueprintPreviewPanel` with sidebar drawer toggle and fullscreen mode
  - `BlueprintFlow` component with interactive node graph and dependency visualization
  - `BlueprintNodeCard` component for individual node rendering
  - Automatic layout algorithm based on dependency graph and routing paths
  - Wheel zoom support for flow diagram navigation

### Fixed

- **Gateway reconnection not propagated to app layer**: App layer now detects successful reconnections and refreshes runtime state
  - `gateway-client`: Store `lastHello` payload and expose `getHello()` getter
  - `create-app-context`: Detect status→ready transition after first connect, replay `onGatewayReady(hello)` to refresh runtime state and broadcast to frontends
  - `index.ts`: Log `gateway-reconnected` / `gateway-status` failures for observability

## [0.2.2] - 2026-06-08

### Added

- **`ask_user` tool**: Structured question tool for Wevra Agent to gather user input with predefined options
  - Multi-question support: batch multiple questions in a single tool call with tab navigation
  - Per-tab "Other" option: users can always type a custom answer alongside predefined choices
  - Single-select auto-advance: selecting an option automatically jumps to the next unanswered question
  - Full answer context returned to LLM: question text + option label + description (not just labels)
  - Skip all: user can skip the entire question set, returning a "user declined" response
  - Question timeout: 10 minutes, with graceful recovery (tool result injected, conversation continues)
  - localStorage persistence: pending questions survive page refresh
- **`InlineQuestion` component**: Inline question UI rendered above the input area
  - Tab bar for multi-question navigation with per-tab answered status indicators
  - Flat option list with horizontal dividers (project design language)
  - "Other..." option with textarea integration into the shared input area
  - Confirm button disabled until all questions answered (matches Send button style)
  - Skip button to decline all questions
- **`ChatInputArea` component**: Extracted input area from WevraChatPanel (textarea, toolbar, question UI)
- **`wevra.ask-user` WebSocket method**: New WS endpoint for submitting question answers
- **`question_request` / `question_response` stream events**: New stream event types for question flow
- **Pipeline Design Protocol**: Comprehensive `pipeline-management` skill replacing the previous 6-line version
  - 5-phase protocol: Goal Discovery → Architecture Proposal → Agent Assignment → Artifact Design → Incremental Build
  - Node output format documentation (ResultEnvelope structure, artifact.content constraints)
  - 26 red lines covering requirements, architecture, agent binding, artifacts, and execution
  - Artifact content strategy: inline JSON for small data, file path references for large/binary content
  - Anti-patterns with correct alternatives

### Changed

- **`pipeline_node` tool description**: Added ResultEnvelope structure reference and instruction writing guidelines
- **Question timeout**: Increased from 2 minutes to 10 minutes
- **Input area architecture**: WevraChatPanel input area extracted into standalone `ChatInputArea` component

### Fixed

- **Question timeout crash**: Agent loop now catches timeout errors and injects a valid tool result instead of crashing the conversation (fixes "insufficient tool messages" LLM error)
- **Stream events lost after question answer**: `streamConvRef` preserved across the idle→busy→response cycle after answering a question
- **Page refresh stuck busy**: Pending question state persisted in localStorage, restored on reconnect
- **Other state leaking across tabs**: Per-tab Other tracking with `localOtherActive` state in ChatInputArea
- **Textarea not hiding on option change**: Selecting a non-Other option in single-select mode now properly hides the input area
- **Other button not working on first tab**: Added direct ref-based communication (`otherToggleRef`) bypassing callback chain closures
- **Confirm button initial state**: Button starts disabled via mount-time `onAnswersChange(false)` notification
- **Expand button visibility**: Hidden when question is active and Other is not selected

### Removed

- **`QuestionDialog.tsx`**: Replaced by `InlineQuestion` inline component

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

[0.2.4]: https://github.com/CCLucky-uu/TaskMeld/releases/tag/v0.2.4
[0.2.3]: https://github.com/CCLucky-uu/TaskMeld/releases/tag/v0.2.3
[0.2.2]: https://github.com/CCLucky-uu/TaskMeld/releases/tag/v0.2.2
[0.2.1]: https://github.com/CCLucky-uu/TaskMeld/releases/tag/v0.2.1
[0.2.0]: https://github.com/CCLucky-uu/TaskMeld/releases/tag/v0.2.0
[0.1.50]: https://github.com/CCLucky-uu/TaskMeld/releases/tag/v0.1.50
[0.1.41]: https://github.com/CCLucky-uu/TaskMeld/releases/tag/v0.1.41
[0.1.3]: https://github.com/CCLucky-uu/TaskMeld/releases/tag/v0.1.3
[0.1.2]: https://github.com/CCLucky-uu/TaskMeld/releases/tag/v0.1.2
