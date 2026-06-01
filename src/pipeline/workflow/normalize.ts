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
    // Batch size and data source are low-frequency configuration; consolidate into plugin config to avoid too many params piling up on the main panel.
    batchSize: normalizeIntegerInRange(record.batchSize, 5, 1, 1_000),
    sourceField: normalizeNonEmptyString(record.sourceField) ?? "list30",
  };
};

const normalizeSchedulerPlugin = (value: unknown): WorkflowSchedulerPlugin => {
  const record = isRecord(value) ? value : {};
  return {
    // The scheduler was historically enabled for all pipelines by default; after plugin-ification, keep it enabled by default so the UI and behavior don't suddenly disappear after upgrade.
    enabled: record.enabled !== false,
  };
};

export const normalizeWorkflowPlugins = (value: unknown): WorkflowPlugins => {
  const record = isRecord(value) ? value : {};
  return {
    // Plugin capabilities are consistent across all pipelines; only record each pipeline's own enabled + parameter configuration here.
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
  // Only write branch scope fields when explicitly provided to avoid null values polluting JSON output
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
  // v3 API closed-loop requirement: when the read API returns runtime when shapes, writing back to /workflow must also be directly accepted.
  // Here, only do "same-version dual-shape" normalization under the version=3.0 contract; do not allow version=2.0 bypass writes.
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

  // Historical any/quorum downgrade: runtime only supports all; silently downgrade to all when reading historical data.
  // When saving a new workflow, validate will explicitly reject any/quorum.
  if (value.joinPolicy === "any" || value.joinPolicy === "quorum") {
    // Silently downgrade — historical data compatibility; new saves will be intercepted by validate
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
    return { ok: false, error: "invalid_workflow_definition", detail: "Workflow root object has an invalid format" };
  }
  if (value.version === "2.0") {
    return {
      ok: false,
      error: "workflow_migration_required",
      detail: "Workflow v2.0 detected, please run the migration script before writing",
    };
  }
  if (value.version !== "3.0") {
    return { ok: false, error: "invalid_workflow_definition", detail: `Invalid workflow.version: ${String(value.version ?? "")}` };
  }

  if (!Array.isArray(value.nodes) || !Array.isArray(value.edges) || !Array.isArray(value.groups)) {
    return { ok: false, error: "invalid_workflow_definition", detail: "workflow.nodes/edges/groups must be arrays" };
  }

  const nodes: WorkflowNode[] = [];
  for (const item of value.nodes) {
    const normalized = normalizeWorkflowNode(item);
    if (!normalized) return { ok: false, error: "invalid_workflow_definition", detail: "workflow.nodes contains an invalid node structure" };
    nodes.push(normalized);
  }

  const edges: WorkflowEdge[] = [];
  for (const item of value.edges) {
    const normalized = normalizeWorkflowEdgeV3(item);
    if (!normalized) return { ok: false, error: "invalid_workflow_definition", detail: "workflow.edges contains an invalid edge structure" };
    edges.push(normalized);
  }

  const groups: WorkflowGroup[] = [];
  for (const item of value.groups) {
    // Pre-check: explicitly reject unsupported joinPolicy before normalize silently downgrades it
    if (isRecord(item) && (item.joinPolicy === "any" || item.joinPolicy === "quorum")) {
      return {
        ok: false,
        error: "join_policy_not_supported",
        detail: `Parallel group "${String(item.id ?? "?")}" has unsupported joinPolicy "${String(item.joinPolicy)}", only "all" is currently supported`,
      };
    }
    const normalized = normalizeWorkflowGroup(item);
    if (!normalized) return { ok: false, error: "invalid_workflow_definition", detail: "workflow.groups contains an invalid parallel group structure" };
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
