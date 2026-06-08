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

<h1 align="center">TaskMeld</h1>
<h3 align="center">Agent 流水线编排平台</h3>
<p align="center">将 <strong>OpenClaw Agent</strong> 编排为可执行流水线——通过 <strong>Wevra Agent</strong> 定义、运行、观察、迭代。</p>

<br/>

> [!TIP]
> **技术栈：**
> - **OpenClaw** — Agent 执行运行时（流水线节点）
> - **TaskMeld** — 流水线编排引擎（DAG、调度、产物）
> - **Wevra** — 内置 Agent（通过自然语言操作流水线）

<br/>

## 🏗️ 架构概览

```
┌─────────────────────────────────────────────────────────────┐
│                    用户 / Wevra Agent                      │
│              (自然语言流水线管理)                               │
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────┐
│                   TaskMeld（本仓库）                          │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ 流水线引擎 (DAG · 调度器 · 状态机)                      │   │
│  │  • 节点依赖图                                          │   │
│  │  • 并行组和路由分支                                      │   │
│  │  • 节点级重试和产物追踪                                  │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Wevra Agent (28 工具 · ReAct 循环 · 记忆)           │   │
│  │  • 流水线 CRUD 和监控                                  │   │
│  │  • Agent 生命周期管理                                   │   │
│  │  • 故障诊断和优化                                       │   │
│  └──────────────────────────────────────────────────────┘   │
└───────────────────────────┬─────────────────────────────────┘
                            │ Gateway RPC
┌───────────────────────────▼─────────────────────────────────┐
│                   OpenClaw Gateway                           │
│  (Agent 注册 · 会话管理 · 事件中继)                           │
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────┐
│                 OpenClaw Agent 运行时                         │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐      │
│  │  节点 1   │ │  节点 2   │ │  节点 3   │ │  节点 4   │      │
│  │(Agent A) │ │(Agent B) │ │(Agent C) │ │(Agent D) │      │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘      │
│  (每个流水线节点绑定一个 OpenClaw Agent)                       │
└─────────────────────────────────────────────────────────────┘
```

**工作原理：**
1. **TaskMeld** 将流水线编排为 DAG，包含依赖、路由和重试
2. 每个流水线节点绑定一个 **OpenClaw Agent** 执行实际工作
3. **Wevra Agent** 通过自然语言操作整个技术栈

<br/>

## 🚀 为什么选择 TaskMeld？

### 问题
管理复杂的 Agent 流水线需要持续的手动干预：创建配置、监控运行、诊断故障、迭代设计。这既耗时、容易出错，也无法扩展。

### 解决方案：三层技术栈

| 层级 | 组件 | 角色 |
|------|------|------|
| **执行层** | OpenClaw | Agent 运行时 — 每个节点运行一个 OpenClaw Agent |
| **编排层** | TaskMeld | 流水线引擎 — DAG、调度、状态管理 |
| **智能层** | Wevra | Agent — 通过自然语言操作流水线 |

### 为什么不用 OpenClaw 直接调用？

OpenClaw 支持 Agent 之间直接通信，为什么还需要 TaskMeld？

**仅使用 OpenClaw：**
- 点对点调用 — Agent 直接通信，无编排能力
- 无执行历史 — 调用完成后上下文丢失
- 手动协调 — 每次都需要在代码中定义流程
- 无重试恢复 — 失败后需要从头开始

**使用 TaskMeld：**
- **DAG 编排** — 声明式定义复杂依赖、并行组和路由分支
- **状态持久化** — 记录每次执行；重试失败节点、恢复中断运行
- **产物追踪** — Agent 间数据流转的完整血缘
- **定时执行** — 基于 Cron 或事件驱动的触发器
- **Wevra Agent** — 通过自然语言管理整个技术栈

**简单说：** OpenClaw 执行 Agent；TaskMeld 编排它们。

**结果：** 从*你来操作流水线*转变为*Wevra 操作流水线，你来指挥*。

<br/>

## ✨ 核心特性

### 🔧 流水线引擎（核心）

- **DAG 编排** — 节点依赖图、并行组、路由分支
- **节点级重试** — 可配置策略的自动重试
- **状态持久化** — 所有状态以 JSON 文件存储，零外部数据库
- **产物追踪** — 流水线输出的完整血缘
- **OpenClaw 集成** — 通过 Gateway 无缝执行 Agent

### 🤖 Wevra Agent

- **28 个内置工具** — 流水线 CRUD、Agent 管理、系统监控、记忆、技能
- **自然语言接口** — "列出所有流水线"、"运行数据处理流水线"、"上次运行哪里失败了？"
- **多 LLM 提供商支持** — DeepSeek、OpenAI、小米 MiMo 和自定义提供商
- **ReAct 循环** — 标准的推理 + 行动模式，用于智能任务执行
- **实时流式传输** — 基于 WebSocket 的思考过程和执行结果流式传输
- **权限控制** — 三种模式：Plan（只读）、Normal（确认写入）、Auto（完全访问）
- **跨会话记忆** — 记住偏好、模式和解决方案

### 🔌 OpenClaw 集成

- **Agent 注册** — 通过 Gateway 列出、创建、更新、删除 Agent
- **会话管理** — 发送消息、追踪对话、查看历史
- **事件中继** — 来自 Agent 执行的实时事件
- **委托执行** — 流水线节点将工作委托给 OpenClaw Agent

### 🖥️ 多接口访问

- **Web 控制台** — React 19 仪表盘，含 DAG 可视化、WevraChatPanel 和监控
- **CLI 工具** — 用于自动化和脚本的全生命周期管理
- **WebSocket API** — 19 个方法用于实时控制和可观测性

<br/>

## 🎯 使用场景

### 1. 智能流水线管理
```
你：创建一个使用 OpenClaw Agent 处理每日销售数据的流水线
Wevra：[创建包含 4 个节点的流水线，每个节点绑定一个 OpenClaw Agent]
       流水线创建完成。每个节点将通过 OpenClaw Agent 执行。
       要我设置每天早上 9 点自动运行吗？
```

### 2. Agent 生命周期管理
```
你：列出所有 OpenClaw Agent 及其状态
Wevra：[通过 Gateway 调用 agent_list]
       你有 5 个 Agent：DataCollector、Analyzer、Reporter、Cleaner、Notifier
       
你：为客户细分创建一个新的 OpenClaw Agent
Wevra：[通过 Gateway 创建 Agent]
       Agent "Segmenter" 创建完成，可以分配到流水线了。
```

### 3. 自主故障恢复
```
你：昨晚的销售流水线失败了，怎么回事？
Wevra：[分析流水线状态和 OpenClaw Agent 日志]
       根本原因：OpenClaw Agent "DataCollector" 在节点 2 超时。
       影响：3 个下游节点被跳过。
       措施：我已经增加了超时时间并添加了备用 Agent。
```

### 4. 跨系统编排
```
你：创建一个链接 3 个 OpenClaw Agent 的流水线：收集 → 分析 → 报告
Wevra：[创建包含依赖关系的 DAG]
       流水线配置完成。Agent 执行顺序：
       1. DataCollector (OpenClaw) → 产物
       2. Analyzer (OpenClaw) → 消耗产物 → 产生分析
       3. Reporter (OpenClaw) → 消耗分析 → 生成报告
```

<br/>

## 📦 环境要求

- Node ≥ 18
- **OpenClaw ≥ 5.20**（Agent 执行运行时）
- Windows（macOS 和 Linux 尚未测试）

> [!IMPORTANT]
> 流水线执行需要 OpenClaw。每个流水线节点绑定一个执行实际工作的 OpenClaw Agent。TaskMeld 编排这些 Agent；OpenClaw 执行它们。

<br/>

## 🔧 安装

~~~bash
npm install -g taskmeld
~~~

<br/>

## 🚀 快速开始

~~~bash
# 初始化 — 引导式配置 OpenClaw Gateway 连接
taskmeld init

# 启动后端守护进程
taskmeld server start

# 查看可用流水线
taskmeld pipeline list

# 运行流水线（执行 OpenClaw Agent）
taskmeld pipeline start <pipelineId>

# 实时监听流水线运行
taskmeld pipeline watch <pipelineId>
~~~

| 命令 | 说明 |
|---|---|
| `taskmeld pipeline list` | 列出可用流水线 |
| `taskmeld pipeline start <id>` | 启动流水线（执行 OpenClaw Agent） |
| `taskmeld pipeline watch <id>` | 通过 WebSocket 实时跟踪运行 |
| `taskmeld pipeline status <id>` | 获取当前流水线状态 |
| `taskmeld pipeline stop <id>` | 停止运行中的流水线 |
| `taskmeld pipeline retry-node <id> <node>` | 重试失败的节点 |
| `taskmeld server start` | 启动后端守护进程 |
| `taskmeld agent list` | 列出已注册的 OpenClaw Agent |
| `taskmeld artifact list` | 浏览流水线产物 |

完整命令参考：`taskmeld --help` 或 [CLI 文档](docs/cli.md)。

<br/>

## 💬 与 Wevra 对话

启动服务器后，访问 `http://0.0.0.0:54320` 的 Web 控制台，使用 Wevra 聊天面板：

```
你：我有哪些 OpenClaw Agent？
Wevra：你有 5 个已注册的 Agent：DataCollector、Analyzer、Reporter、Cleaner、Notifier

你：使用 DataCollector 和 Analyzer 创建一个流水线
Wevra：[创建包含 2 个节点的流水线，绑定这些 OpenClaw Agent]
       流水线创建完成。节点 1 使用 DataCollector，节点 2 使用 Analyzer。

你：运行流水线并监控执行
Wevra：流水线已启动。正在监控 OpenClaw Agent 执行...
       节点 1 (DataCollector)：✅ 完成
       节点 2 (Analyzer)：✅ 完成
       所有 Agent 执行完成。
```

<br/>

## 📚 文档

### 架构
- [后端架构](docs/backend.md) — 服务器实现，含 Wevra 和 OpenClaw 集成
- [Wevra Agent 指南](docs/wevra-agent.md) — 用于流水线管理的 Agent
- [流水线引擎](docs/pipeline/) — DAG 编排、调度、状态机

### API
- [CLI 参考](docs/cli.md) — 命令行接口
- [WebSocket API](docs/backend.md#25-transport-module--websocket-transport) — 19 个方法
- [前端架构](docs/web.md) — React 仪表盘

### 指南
- [流水线概览](docs/pipeline/overview.md) — 概念和架构
- [流水线 API](docs/pipeline/api-and-cli.md) — CLI 和 WebSocket 用法
- [故障排查](docs/pipeline/troubleshooting.md) — 常见问题

<br/>

## 🏗️ 目录结构

| 目录 | 说明 |
|------|------|
| `src/wevra/` | **Wevra Agent** — Brain、Loop、Tools、Memory、Skills |
| `src/pipeline/` | 流水线引擎（DAG、调度器、执行） |
| `src/transport/` | WebSocket 传输层（19 个方法） |
| `src/services/` | 服务层（PipelineService、AgentService、SessionService） |
| `src/gateway/` | **OpenClaw Gateway** 集成 |
| `web/` | React 前端，含 WevraChatPanel |

<br/>

## 📊 开发状态

### ✅ Phase 1 — 基础架构完成
- 流水线引擎（DAG、调度器、状态机）
- OpenClaw Gateway 集成
- Wevra Agent（28 工具、ReAct 循环）
- CLI 和 WebSocket API
- Web 控制台，含 DAG 可视化

### ✅ Phase 2 — 可靠性完成
- 模式标记版本控制
- 思考级别持久化
- 每会话忙碌状态 + 中止
- 确认后重新执行修复

### ✅ Phase 3 — 真实工具集成完成
- 所有 Pipeline 工具（12 个）连接 ✅
- 所有 Agent 工具（6 个）连接（通过 OpenClaw Gateway 的 CRUD + 发送） ✅
- 所有只读工具连接 ✅

### 🔶 Phase 4 — 进行中
- 流水线范围会话
- 跨流水线访问控制

<br/>

## 🛠️ 开发

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
| Agent | Wevra（自定义，零依赖） |
| Agent 执行 | **OpenClaw** |
| 后端 HTTP | Node.js 内置 `http` |
| WebSocket | `ws` |
| 前端 | React 19 + Vite 7 |
| CSS | Tailwind CSS 4 |
| 测试 | Vitest |

<br/>

## 🌟 路线图

### 当前
- ✅ DAG 流水线引擎，含 OpenClaw Agent 执行
- ✅ Wevra Agent，28 个工具
- ✅ 通过 OpenClaw Gateway 管理 Agent 生命周期
- ✅ CLI、WebSocket API 和 Web 控制台

### 即将到来
- 🔶 流水线范围会话
- 🔶 跨流水线访问控制
- 🔶 增强的记忆系统

### 未来
- 📋 多 Agent 协作模式
- 📋 高级调度（cron、事件驱动）
- 📋 插件生态系统

<br/>

## 🤝 参与贡献

我们欢迎贡献！请参阅 [CONTRIBUTING.md](CONTRIBUTING.md) 了解指南。

**需要帮助的领域：**
- macOS 和 Linux 测试
- 额外的 LLM 提供商集成
- OpenClaw Agent 工具实现
- 文档改进

<br/>

## 📄 许可证

MIT — 详见 [LICENSE](LICENSE)

<br/>

---

<p align="center">
  <strong>OpenClaw + TaskMeld + Wevra = 自动化 Agent 流水线</strong><br/>
  <sub>执行 · 编排 · 自动化</sub>
</p>
