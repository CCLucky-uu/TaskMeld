import {
  normalizeWorkflowScheduler,
  normalizeWorkflowPlugins,
  normalizeWorkflowNode,
} from "./normalize";
import type {
  PipelineTemplateNode,
  WorkflowDefinitionRuntime,
  WorkflowEdge,
  WorkflowNode,
} from "../types/workflow";

// ====== Default template nodes ======

export const defaultTemplateNodes = (): PipelineTemplateNode[] => [];

const mapTemplateNodesToWorkflow = (nodes: PipelineTemplateNode[]): WorkflowDefinitionRuntime => {
  const workflowNodes: WorkflowNode[] = nodes.map((node) => ({
    id: node.id,
    name: node.title,
    type: "task",
    enabled: true,
    isMainline: true,
    lane: "main",
    parallelGroupId: null,
    executor: node.executor,
    inputMode: "single",
    outputMode: "single",
    dependencyPolicy: "all",
    routePolicy: null,
    retryPolicy: {
      maxAttempts: 2,
      backoffMs: 0,
    },
    outputSpec: node.outputSpec,
    instruction: node.instruction,
    allowReject: node.allowReject,
    maxRejectCount: node.maxRejectCount,
  }));

  const edges: WorkflowEdge[] = [];
  for (const node of nodes) {
    for (const dep of node.dependsOn) {
      edges.push({ from: dep, to: node.id, when: null });
    }
  }

  return {
    version: "3.0",
    scheduler: normalizeWorkflowScheduler(undefined),
    plugins: normalizeWorkflowPlugins(undefined),
    output: { mode: "mainline_last", nodeId: null },
    nodes: workflowNodes,
    edges,
    groups: [],
  };
};

export const defaultWorkflowDefinition = (): WorkflowDefinitionRuntime =>
  mapTemplateNodesToWorkflow(defaultTemplateNodes());
