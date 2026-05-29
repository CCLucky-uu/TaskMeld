# Changelog

All notable changes to this project will be documented in this file.

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

[0.1.2]: https://github.com/CCLucky-uu/TaskMeld/releases/tag/v0.1.2
