import { validateWorkflowGraph } from "./validate";
import { normalizeRouteListWithDefaults } from "./routes";
import type {
  ExecutorRole,
  NodeExecutor,
  OutputSpec,
  PipelineTemplateNode,
  WorkflowDefinitionRuntime,
  WorkflowEdge,
  WorkflowGroup,
  WorkflowJoinPolicy,
  WorkflowNode,
  WorkflowOutputConfig,
  WorkflowPlugins,
  WorkflowReadResult,
  WorkflowRemoteBatchPlugin,
  WorkflowRetryPolicy,
  WorkflowRoutePolicy,
  WorkflowScheduler,
  WorkflowSchedulerPlugin,
} from "../types/workflow";

// ====== Internal constants / helpers ======

const DEFAULT_REMOTE_BATCH_URL = String(
  process.env.OPENCLAW_PIPELINE_POOL_URL ?? "",
).trim();

import { isRecord } from "../../utils/guards";
export { isRecord };

const isExecutorRole = (value: unknown): value is ExecutorRole =>
  value === "planner" || value === "coder" || value === "tester" || value === "reviewer" || value === "operator";

const normalizeNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
};

const normalizeStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    out.push(trimmed);
  }
  return out;
};

const normalizeIntegerInRange = (value: unknown, fallback: number, min: number, max: number): number => {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(num)));
};

export const normalizeWorkflowScheduler = (value: unknown): WorkflowScheduler => {
  const record = isRecord(value) ? value : {};
  const loopGuard = isRecord(record.loopGuard) ? record.loopGuard : {};
  const mode = record.mode === "manual" ? "manual" : "auto";
  const dispatchBy = record.dispatchBy === "node" ? "node" : "item";
  return {
    enabled: record.enabled !== false,
    mode,
    dispatchBy,
    maxConcurrency: normalizeIntegerInRange(record.maxConcurrency, 3, 1, 20),
    loopGuard: {
      maxGlobalIterations: normalizeIntegerInRange(loopGuard.maxGlobalIterations, 200, 10, 100_000),
      maxPerItemLoop: normalizeIntegerInRange(loopGuard.maxPerItemLoop, 8, 1, 100),
    },
  };
};

const normalizeRemoteBatchPlugin = (value: unknown): WorkflowRemoteBatchPlugin => {
  const record = isRecord(value) ? value : {};
  return {
    enabled: record.enabled === true,
    url: normalizeNonEmptyString(record.url) ?? DEFAULT_REMOTE_BATCH_URL,
    startBatch: normalizeIntegerInRange(record.startBatch, 1, 1, 1_000_000),
    // 批大小与取数来源都属于低频配置，统一并入插件配置，避免主面板堆叠过多参数。
    batchSize: normalizeIntegerInRange(record.batchSize, 5, 1, 1_000),
    sourceField: normalizeNonEmptyString(record.sourceField) ?? "list30",
  };
};

const normalizeSchedulerPlugin = (value: unknown): WorkflowSchedulerPlugin => {
  const record = isRecord(value) ? value : {};
  return {
    // 调度器历史上默认对所有流水线开启；插件化后继续保持默认开启，避免升级后界面和行为突然消失。
    enabled: record.enabled !== false,
  };
};

export const normalizeWorkflowPlugins = (value: unknown): WorkflowPlugins => {
  const record = isRecord(value) ? value : {};
  return {
    // 插件能力对所有流水线一致，这里只记录每条流水线自己的启用与参数配置。
    remoteBatch: normalizeRemoteBatchPlugin(record.remoteBatch),
    scheduler: normalizeSchedulerPlugin(record.scheduler),
  };
};

const normalizeRoutePolicy = (value: unknown): WorkflowRoutePolicy | null => {
  if (!isRecord(value)) return null;
  const allowed = normalizeRouteListWithDefaults(normalizeStringArray(value.allowed));
  if (allowed.length < 2 || allowed.length > 5) return null;
  return { allowed };
};

const normalizeRetryPolicy = (value: unknown): WorkflowRetryPolicy => {
  const record = isRecord(value) ? value : {};
  return {
    maxAttempts: normalizeIntegerInRange(record.maxAttempts, 2, 1, 10),
    backoffMs: normalizeIntegerInRange(record.backoffMs, 0, 0, 600_000),
  };
};

const normalizeExecutor = (value: unknown): NodeExecutor | null => {
  if (!isRecord(value)) return null;
  const role = value.role;
  if (!isExecutorRole(role)) return null;
  const agentId = normalizeNonEmptyString(value.agentId);
  if (!agentId) return null;
  const fallbackAgentId = normalizeNonEmptyString(value.fallbackAgentId);
  const sessionId = normalizeNonEmptyString(value.sessionId);
  return {
    agentId,
    role,
    fallbackAgentId,
    sessionId,
  };
};

const normalizeOutputSpec = (value: unknown): OutputSpec | null => {
  if (!isRecord(value)) return null;
  const type = normalizeNonEmptyString(value.type);
  if (!type) return null;
  const schemaVersion = normalizeIntegerInRange(value.schemaVersion, 0, 1, Number.MAX_SAFE_INTEGER);
  if (schemaVersion <= 0) return null;
  return { type, schemaVersion };
};

export const normalizeTemplateNode = (value: unknown): PipelineTemplateNode | null => {
  if (!isRecord(value)) return null;
  const id = normalizeNonEmptyString(value.id);
  const title = normalizeNonEmptyString(value.title);
  if (!id || !title) return null;

  const executor = normalizeExecutor(value.executor);
  if (!executor) return null;

  const outputSpec = normalizeOutputSpec(value.outputSpec);
  if (!outputSpec) return null;

  const instruction = typeof value.instruction === "string" ? value.instruction.trim() : "";
  const dependsOn = normalizeStringArray(value.dependsOn);
  const allowReject = value.allowReject === true;
  const maxRejectCount = normalizeIntegerInRange(value.maxRejectCount, 3, 0, 10);

  return {
    id,
    title,
    dependsOn,
    executor,
    instruction,
    outputSpec,
    allowReject,
    maxRejectCount,
  };
};

export const normalizeWorkflowNode = (value: unknown): WorkflowNode | null => {
  if (!isRecord(value)) return null;
  const id = normalizeNonEmptyString(value.id);
  const name = normalizeNonEmptyString(value.name);
  if (!id || !name) return null;

  const executor = normalizeExecutor(value.executor);
  if (!executor) return null;

  const outputSpec = normalizeOutputSpec(value.outputSpec);
  if (!outputSpec) return null;

  const lane = value.lane === "branch" ? "branch" : "main";
  const inputMode = value.inputMode === "batch" ? "batch" : "single";
  const outputMode = value.outputMode === "array" ? "array" : "single";
  const routePolicy = value.routePolicy === null ? null : normalizeRoutePolicy(value.routePolicy);
  if (value.routePolicy !== undefined && value.routePolicy !== null && !routePolicy) return null;
  const dependencyPolicy = value.dependencyPolicy === "any" ? "any" : "all";

  const branchScopeId = normalizeNonEmptyString(value.branchScopeId);
  const routeSourceNodeId = normalizeNonEmptyString(value.routeSourceNodeId);
  const routeValue = normalizeNonEmptyString(value.routeValue);

  const node: WorkflowNode = {
    id,
    name,
    type: normalizeNonEmptyString(value.type) ?? "task",
    enabled: value.enabled !== false,
    isMainline: value.isMainline !== false,
    lane,
    parallelGroupId: normalizeNonEmptyString(value.parallelGroupId),
    executor,
    inputMode,
    outputMode,
    dependencyPolicy,
    routePolicy,
    retryPolicy: normalizeRetryPolicy(value.retryPolicy),
    outputSpec,
    instruction: typeof value.instruction === "string" ? value.instruction.trim() : "",
    allowReject: value.allowReject === true,
    maxRejectCount: normalizeIntegerInRange(value.maxRejectCount, 3, 0, 10),
  };
  // 仅在显式提供时写入 branch scope 字段，避免 null 值污染 JSON 输出
  if (branchScopeId) node.branchScopeId = branchScopeId;
  if (routeSourceNodeId) node.routeSourceNodeId = routeSourceNodeId;
  if (routeValue) node.routeValue = routeValue;
  return node;
};

export const normalizeWorkflowEdge = (value: unknown): WorkflowEdge | null => {
  if (!isRecord(value)) return null;
  const from = normalizeNonEmptyString(value.from);
  const to = normalizeNonEmptyString(value.to);
  if (!from || !to) return null;
  return {
    from,
    to,
    when: normalizeNonEmptyString(value.when),
  };
};

const normalizeWorkflowEdgeV3 = (value: unknown): WorkflowEdge | null => {
  if (!isRecord(value)) return null;
  const from = normalizeNonEmptyString(value.from);
  const to = normalizeNonEmptyString(value.to);
  if (!from || !to) return null;
  // v3 API 闭环要求：读取接口返回运行时 when 形状时，写回 /workflow 也必须可直接接受。
  // 这里仅在 version=3.0 契约下做"同版本双形状"归一化，不允许 version=2.0 旁路写入。
  if ("when" in value) {
    return {
      from,
      to,
      when: normalizeNonEmptyString(value.when),
    };
  }
  const kind = value.kind;
  if (kind === "dependency") {
    return { from, to, when: null };
  }
  if (kind === "route") {
    const route = normalizeNonEmptyString(value.route);
    if (!route) return null;
    return { from, to, when: route };
  }
  return null;
};

export const normalizeWorkflowGroup = (value: unknown): WorkflowGroup | null => {
  if (!isRecord(value)) return null;
  const id = normalizeNonEmptyString(value.id);
  if (!id) return null;

  const members = [...new Set(normalizeStringArray(value.members))];
  if (members.length < 2) return null;

  const type = value.type === "parallel" ? "parallel" : null;
  if (!type) return null;

  const joinPolicy: WorkflowJoinPolicy = "all";

  // 历史 any/quorum 降级：运行时仅支持 all，读取历史数据时静默降级为 all。
  // 保存新 workflow 时 validate 会显式拒绝 any/quorum。
  if (value.joinPolicy === "any" || value.joinPolicy === "quorum") {
    // 静默降级 — 历史数据兼容，新保存会被 validate 拦截
  }

  return {
    id,
    type,
    members,
    joinPolicy,
  };
};

export const normalizeWorkflowOutputConfig = (value: unknown): WorkflowOutputConfig => {
  const record = isRecord(value) ? value : {};
  const mode = record.mode === "explicit" ? "explicit" : "mainline_last";
  const nodeId = mode === "explicit" ? normalizeNonEmptyString(record.nodeId) : null;
  return { mode, nodeId };
};

// ====== Read raw / parse ======

export const readWorkflowDefinitionFromRaw = (value: unknown): WorkflowDefinitionRuntime | null => {
  const parsed = readWorkflowDefinitionFromRawDetailed(value);
  return parsed.ok ? parsed.workflow : null;
};

export const readWorkflowDefinitionFromRawDetailed = (value: unknown): WorkflowReadResult => {
  if (!isRecord(value)) {
    return { ok: false, error: "invalid_workflow_definition", detail: "workflow 根对象格式非法" };
  }
  if (value.version === "2.0") {
    return {
      ok: false,
      error: "workflow_migration_required",
      detail: "检测到 workflow v2.0，请先执行迁移脚本再写入",
    };
  }
  if (value.version !== "3.0") {
    return { ok: false, error: "invalid_workflow_definition", detail: `workflow.version 非法: ${String(value.version ?? "")}` };
  }

  if (!Array.isArray(value.nodes) || !Array.isArray(value.edges) || !Array.isArray(value.groups)) {
    return { ok: false, error: "invalid_workflow_definition", detail: "workflow.nodes/edges/groups 必须为数组" };
  }

  const nodes: WorkflowNode[] = [];
  for (const item of value.nodes) {
    const normalized = normalizeWorkflowNode(item);
    if (!normalized) return { ok: false, error: "invalid_workflow_definition", detail: "workflow.nodes 存在非法节点结构" };
    nodes.push(normalized);
  }

  const edges: WorkflowEdge[] = [];
  for (const item of value.edges) {
    const normalized = normalizeWorkflowEdgeV3(item);
    if (!normalized) return { ok: false, error: "invalid_workflow_definition", detail: "workflow.edges 存在非法边结构" };
    edges.push(normalized);
  }

  const groups: WorkflowGroup[] = [];
  for (const item of value.groups) {
    // 预检：在 normalize 静默降级之前显式拒绝不支持的 joinPolicy
    if (isRecord(item) && (item.joinPolicy === "any" || item.joinPolicy === "quorum")) {
      return {
        ok: false,
        error: "join_policy_not_supported",
        detail: `并行组 "${String(item.id ?? "?")}" 的 joinPolicy "${String(item.joinPolicy)}" 未支持，当前仅支持 "all"`,
      };
    }
    const normalized = normalizeWorkflowGroup(item);
    if (!normalized) return { ok: false, error: "invalid_workflow_definition", detail: "workflow.groups 存在非法并行组结构" };
    groups.push(normalized);
  }

  const workflow: WorkflowDefinitionRuntime = {
    version: "3.0",
    scheduler: normalizeWorkflowScheduler(value.scheduler),
    plugins: normalizeWorkflowPlugins(value.plugins),
    output: normalizeWorkflowOutputConfig(value.output),
    nodes,
    edges,
    groups,
  };

  const validation = validateWorkflowGraph(workflow);
  if (!validation.ok) return { ok: false, error: validation.error, detail: validation.detail };
  return { ok: true, workflow };
};
