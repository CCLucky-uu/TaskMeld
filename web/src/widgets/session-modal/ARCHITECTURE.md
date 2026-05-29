# Session Modal 架构说明

本文档描述 `web/src/widgets/session-modal` 的当前模块分层、职责边界和关键数据流。

## 目录结构

- `index.ts`
  - 对外导出 `SessionModal`。
- `ui/SessionModal.tsx`
  - 容器组件（编排层）：
    - 管理会话/核心文件的主状态。
    - 连接网关流事件并更新历史。
    - 组合子组件与 hooks。
- `ui/ChatHistoryPanel.tsx`
  - 会话消息区展示组件：
    - 渲染 user/assistant/tool 气泡。
    - 处理 tool 折叠、输出折叠、回到底部按钮显示。
- `ui/CoreFilePanel.tsx`
  - 核心文件展示与编辑 UI 组件：
    - 头部元信息、编辑/取消/保存按钮。
    - 编辑态 textarea、只读态 markdown/pre 视图。
- `ui/hooks/useSessionHistoryScroll.ts`
  - 会话滚动策略：
    - 进入会话默认定位到底部。
    - 用户上滚后关闭自动跟随。
    - 显示/隐藏“回到底部”按钮。
- `ui/hooks/useCoreFileEditor.ts`
  - 核心文件编辑状态机：
    - `begin/cancel/save`。
    - 保存中、保存错误、草稿状态管理。
- `model/session-modal-types.ts`
  - 模块内部类型定义（stream patch、live tool、merged entry）。
- `model/stream-patches.ts`
  - 网关流解析与文本拼接：
    - `readAssistantStreamPatch`
    - `readToolStreamPatch`
    - `mergeAssistantText`
- `model/merge-history.ts`
  - 历史消息归并：把 `tool call/result` 归并为单条可渲染工具记录。

## 分层原则

- `model/*`：纯数据转换，无 React 依赖。
- `ui/hooks/*`：可复用行为逻辑（滚动、编辑状态）。
- `ui/*.tsx`：展示组件与容器组件。
- `SessionModal` 只做“编排”，不再承载大段解析/渲染细节。

## 关键数据流

### 1) 会话流式更新

1. `SessionModal` 建立 WS 监听。
2. `stream-patches.ts` 解析 assistant/tool patch。
3. 更新 `history` 与 `liveTools`。
4. `merge-history.ts` 将历史归并为 `mergedHistory`。
5. `ChatHistoryPanel` 渲染最终消息与工具气泡。

### 2) 滚动行为

1. `useSessionHistoryScroll` 在进入会话时执行底部定位。
2. 当用户滚动上移，关闭自动跟随并展示“回到底部”。
3. 当用户回到底部，恢复自动跟随。

### 3) 核心文件编辑保存

1. `SessionModal` 拉取文件列表与内容。
2. `useCoreFileEditor` 管理编辑/保存过程。
3. `CoreFilePanel` 只负责渲染与触发事件。
4. 保存成功后通过回调更新 `fileContent` 与列表元数据。

## 维护建议

- 新增网关事件类型时，优先修改 `model/stream-patches.ts`，避免把解析逻辑扩散到 UI。
- 聊天区新增交互优先放到 `ChatHistoryPanel`，状态逻辑尽量放 hook。
- `SessionModal` 保持“状态编排器”角色，避免再次膨胀。
