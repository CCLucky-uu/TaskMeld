# 流水线节点编辑保存链路 — 深度审计与重构方案

> 日期: 2026-06-07
> 分支: feat/wevra-agent
> 状态: 设计完成，待实施

---

## 一、审计发现的漏洞

### P0 — 严重

#### 1. 双重写入竞态：节点配置保存 vs 工作流配置保存互相覆盖

**位置**: `web/src/pages/control-plane/model/useControlPlanePage.ts`

系统存在两条独立的保存路径，互不感知：
- **路径 A** `saveSelectedNodeConfigOnBlur` (第 1542 行) — 由字段 blur 触发，guard 是 `isSavingNodeConfig`
- **路径 B** `saveSelectedWorkflowNodeConfig` (第 1255 行) — 由 debounce useEffect (第 1306 行) 触发，guard 是 `isSavingWorkflowConfig`

两个 guard 互不阻塞。用户修改 Instruction 后立刻切换 Lane → blur 触发路径 A，250ms 后 debounce 触发路径 B → 两者都以当前 `workflow` state 为基准构建，但 `saveSelectedWorkflowNodeConfig` 的 `useCallback` 依赖数组 (第 1285-1299 行) 不包含 `workflow`，闭包中捕获的 `workflow` 是旧值。路径 A 先完成并 `updatePipelineState` 更新了 `workflow`，路径 B 仍使用旧 `workflow` 为基准 → 路径 B 覆盖路径 A 的节点配置变更 → **数据静默丢失**。

#### 2. 保存破坏运行中流水线的执行状态

**位置**: `src/transport/ws-methods/pipeline-workflow.ts` 第 137-141 行

```typescript
await runtime.workflow.setWorkflow(normalized);
const run = runtime.runtime.seedRun(runtime.workflow.getTemplateNodes());
runtime.runtime.setRun(run);
```

每次保存无条件执行 `seedRun()` 创建全新 Run 对象，**完全替换**当前运行状态：
- 已完成节点的 status/artifacts/startedAt/finishedAt 全部丢失
- itemRuns 和 groupItemRuns 被重新 seed 为初始 queued 状态
- 正在执行中的节点的 abort controller 变成孤儿引用
- `isPipelineRuntimeBusy()` 只用于 `deletePipeline()`，不用于 `saveWorkflow`

#### 3. startPipelineRun 在保存失败时仍然继续执行

**位置**: `web/src/pages/control-plane/model/useControlPlanePage.ts` 第 1002-1027 行

`saveSelectedNodeConfig` 内部 try-catch 吞掉了所有错误，Promise 始终 resolve。`startPipelineRun` 的 `await` 不会收到 rejection → 流水线以旧的可能不一致的配置开始运行。

### P1 — 高危

#### 4. 双重 emitPipeline 广播

**位置**: `src/app/pipeline-runtime.ts` 第 96 行 + `src/transport/ws-methods/pipeline-workflow.ts` 第 141 行

`setWorkflow()` 内部调用 `emitPipeline()` (第一次广播，旧 Run + 新 Graph)，WS handler 紧接着调用 `seedRun` + `setRun` + `emitPipeline()` (第二次广播，全新 Run)。每次保存产生两次 `pipeline.updated` 事件，第一次是语义不一致的中间态。

#### 5. pipeline.updated 事件不更新 workflow，导致 selectedNode 与 selectedWorkflowNode 脱节

**位置**: `web/src/pages/control-plane/model/useControlPlanePage.ts` 第 281-284 行

- `selectedNode` 从 `pipeline` (运行时 NodeRun[]) 派生
- `selectedWorkflowNode` 从 `workflow` (WorkflowDefinition) 派生
- `pipeline.updated` 只更新 `pipeline`，不更新 `workflow`

`pipeline.updated` 到达时 `selectedNode` 变为新对象引用，触发草稿重置 useEffect，但 `selectedWorkflowNode` 未变 → 草稿变更检测不可靠。

#### 6. useCallback 闭包陈旧

**位置**: `useControlPlanePage.ts` 第 1285-1299 行

`saveSelectedWorkflowNodeConfig` 的 `useCallback` 依赖数组不包含 `workflow`，闭包中捕获的 `workflow` 可能是过时的。

### P2 — 中危

#### 7. 草稿重置 useEffect 依赖不完整

**位置**: `web/src/pages/control-plane/model/useControlPlaneDraftState.ts` 第 54-82 行

依赖数组列出具体属性路径，遗漏了 `outputSpec`、`fallbackAgentId` 等字段。

#### 8. 乐观更新 + refresh 三重状态翻转

每次保存成功后：`updatePipelineState`(同步) → `pipeline.updated` WS 事件(异步) → `refresh()`(异步) 三次状态更新时序分离，UI 可能短暂闪烁。

#### 9. JSON 编辑器保存覆盖并发修改

`saveWorkflowJsonDraft` 的 `useCallback` 依赖只有 `workflowJsonDraft`，闭包陈旧。JSON 文本快照在 modal 打开时生成，保存时不做 merge。

### 设计缺陷

#### 10. 缺乏乐观锁 / 版本控制

整个保存链路没有版本号或 CAS 机制，多客户端同时编辑同一流水线时后保存的覆盖先保存的。

#### 11. 保存时校验过严，阻碍编辑

保存时执行完整图校验 (DAG 环检测、路由完整性、group 约束等)，工作流处于编辑中间态时保存被拒绝，所有编辑成果丢弃。

---

## 二、设计思想

### 核心原则

**`save = 持久化草稿`，`run = 交付执行`**

```
保存只防写坏文件（数据完整性）
运行才验全部（结构完整性 + 语义正确性）
```

### 校验分层

| 层级 | 时机 | 校验内容 | 失败后果 |
|------|------|----------|----------|
| L1 数据完整性 | 保存时 | JSON 语义成立性 | 阻止保存 |
| L2 图结构完整性 | 运行时 | DAG、路由、group、跨分支 | 阻止运行 |
| L3 运行时语义 | 运行时 | output config、连接性 | 阻止运行 |

### 保存 = 数据完整性 (L1)

仅检查"写出来的 JSON 本身是否合法"：
- version === "3.0"
- nodes/edges/groups 是数组
- 无重复 node ID / group ID
- edge 端点存在 (from/to 都在 nodeIds 或 groupIds 中)
- 无自环边 (from === to)
- 无重复边
- group member 引用存在的 node
- node parallelGroupId 引用存在的 group，且 node 确实在该 group 的 members 中
- joinPolicy 是合法值 ("all")

以上违反 = JSON 语义本身不成立，必须阻止写入。

### 运行 = 完整校验 (L1 + L2 + L3)

在 L1 基础上额外检查：
- DAG 环检测 (拓扑排序)
- 非路由节点不能混合 dependency/route 出边
- 路由节点必须有 yes/no
- 路由每条分支必须有恰好 1 个目标
- 路由边只能指向 branch 节点
- group 成员 >= 2
- group 不能直连 member / 组内不能有直接依赖
- 跨分支 edge 检测 (scope 分析)
- route set size 2-5
- output config 有效 (mainline sink 唯一、output node 必须 enabled + mainline)

---

## 三、架构变更

### 当前架构（问题）

```
编辑 → blur → saveSelectedNodeConfigOnBlur
                    ↓
                  saveSelectedNodeConfig (guard: isSavingNodeConfig)
                    ↓
                  buildNextWorkflow (仅 nodeConfig)
                    ↓
                  validateWorkflowBeforeSave (L1+L2+L3) ← 失败则丢弃
                    ↓
                  saveWorkflowDefinitionReq → WS
                    ↓
                  normalize + validateWorkflowGraph (L1+L2+L3) ← 失败则拒绝
                    ↓
                  saveWorkflowDefinitionWithStorage
                    ↓
                  validateWorkflowDefinition (L1+L2+L3) ← 第三次！
                    ↓
                  writeFileSync
                    ↓
                  setWorkflow → emitPipeline ← 第一次广播
                    ↓
                  seedRun + setRun + emitPipeline ← 第二次广播（破坏运行状态）

编辑 → lane 变化 → debounce 250ms → saveSelectedWorkflowNodeConfig
                                           ↓
                                         (guard: isSavingWorkflowConfig)
                                           ↓
                                         buildNextWorkflow (仅 workflowConfig)
                                           ↓
                                         ... 同上流程，可能与路径 A 竞态
```

### 目标架构

```
=== 保存 ===
用户编辑 → draft state 更新 → hasDraftChanges = true
                                   ↓ (300ms debounce)
                               saveSelectedNodeAll (统一锁)
                                   ↓
                               buildNextWorkflow (node + workflow 变更，有变更才应用)
                                   ↓
                               validateWorkflowForSave (仅 L1 数据完整性)
                                   ↓
                               saveWorkflowDefinitionReq → WS
                                   ↓
                               normalize + validateWorkflowDataIntegrity (仅 L1)
                                   ↓
                               writeFileSync
                                   ↓
                               reconcileRunWithWorkflowChanges (保护运行状态)
                                   ↓
                               emitPipeline (单次广播)

=== 运行 ===
用户点击运行 → 等待进行中保存完成
                   ↓
               保存未保存的草稿
                   ↓ 保存失败 → 阻断运行，展示错误
               validateWorkflowForRun (L1 + L2 + L3)
                   ↓ 失败 → 阻断运行，展示具体错误列表
               startPipelineRunReq → WS
                   ↓
               validateWorkflowGraph (L2 + L3) ← 后端安全网
                   ↓
               seedRun + setRun + emitPipeline + drainPipeline
```

---

## 四、实施步骤

### Phase 1: 后端 — 校验分层

#### 步骤 1.1: 新增 `src/pipeline/workflow/save-validate.ts`

从 `validate.ts` 的 `validateWorkflowGraph` 中提取 L1 校验逻辑，创建 `validateWorkflowDataIntegrity` 函数。

```typescript
import type { WorkflowDefinitionRuntime, WorkflowValidationResult } from "../types/workflow";

/**
 * L1: 数据完整性校验 — 仅在 save 时调用。
 * 检查 JSON 语义是否成立，不检查图结构完整性。
 * 图结构（DAG、路由、group 完整性）在 run 时通过 validateWorkflowGraph 检查。
 */
export const validateWorkflowDataIntegrity = (
  workflow: WorkflowDefinitionRuntime,
): WorkflowValidationResult => {
  if (workflow.version !== "3.0") {
    return { ok: false, error: "invalid_workflow_definition", detail: "version must be 3.0" };
  }
  if (!Array.isArray(workflow.nodes) || !Array.isArray(workflow.edges) || !Array.isArray(workflow.groups)) {
    return { ok: false, error: "invalid_workflow_definition", detail: "nodes, edges, groups must be arrays" };
  }
  // ... 重复ID、edge端点、自环、重复边、group member引用、parallelGroupId引用、joinPolicy
  // 不包含: DAG环、路由完整性、group>=2、跨分支、group边约束
};
```

#### 步骤 1.2: 修改 `src/pipeline/workflow/io.ts`

`saveWorkflowDefinitionWithStorage` 改用 `validateWorkflowDataIntegrity` 替换 `validateWorkflowDefinition`。移除 `validateWorkflowOutputConfig` 校验。

```typescript
// 第 49-77 行
export const saveWorkflowDefinitionWithStorage = (
  workflow: WorkflowDefinitionRuntime,
  options: WorkflowStorageOptions,
) => {
  const validation = validateWorkflowDataIntegrity(workflow);  // 仅 L1
  if (!validation.ok) {
    const error = new Error(validation.error);
    (error as Error & { detail?: string }).detail = validation.detail;
    throw error;
  }
  // 移除 validateWorkflowOutputConfig 校验
  const workflowFilePath = options.workflowFilePath ?? TEMPLATE_FILE;
  mkdirSync(dirname(workflowFilePath), { recursive: true });
  const persisted: WorkflowPersistedV3 = { ... };
  writeFileSync(workflowFilePath, JSON.stringify(persisted, null, 2), "utf8");
};
```

#### 步骤 1.3: 修改 `src/app/pipeline-runtime.ts`

`setWorkflow` 去掉 `runtimeStore.emitPipeline()` 调用。新增 `reconcileRunWithWorkflowChanges` 方法。

```typescript
// 第 86-97 行
const setWorkflow = async (nextWorkflow: WorkflowDefinitionRuntime): Promise<void> => {
  saveWorkflowDefinitionWithStorage(nextWorkflow, { workflowFilePath: options.workflowFilePath });
  graph.setWorkflow(nextWorkflow);
  schedulerService.syncSchedulerStateFromWorkflow();
  // 移除: graph.syncRunGroupsFromWorkflow(runtimeStore.getRun());
  // 移除: runtimeStore.emitPipeline();
};

// 新增方法
const reconcileRunWithWorkflowChanges = () => {
  const run = runtimeStore.getRun();
  const templateNodes = graph.getTemplateNodes();
  const currentNodeIds = new Set(run.nodes.map(n => n.id));
  const nextNodeIds = new Set(templateNodes.map(n => n.id));

  // 新增的节点 → 添加 NodeRun
  for (const tpl of templateNodes) {
    if (!currentNodeIds.has(tpl.id)) {
      run.nodes.push({
        id: tpl.id, title: tpl.title, executor: tpl.executor,
        instruction: tpl.instruction, outputSpec: tpl.outputSpec,
        allowReject: tpl.allowReject, maxRejectCount: tpl.maxRejectCount,
        status: tpl.dependsOn.length > 0 ? "blocked" : "queued",
        dependsOn: tpl.dependsOn, artifacts: [], rejectFeedbacks: [],
        attempt: 0, rejectCount: 0, startedAt: null, finishedAt: null, lastError: null,
      });
    }
  }

  // 删除的节点 → 移除 NodeRun + 对应 itemRuns
  run.nodes = run.nodes.filter(n => nextNodeIds.has(n.id));
  run.itemRuns = (run.itemRuns ?? []).filter(ir => nextNodeIds.has(ir.nodeId));

  // 已存在节点 → 更新元数据（不影响 status/artifacts）
  for (const tpl of templateNodes) {
    const existing = run.nodes.find(n => n.id === tpl.id);
    if (existing) {
      existing.title = tpl.title;
      existing.executor = tpl.executor;
      existing.instruction = tpl.instruction;
      existing.dependsOn = tpl.dependsOn;
      existing.allowReject = tpl.allowReject;
      existing.maxRejectCount = tpl.maxRejectCount;
      existing.outputSpec = tpl.outputSpec;
    }
  }

  // 同步 group 运行状态
  graph.syncRunGroupsFromWorkflow(run);
};

return {
  // ...
  workflow: {
    setWorkflow,
    reconcileRunWithWorkflowChanges,
    // ...
  },
};
```

#### 步骤 1.4: 修改 `src/transport/ws-methods/pipeline-workflow.ts`

`pipeline.workflow.save` WS handler 改用 L1 校验，去掉 seedRun，改用 reconcile + 单次 emitPipeline。

```typescript
// 第 109-143 行
registry.register("pipeline.workflow.save", async (params, ctx) => {
  const pipelineId = typeof params.pipelineId === "string" ? params.pipelineId : "";
  const runtime = ctx.app.getPipelineRuntime(pipelineId);
  const definition = ctx.app.getPipelineDefinition(pipelineId);
  if (!runtime || !definition) return { ok: false, error: "pipeline_not_found" };

  const parseResult = readWorkflowDefinitionFromRawDetailed(params.workflow ?? params);
  if (!parseResult.ok) {
    return { ok: false, error: { error: parseResult.error, detail: parseResult.detail } };
  }
  const next = parseResult.workflow;
  let normalized: WorkflowDefinitionRuntime;
  try {
    normalized = normalizeWorkflowFallbacksWithStorage(next, { workflowFilePath: definition.workflowFilePath });
  } catch (error) {
    const err = error as Error & { detail?: string };
    return { ok: false, error: { error: err.message || "invalid_persisted_workflow_definition", detail: err.detail } };
  }

  // L1 校验（不再做 L2/L3）
  const validation = validateWorkflowDataIntegrity(normalized);
  if (!validation.ok) {
    return { ok: false, error: { error: validation.error, detail: validation.detail } };
  }

  // 持久化 + 更新内存
  await runtime.workflow.setWorkflow(normalized);

  // 协调现有运行状态（不丢弃执行进度）
  runtime.workflow.reconcileRunWithWorkflowChanges();

  // 单次广播
  runtime.runtime.pushTimeline(`[${pipelineId}] Workflow definition updated, node count: ${normalized.nodes.length}`);
  runtime.runtime.emitPipeline();

  return { ok: true, payload: { ok: true, workflow: normalized, run: runtime.runtime.getRun(), pipelineId } };
});
```

#### 步骤 1.5: 修改 `src/services/pipeline-service.ts`

`startPipeline` 在 seedRun 之前做完整校验 (L1 + L2 + L3)。

```typescript
// 第 515 行附近（在 seedRun 之前）
const startPipeline = async (pipelineId: string): Promise<PipelineStartResult> => {
  const runtime = getRuntimeByPipelineId(app, pipelineId);
  if (!runtime) return { ok: false, pipelineId, error: "pipeline_not_found" };

  const batchState = runtime.pipeline.getBatchRunState();
  if (batchState.status === "running") {
    return { ok: false, pipelineId, error: "batch_run_in_progress", state: batchState };
  }

  // ★ 运行前完整校验
  const workflow = runtime.workflow.getWorkflow();
  const graphValidation = validateWorkflowGraph(workflow);
  if (!graphValidation.ok) {
    return { ok: false, pipelineId, error: graphValidation.error, detail: graphValidation.detail };
  }
  const outputValidation = validateWorkflowOutputConfig(workflow);
  if (!outputValidation.ok) {
    return { ok: false, pipelineId, error: outputValidation.error, detail: outputValidation.detail };
  }

  // ... remote batch 检查保持不变 ...

  const run = runtime.runtime.seedRun(runtime.workflow.getTemplateNodes());
  runtime.runtime.setRun(run);
  runtime.runtime.pushTimeline(`[${pipelineId}] New run started: ${run.id}`);
  runtime.runtime.emitPipeline();
  void runtime.pipeline.drainPipeline(`run:start:${run.id}`).then(() => {
    runtime.runtime.touchRun(runtime.runtime.getRun());
  });
  return { ok: true, mode: "single", pipelineId, accepted: true, runId: run.id, run: runtime.runtime.getRun(), workflowNodes: runtime.workflow.getWorkflow().nodes };
};
```

---

### Phase 2: 前端 — 校验分层 + 保存路径统一

#### 步骤 2.1: 新增 `web/src/pages/control-plane/model/pipelineSaveValidation.ts`

```typescript
import i18n from "../../../shared/i18n";
import { WorkflowDefinition, WorkflowNode } from "../../../entities/pipeline";

// ========== L1: 数据完整性 (save 时) ==========

export type SaveValidationResult = { ok: true } | { ok: false; message: string };

/**
 * 保存时校验 — 仅数据完整性。
 * 不检查 DAG、路由完整性、group 完整性 — 那些在 run 时检查。
 */
export const validateWorkflowForSave = (workflow: WorkflowDefinition): SaveValidationResult => {
  if (workflow.version !== "3.0") {
    return { ok: false, message: i18n.t("common:validation.versionInvalid", { version: String(workflow.version) }) };
  }
  if (!Array.isArray(workflow.nodes) || !Array.isArray(workflow.edges) || !Array.isArray(workflow.groups)) {
    return { ok: false, message: i18n.t("common:validation.mustBeArray") };
  }
  const nodeIds = new Set(workflow.nodes.map((node) => node.id));
  if (nodeIds.size !== workflow.nodes.length) {
    return { ok: false, message: i18n.t("common:validation.duplicateNodeId") };
  }
  const groupIds = new Set(workflow.groups.map((group) => group.id));
  if (groupIds.size !== workflow.groups.length) {
    return { ok: false, message: i18n.t("common:validation.duplicateGroupId") };
  }
  const entityIds = new Set<string>([...nodeIds, ...groupIds]);
  const edgeSeen = new Set<string>();
  for (const edge of workflow.edges) {
    if (!entityIds.has(edge.from) || !entityIds.has(edge.to)) {
      return { ok: false, message: i18n.t("common:validation.edgeReferencesMissing", { from: edge.from, to: edge.to }) };
    }
    if (edge.from === edge.to) {
      return { ok: false, message: i18n.t("common:validation.selfLoopEdge", { from: edge.from, to: edge.to }) };
    }
    const key = `${edge.from}|${edge.to}|${edge.when ?? ""}`;
    if (edgeSeen.has(key)) return { ok: false, message: i18n.t("common:validation.duplicateEdge", { from: edge.from, to: edge.to }) };
    edgeSeen.add(key);
  }
  const explicitGroupById = new Map(workflow.groups.map((group) => [group.id, group]));
  for (const group of workflow.groups) {
    for (const memberId of group.members) {
      if (!nodeIds.has(memberId)) {
        return { ok: false, message: i18n.t("common:validation.groupMemberMissing", { groupId: group.id, memberId }) };
      }
    }
  }
  for (const node of workflow.nodes) {
    const groupId = (node.parallelGroupId ?? "").trim();
    if (!groupId) continue;
    const group = explicitGroupById.get(groupId);
    if (!group) {
      return { ok: false, message: i18n.t("common:validation.nodeGroupMissing", { nodeId: node.id, groupId }) };
    }
    if (!group.members.includes(node.id)) {
      return { ok: false, message: i18n.t("common:validation.nodeNotInGroup", { nodeId: node.id, groupId }) };
    }
  }
  return { ok: true };
};

// ========== L2 + L3: 运行前完整校验 ==========

export type RunValidationResult = { ok: true } | { ok: false; errors: string[] };

/**
 * 运行前校验 — 完整校验。
 * 包含 L1 + DAG环 + 路由完整性 + group约束 + 跨分支检测 + output config。
 */
export const validateWorkflowForRun = (workflow: WorkflowDefinition): RunValidationResult => {
  const errors: string[] = [];

  // L1
  const l1 = validateWorkflowForSave(workflow);
  if (!l1.ok) errors.push(l1.message);

  // DAG 环检测
  const nodeIds = new Set(workflow.nodes.map((node) => node.id));
  const groupIds = new Set(workflow.groups.map((group) => group.id));
  const entityIds = new Set<string>([...nodeIds, ...groupIds]);
  const indegreeByEntity = new Map<string, number>([...entityIds].map((id) => [id, 0]));
  const outgoingBySource = new Map<string, string[]>();
  for (const node of workflow.nodes) outgoingBySource.set(node.id, []);
  for (const group of workflow.groups) outgoingBySource.set(group.id, []);
  for (const edge of workflow.edges) {
    indegreeByEntity.set(edge.to, (indegreeByEntity.get(edge.to) ?? 0) + 1);
    outgoingBySource.set(edge.from, [...(outgoingBySource.get(edge.from) ?? []), edge.to]);
  }
  const queue = [...[...entityIds].filter((id) => (indegreeByEntity.get(id) ?? 0) === 0)];
  let visited = 0;
  while (queue.length > 0) {
    const current = queue.shift()!;
    visited++;
    for (const next of outgoingBySource.get(current) ?? []) {
      const nextDegree = (indegreeByEntity.get(next) ?? 0) - 1;
      indegreeByEntity.set(next, nextDegree);
      if (nextDegree === 0) queue.push(next);
    }
  }
  if (visited !== entityIds.size) {
    errors.push(i18n.t("common:validation.cycleDetected"));
  }

  // 路由完整性
  // ... group约束 ...
  // ... 跨分支检测 ...

  return errors.length > 0 ? { ok: false, errors } : { ok: true };
};
```

#### 步骤 2.2: 修改 `web/src/pages/control-plane/model/useControlPlaneDraftState.ts`

合并两个变更检测为一个 `hasDraftChanges`。

```typescript
// 在 return 之前新增：
const hasDraftChanges = hasNodeDraftChanges || hasWorkflowDraftChanges;

// return 中新增：
return {
  // ... 所有现有字段 ...
  hasNodeDraftChanges,       // 保留，buildNextWorkflowForSelectedNode 需要
  hasWorkflowDraftChanges,   // 保留，buildNextWorkflowForSelectedNode 需要
  hasDraftChanges,           // ★ 新增：统一变更检测
};
```

#### 步骤 2.3: 修改 `web/src/pages/control-plane/model/useControlPlanePage.ts`

**删除以下代码**：
- `saveSelectedNodeConfig` 函数 (第 1469-1540 行)
- `saveSelectedWorkflowNodeConfig` 函数 (第 1255-1299 行)
- `saveSelectedNodeConfigOnBlur` 函数 (第 1542-1553 行)
- workflow debounce useEffect (第 1306-1313 行)
- `pendingNodeSaveRef` (第 228 行)
- `setWorkflowSaveFailed` / `workflowSaveFailed` (第 1301-1304 行的 reset useEffect)

**新增**：

```typescript
const isSavingNodeAll = useRef(false);
const [saveFailed, setSaveFailed] = useState(false);

// 统一保存函数
const saveSelectedNodeAll = useCallback(async (opts?: { silentSuccess?: boolean }) => {
  if (!workflow || !selectedNode) return;
  if (isSavingNodeAll.current) return;

  isSavingNodeAll.current = true;
  if (!opts?.silentSuccess) setActionMessage("");
  try {
    const built = buildNextWorkflowForSelectedNode({
      includeNodeConfig: hasNodeDraftChanges,
      includeWorkflowConfig: hasWorkflowDraftChanges,
    });
    if (!built.ok) {
      setActionMessage(built.error);
      return;
    }

    // L1 校验（不阻塞保存，但数据损坏时阻止）
    const validation = validateWorkflowForSave(built.workflow);
    if (!validation.ok) {
      setActionMessage(validation.message);
      return;
    }

    await saveWorkflowDefinitionReq(activePipelineId, built.workflow);
    updatePipelineState(activePipelineId, (prev) => ({
      ...prev,
      workflow: built.workflow,
      pipeline: hasNodeDraftChanges
        ? prev.pipeline.map((node) =>
            node.id === selectedNode.id
              ? (() => { /* 应用 node 配置 */ })()
              : node,
          )
        : prev.pipeline,
    }));
    setSaveFailed(false);
    if (!opts?.silentSuccess) setActionMessage(t("actionMessage.nodeSaved", { nodeId: selectedNode.id }));
    await refresh();
  } catch (error) {
    const message = getApiErrorMessage(error);
    setActionMessage(t("actionMessage.nodeSaveFailed", { message }));
    setSaveFailed(true);
  } finally {
    isSavingNodeAll.current = false;
  }
}, [
  workflow, selectedNode,
  draftTitle, draftAgentId, draftExecutorSessionId, draftDependsOn, draftInstruction,
  draftAllowReject, draftMaxRejectCount,
  draftWorkflowLane, draftWorkflowRouteAllowed, draftWorkflowRouteTargets,
  hasNodeDraftChanges, hasWorkflowDraftChanges,
  isSessionForAgent, activePipelineId,
]);

// 统一自动保存 useEffect
useEffect(() => {
  if (!selectedNode || !hasDraftChanges) return;
  if (isSavingNodeAll.current || saveFailed) return;
  const timer = setTimeout(() => {
    void saveSelectedNodeAll({ silentSuccess: true });
  }, 300);
  return () => clearTimeout(timer);
}, [selectedNode?.id, hasDraftChanges, saveFailed, saveSelectedNodeAll]);

// 切换节点时重置 saveFailed
useEffect(() => {
  setSaveFailed(false);
}, [selectedNode?.id]);
```

**修改 `startPipelineRun`** (第 1002-1027 行)：

```typescript
const startPipelineRun = async (pipelineId: PipelineId = activePipelineId) => {
  // 1. 等待进行中的保存完成
  const waitForSave = () => new Promise<void>((resolve) => {
    const check = () => {
      if (!isSavingNodeAll.current) return resolve();
      setTimeout(check, 50);
    };
    check();
  });
  await waitForSave();

  // 2. 保存未保存的草稿
  if (pipelineId === activePipelineId && selectedNode && hasDraftChanges) {
    await saveSelectedNodeAll({ silentSuccess: true });
    if (saveFailed) {
      setActionMessage(t("actionMessage.cannotRunSaveFailed"));
      return;
    }
  }

  // 3. 运行前完整校验 (L1 + L2 + L3)
  const currentWorkflow = getPipelineStateSnapshot(pipelineId, pipelineStateById).workflow;
  if (currentWorkflow) {
    const validation = validateWorkflowForRun(currentWorkflow);
    if (!validation.ok) {
      setActionMessage(t("actionMessage.cannotRunValidationFailed", { errors: validation.errors.join("; ") }));
      return;
    }
  }

  // 4. 启动运行
  setActivePipelineId(pipelineId);
  updatePipelineState(pipelineId, (prev) => ({ ...prev, isRunning: true }));
  setActionMessage("");
  try {
    const result = await startPipelineRunReq(pipelineId);
    if (result.run) {
      updatePipelineState(pipelineId, (prev) => ({
        ...prev,
        runId: result.run?.id ?? prev.runId,
        pipeline: result.run?.nodes ?? prev.pipeline,
      }));
    }
    await refresh();
  } catch (error) {
    const message = getApiErrorMessage(error);
    setActionMessage(t("actionMessage.runStartFailed", { message }));
  } finally {
    updatePipelineState(pipelineId, (prev) => ({ ...prev, isRunning: false }));
  }
};
```

**修改其他保存函数** — 去掉前端 `validateWorkflowBeforeSave`，改用 `validateWorkflowForSave`：

| 函数 | 变更 |
|------|------|
| `saveSelectedGroupConfig` | `validateWorkflowBeforeSave` → `validateWorkflowForSave` |
| `saveWorkflowJsonDraft` | `validateWorkflowBeforeSave` → `validateWorkflowForSave` |
| `addTemplateNode` | `validateWorkflowBeforeSave` → `validateWorkflowForSave` |
| `deleteTemplateNodeById` | `validateWorkflowBeforeSave` → `validateWorkflowForSave` |
| `addParallelGroup` | 无校验 → 保持不变 |
| `deleteParallelGroupById` | 无校验 → 保持不变 |
| `moveNode` | 无校验 → 保持不变 |
| `reorderNode` | 无校验 → 保持不变 |

#### 步骤 2.4: 修改 `web/src/widgets/node-detail/ui/NodeDetailPanel.tsx`

移除 `onBlurSave` prop。所有字段只更新 draft state，统一 auto-save useEffect 负责保存。

```typescript
// 从 props 中删除 onBlurSave
type NodeDetailPanelProps = {
  // ...
  // 删除: onBlurSave: () => void;
};

// 所有字段变更：
// <input onBlur={onBlurSave} />           → <input />
// onChange + onBlurSave()                  → onChange
// onClose={onBlurSave}                     → 删除
```

---

## 五、变更清单

### 新增文件

| 文件 | 用途 |
|------|------|
| `src/pipeline/workflow/save-validate.ts` | L1 数据完整性校验 (save 时) |
| `web/src/pages/control-plane/model/pipelineSaveValidation.ts` | 前端分层校验 (L1 save + L1/L2/L3 run) |

### 修改文件

| 文件 | 变更 |
|------|------|
| `src/pipeline/workflow/io.ts` | `saveWorkflowDefinitionWithStorage` 用 `validateWorkflowDataIntegrity` 替换 `validateWorkflowDefinition`，移除 `validateWorkflowOutputConfig` |
| `src/app/pipeline-runtime.ts` | `setWorkflow` 去掉 `emitPipeline()` + `syncRunGroupsFromWorkflow`；新增 `reconcileRunWithWorkflowChanges` |
| `src/transport/ws-methods/pipeline-workflow.ts` | `pipeline.workflow.save` 用 L1 校验，去掉 `seedRun`，改用 `reconcile` + 单次 `emitPipeline` |
| `src/services/pipeline-service.ts` | `startPipeline` 在 seedRun 前加 `validateWorkflowGraph` + `validateWorkflowOutputConfig` |
| `web/src/pages/control-plane/model/useControlPlaneDraftState.ts` | 新增 `hasDraftChanges` |
| `web/src/pages/control-plane/model/useControlPlanePage.ts` | 删除双路径保存；新增 `saveSelectedNodeAll` + 统一 auto-save；改 `startPipelineRun` 加运行前校验 |
| `web/src/widgets/node-detail/ui/NodeDetailPanel.tsx` | 移除 `onBlurSave` prop |

### 不变文件

| 文件 | 原因 |
|------|------|
| `src/pipeline/workflow/validate.ts` | `validateWorkflowGraph` 保持原样，被 `startPipeline` 调用 |
| `src/pipeline/workflow-graph.ts` | 不需要改 |
| `src/app/runtime-store.ts` | 不需要改 |
| `src/pipeline/scheduler-service.ts` | 不需要改 |
| `web/src/entities/pipeline/service.ts` | WS 调用不变 |

---

## 六、风险与回退

| 风险 | 缓解措施 |
|------|----------|
| L1 校验太松，保存了"坏"图 | 后端 `startPipeline` 做完整 L1+L2+L3 校验兜底；运行时 scheduler 也有依赖检查 |
| reconcile 逻辑引入 bug | reconcile 只做 add/update/remove，不改变 status；对已有运行节点是纯元数据更新 |
| 统一 auto-save 300ms 延迟感觉慢 | 300ms 是保守值，可调；用户感知上比当前 blur + debounce 两条路径更快更一致 |
| 前端删除 `validateWorkflowBeforeSave` 后出现回归 | 每个保存函数仍然调用 `validateWorkflowForSave` (L1)；后端也有 L1 兜底 |

---

## 七、实施顺序

1. **后端 `save-validate.ts`** — 新文件，无风险
2. **后端 `io.ts`** — 切换校验函数
3. **后端 `pipeline-runtime.ts`** — setWorkflow 简化 + reconcile 方法
4. **后端 `pipeline-workflow.ts`** — WS handler 简化
5. **后端 `pipeline-service.ts`** — startPipeline 加校验
6. **前端 `pipelineSaveValidation.ts`** — 新文件
7. **前端 `useControlPlaneDraftState.ts`** — 合并 hasDraftChanges
8. **前端 `useControlPlanePage.ts`** — 合并保存路径 + 改 startPipelineRun
9. **前端 `NodeDetailPanel.tsx`** — 移除 onBlurSave

步骤 1-5 可以独立于 6-9 实施（后端变更不破坏前端现有行为，因为前端仍然发送完整 workflow，后端只是放宽了校验）。
