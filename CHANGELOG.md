# Changelog

All notable changes to this project will be documented in this file.

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

[0.1.50]: https://github.com/CCLucky-uu/TaskMeld/releases/tag/v0.1.50
[0.1.41]: https://github.com/CCLucky-uu/TaskMeld/releases/tag/v0.1.41
[0.1.3]: https://github.com/CCLucky-uu/TaskMeld/releases/tag/v0.1.3
[0.1.2]: https://github.com/CCLucky-uu/TaskMeld/releases/tag/v0.1.2
