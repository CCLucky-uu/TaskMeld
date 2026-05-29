import { validateWorkflowGraph } from "./validate";
import type {
  PipelineTemplateNode,
  WorkflowDefinitionRuntime,
  WorkflowEdge,
  WorkflowNode,
} from "../types/workflow";

const toUniqueList = (items: string[]) => [...new Set(items)];

// ====== Workflow → Template nodes (unified, with dedup) ======

/**
 * 从 WorkflowDefinitionRuntime 提取模板节点（仅 dependency 类型的出边）。
 * 这是 workflow → template 映射的唯一权威实现。
 */
export const workflowToTemplateNodes = (workflow: WorkflowDefinitionRuntime): PipelineTemplateNode[] => {
  const incomingByNodeId = new Map<string, string[]>();
  for (const edge of workflow.edges) {
    // template.dependsOn 只表达依赖边；路由边属于分流语义，不能回写成普通依赖。
    if (edge.when !== null) continue;
    const prev = incomingByNodeId.get(edge.to) ?? [];
    prev.push(edge.from);
    incomingByNodeId.set(edge.to, toUniqueList(prev));
  }
  return workflow.nodes.map((node) => ({
    id: node.id,
    title: node.name,
    executor: node.executor,
    instruction: node.instruction,
    outputSpec: node.outputSpec,
    dependsOn: incomingByNodeId.get(node.id) ?? [],
    allowReject: node.allowReject,
    maxRejectCount: node.maxRejectCount,
  }));
};

// ====== Merge template nodes into workflow ======

export const mergeTemplateNodesIntoWorkflow = (
  current: WorkflowDefinitionRuntime,
  nextTemplateNodes: PipelineTemplateNode[],
): WorkflowDefinitionRuntime => {
  const currentNodeById = new Map(current.nodes.map((node) => [node.id, node]));
  const nodeIds = new Set(nextTemplateNodes.map((node) => node.id));
  const groupIds = new Set(current.groups.map((group) => group.id));

  const mergedNodes: WorkflowNode[] = nextTemplateNodes.map((tpl) => {
    const existing = currentNodeById.get(tpl.id);
    if (!existing) {
      return {
        id: tpl.id,
        name: tpl.title,
        type: "task",
        enabled: true,
        isMainline: true,
        lane: "main",
        parallelGroupId: null,
        executor: tpl.executor,
        inputMode: "single",
        outputMode: "single",
        dependencyPolicy: "all",
        routePolicy: null,
        retryPolicy: {
          maxAttempts: 2,
          backoffMs: 0,
        },
        outputSpec: tpl.outputSpec,
        instruction: tpl.instruction,
        allowReject: tpl.allowReject,
        maxRejectCount: tpl.maxRejectCount,
      };
    }
    return {
      ...existing,
      name: tpl.title,
      executor: tpl.executor,
      instruction: tpl.instruction,
      outputSpec: tpl.outputSpec,
      allowReject: tpl.allowReject,
      maxRejectCount: tpl.maxRejectCount,
    };
  });

  const unconditionalEdges: WorkflowEdge[] = [];
  for (const node of nextTemplateNodes) {
    for (const dep of node.dependsOn) {
      if (!nodeIds.has(dep)) continue;
      unconditionalEdges.push({
        from: dep,
        to: node.id,
        when: null,
      });
    }
  }
  const conditionalEdges = current.edges.filter(
    (edge) =>
      edge.when !== null &&
      (nodeIds.has(edge.from) || groupIds.has(edge.from)) &&
      (nodeIds.has(edge.to) || groupIds.has(edge.to)),
  );
  const allEdges = [...unconditionalEdges, ...conditionalEdges];
  const edgeSeen = new Set<string>();
  const mergedEdges: WorkflowEdge[] = [];
  for (const edge of allEdges) {
    const key = `${edge.from}|${edge.when ?? ""}|${edge.to}`;
    if (edgeSeen.has(key)) continue;
    edgeSeen.add(key);
    mergedEdges.push(edge);
  }

  const mergedGroups = current.groups.filter(
    (group) => group.members.every((member) => nodeIds.has(member)),
  );

  const merged: WorkflowDefinitionRuntime = {
    version: "3.0",
    scheduler: current.scheduler,
    plugins: current.plugins,
    output: current.output,
    nodes: mergedNodes,
    edges: mergedEdges,
    groups: mergedGroups,
  };

  if (!validateWorkflowGraph(merged).ok) return current;
  return merged;
};
