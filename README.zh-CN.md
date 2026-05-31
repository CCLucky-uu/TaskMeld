<p align="center">
  <a href="./README.md">English</a>
  &nbsp;·&nbsp;
  <strong>简体中文</strong>
  &nbsp;·&nbsp;
  <a href="https://taskmeld.com">Website</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/taskmeld"><img src="https://img.shields.io/npm/v/taskmeld.svg?style=flat-square&color=cb3837&labelColor=161b22&logo=npm&logoColor=white" alt="npm version"/></a>
  <a href="./package.json"><img src="https://img.shields.io/node/v/taskmeld.svg?style=flat-square&color=5fa04e&labelColor=161b22&logo=nodedotjs&logoColor=white" alt="node"/></a>
</p>

<br/>

<h3 align="center">Agent 流水线编排平台</h3>
<p align="center">将 OpenClaw Agent 编排为可执行流水线——定义、运行、观察、迭代。文件持久化，零外部数据库。</p>

<br/>

> [!TIP]
> TaskMeld 是 OpenClaw 的流水线运行时。OpenClaw 负责 Agent 执行，TaskMeld 负责将 Agent 串成 DAG 工作流，含路由分流、重试和产物追踪。

<br/>

## 环境要求

- Node ≥ 18
- OpenClaw ≥ 5.20
- Windows（macOS 和 Linux 尚未测试验证）

## 安装

~~~bash
npm install -g taskmeld
~~~

<br/>

## 快速开始

~~~bash
# 初始化 — 引导式配置 OpenClaw Gateway 连接
taskmeld init

# 启动后端守护进程
taskmeld server start

# 查看可用流水线
taskmeld pipeline list

# 运行一条流水线
taskmeld pipeline start <pipelineId>

# 实时监听流水线运行
taskmeld pipeline watch <pipelineId>
~~~

| 命令 | 场景 |
|---|---|
| `taskmeld pipeline list` | 查看有哪些流水线 |
| `taskmeld pipeline start <id>` | 启动一条流水线 |
| `taskmeld pipeline watch <id>` | 通过 WebSocket 实时跟踪运行 |
| `taskmeld pipeline status <id>` | 一次性状态快照 |
| `taskmeld pipeline stop <id>` | 停止运行中的流水线 |
| `taskmeld pipeline retry-node <id> <node>` | 重试失败的节点 |
| `taskmeld server start` | 启动后端守护进程 |
| `taskmeld agent list` | 列出已注册的 Agent |
| `taskmeld artifact list` | 浏览流水线产物 |

完整命令参考：`taskmeld --help` 或 [CLI 文档](docs/cli.md)。

<br/>

## 特性

- **DAG 流水线引擎** — 节点依赖图、并行组、路由分支、节点级重试、状态持久化
- **CLI 工具** — 全生命周期管理：list, run, status, stop, retry, watch（WebSocket 流式监听）
- **WebSocket API** — 统一 WS 传输层，用于控制面和实时可观测性
- **Web 控制台** — React 19 仪表盘，含 DAG 可视化、Agent 会话、产物浏览器、日志查看器
- **Gateway 集成** — WebSocket 客户端，对接 OpenClaw Gateway 鉴权、事件中继与 Agent 会话委托
- **文件持久化** — 所有状态以 JSON 和日志文件默认存储在 `~/.taskmeld/` 下，可用 `TASKMELD_DATA_DIR` 覆盖，无需外部数据库

<br/>

## 架构

```
CLI (taskmeld)  ·  Web 控制台 (React)
        │                │
   WS RPC ─────── WS Broker
        │                │
     App Assembly (注册表 + 运行时)
              │
     Pipeline Engine (DAG · 调度器 · 状态机)
              │
     Gateway Client (OpenClaw — 鉴权、事件、会话)
```

| 目录 | 说明 |
|------|------|
| `src/cli/` | CLI 入口、路由、输出渲染 |
| `src/pipeline/` | 流水线引擎（运行时、调度器、执行、DAG） |
| `src/server/` | HTTP 服务（健康检查 + 静态文件） |
| `src/transport/` | WebSocket 传输层（广播 + RPC 方法） |
| `src/gateway/` | 外部 Gateway WebSocket 客户端 |
| `src/services/` | 服务层（读写 facade） |
| `src/app/` | 应用装配（注册表、运行时、上下文） |
| `src/artifacts/` | 产物存储 |
| `src/logs/` | 时间线日志 |
| `web/` | React 管理前端 |

<br/>

## 开发状态

> [!WARNING]
> TaskMeld 当前处于初始测试阶段。功能正在逐步构建，API 可能在版本之间变化，部分界面仍较为粗糙。生产环境使用请自行评估——欢迎早期用户试用和反馈。

<br/>

## 后续规划

### 现状

- **流水线执行** — 节点驱动模式，每个节点绑定一个 OpenClaw Agent。CLI 已暴露完整命令集，外部 Agent 可通过编程方式调用（`pipeline list`、`pipeline start`、`pipeline status` 等）。
- **Agent 管理** — 以只读操作为主（对话、编辑核心文件如 `agent.md` / `memory.md` / `soul.md`）。创建 Agent、配置 Skill 等操作仍需切换到 OpenClaw 中完成。
- **数据存储** — 基于文件持久化（默认 `~/.taskmeld/` 下的 JSON + 日志文件），零外部依赖。

### 计划

- **内置自主 Agent** — 作为一等运行时组件，全权负责流水线的完整生命周期：调度运行、创建与审查流水线定义、故障分类、产物整理。目标是从*你来操作流水线*过渡到*Agent 操作流水线，你来指挥*。
- **Agent 生命周期管理** — 创建 Agent、配置 Skill、编辑核心文件等操作统一收敛到 TaskMeld 内，由内置 Agent 驱动，不再需要切换到 OpenClaw。
- **数据库存储层** — 从文件持久化演进为数据库存储，提升查询性能、并发访问和可扩展性，同时保留单节点零依赖的轻量体验。

<br/>

## 开发

```bash
npm install          # 安装依赖
npm run build        # 构建
npm run typecheck    # 仅类型检查
npm run lint         # 代码检查
npm test             # 运行测试
npm run dev:web      # 启动前端开发服务器（Vite HMR）
```

| 层面 | 技术 |
|------|------|
| 语言 | TypeScript（strict, CommonJS） |
| 运行时 | Node.js |
| 后端 HTTP | Node.js 内置 `http` |
| WebSocket | `ws` |
| 前端 | React 19 + Vite 7 |
| CSS | Tailwind CSS 4 |
| 测试 | Vitest |
| Lint | ESLint 9 |

<br/>

## 文档

- [CLI 参考](docs/cli.md)
- [后端架构](docs/backend.md)
- [前端架构](docs/web.md)
- [流水线引擎](docs/pipeline/)
- [参与贡献](CONTRIBUTING.md)

<br/>

---

<p align="center">
  <sub>MIT — 详见 <a href="./LICENSE">LICENSE</a></sub>
</p>
