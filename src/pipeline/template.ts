import { isRecord } from "../utils/guards";
import {
  normalizeWorkflowScheduler,
  normalizeWorkflowPlugins,
  normalizeTemplateNode,
  normalizeWorkflowNode,
  normalizeWorkflowEdge,
  normalizeWorkflowGroup,
} from "./workflow/normalize";
import { loadWorkflowDefinitionWithStorage } from "./workflow/io";
import { validateWorkflowGraph } from "./workflow/validate";
import type {
  WorkflowDefinitionRuntime,
  WorkflowStorageOptions,
  WorkflowReadResult,
} from "./types/workflow";

// ====== Re-exports from extracted modules ======

// Defaults
export { defaultTemplateNodes, defaultWorkflowDefinition } from "./workflow/defaults";

// Template mapper
export { mergeTemplateNodesIntoWorkflow, workflowToTemplateNodes } from "./workflow/template-mapper";

// ====== Normalize fallbacks ======

export const normalizeWorkflowFallbacks = (workflow: WorkflowDefinitionRuntime): WorkflowDefinitionRuntime => {
  return normalizeWorkflowFallbacksWithStorage(workflow, {});
};

export const normalizeWorkflowFallbacksWithStorage = (
  workflow: WorkflowDefinitionRuntime,
  options: WorkflowStorageOptions,
): WorkflowDefinitionRuntime => {
  const currentNodeById = new Map(loadWorkflowDefinitionWithStorage(options).nodes.map((node) => [node.id, node]));
  const normalizedNodes = workflow.nodes.map((node) => {
    const prev = currentNodeById.get(node.id);
    if (!prev) return node;
    const prevAgent = prev.executor.agentId.trim();
    const nextAgent = node.executor.agentId.trim();
    if (prevAgent === nextAgent) return node;
    return {
      ...node,
      executor: {
        ...node.executor,
        fallbackAgentId: null,
      },
    };
  });
  return {
    ...workflow,
    nodes: normalizedNodes,
  };
};

// ====== Read template nodes from raw ======

export const readTemplateNodesFromRaw = (value: unknown): import("./types/workflow").PipelineTemplateNode[] | null => {
  if (!Array.isArray(value)) return null;
  const nodes: import("./types/workflow").PipelineTemplateNode[] = [];
  for (const item of value) {
    const normalized = normalizeTemplateNode(item);
    if (!normalized) return null;
    nodes.push(normalized);
  }
  const ids = new Set(nodes.map((n) => n.id));
  if (ids.size !== nodes.length) return null;
  for (const node of nodes) {
    for (const dep of node.dependsOn) {
      if (!ids.has(dep)) return null;
    }
  }
  return nodes;
};

// ====== Migration ======

export const migrateWorkflowDefinitionV2RawToV3 = (value: unknown): WorkflowReadResult => {
  if (!isRecord(value) || value.version !== "2.0") {
    return { ok: false, error: "invalid_workflow_definition", detail: "仅支持从 workflow v2.0 迁移" };
  }
  if (!Array.isArray(value.nodes) || !Array.isArray(value.edges) || !Array.isArray(value.groups)) {
    return { ok: false, error: "invalid_workflow_definition", detail: "workflow.nodes/edges/groups 必须为数组" };
  }
  const nodes: import("./types/workflow").WorkflowNode[] = [];
  for (const item of value.nodes) {
    const normalized = normalizeWorkflowNode(item);
    if (!normalized) return { ok: false, error: "invalid_workflow_definition", detail: "workflow.nodes 存在非法节点结构" };
    nodes.push(normalized);
  }
  const edges: import("./types/workflow").WorkflowEdge[] = [];
  for (const item of value.edges) {
    const normalized = normalizeWorkflowEdge(item);
    if (!normalized) return { ok: false, error: "invalid_workflow_definition", detail: "workflow.edges 存在非法边结构" };
    edges.push(normalized);
  }
  const groups: import("./types/workflow").WorkflowGroup[] = [];
  for (const item of value.groups) {
    const normalized = normalizeWorkflowGroup(item);
    if (!normalized) return { ok: false, error: "invalid_workflow_definition", detail: "workflow.groups 存在非法并行组结构" };
    groups.push(normalized);
  }
  const workflow: WorkflowDefinitionRuntime = {
    version: "3.0",
    scheduler: normalizeWorkflowScheduler(value.scheduler),
    plugins: normalizeWorkflowPlugins(value.plugins),
    output: { mode: "mainline_last", nodeId: null },
    nodes,
    edges,
    groups,
  };
  const validation = validateWorkflowGraph(workflow);
  if (!validation.ok) return { ok: false, error: validation.error, detail: validation.detail };
  return { ok: true, workflow };
};

// ====== Re-exports from extracted modules (backward-compatible public API) ======

// Types re-exported from ./types/workflow
export type {
  ExecutorRole,
  NodeExecutor,
  OutputSpec,
  PipelineTemplateNode,
  WorkflowDispatchBy,
  WorkflowEdge,
  WorkflowEdgeV3,
  WorkflowGroup,
  WorkflowJoinPolicy,
  WorkflowNode,
  WorkflowNodeLane,
  WorkflowPlugins,
  WorkflowReadResult,
  WorkflowRemoteBatchPlugin,
  WorkflowRetryPolicy,
  WorkflowRoutePolicy,
  WorkflowScheduler,
  WorkflowSchedulerMode,
  WorkflowSchedulerPlugin,
  WorkflowStorageOptions,
  WorkflowDefinitionRuntime,
  WorkflowDefinitionV3,
  WorkflowValidationResult,
} from "./types/workflow";

// I/O functions re-exported from ./workflow/io
export {
  loadWorkflowDefinition,
  loadWorkflowDefinitionWithStorage,
  saveWorkflowDefinition,
  saveWorkflowDefinitionWithStorage,
  loadPipelineTemplate,
  loadPipelineTemplateWithStorage,
  savePipelineTemplate,
  savePipelineTemplateWithStorage,
} from "./workflow/io";

// Validation re-exported from ./workflow/validate
export { validateWorkflowDefinition, validateWorkflowOutputConfig } from "./workflow/validate";

// Normalize/parse re-exported from ./workflow/normalize
export { readWorkflowDefinitionFromRaw, readWorkflowDefinitionFromRawDetailed } from "./workflow/normalize";

// Pipeline output/link types
export type {
  WorkflowOutputConfig,
  PipelineOutput,
  PipelineOutputArtifactRef,
} from "./types/pipeline-output";

export type {
  RunInput,
  PipelineLink,
  PipelineLinkInputContract,
  PipelineInboundJob,
  PipelineInboundJobStatus,
  PipelineInboundQueueEvent,
} from "./types/pipeline-link";
export { buildJobId, isValidLinkId } from "./types/pipeline-link";
export { buildOutputId } from "./types/pipeline-output";
