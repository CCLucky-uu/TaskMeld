import type { WorkflowDefinition } from "../../../entities/pipeline/types.js";

const dedupeWorkflowEdges = (edges: WorkflowDefinition["edges"]): WorkflowDefinition["edges"] => {
  const seen = new Set<string>();
  const out: WorkflowDefinition["edges"] = [];
  for (const edge of edges) {
    const key = `${edge.from}|${edge.to}|${edge.when ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(edge);
  }
  return out;
};

export const buildWorkflowAfterNodeDelete = (workflow: WorkflowDefinition, nodeId: string): WorkflowDefinition => {
  const nextNodes = workflow.nodes.filter((node) => node.id !== nodeId);
  const incomingEdges = workflow.edges.filter((edge) => edge.to === nodeId);
  const outgoingEdges = workflow.edges.filter((edge) => edge.from === nodeId);
  const incomingDep = incomingEdges.filter((edge) => edge.when === null);
  const outgoingDep = outgoingEdges.filter((edge) => edge.when === null);
  const reconnectEdge =
    incomingDep.length === 1 && outgoingDep.length === 1
      ? { from: incomingDep[0].from, to: outgoingDep[0].to, when: null as string | null }
      : null;
  const removedEdgeKeys = new Set(
    [...incomingEdges, ...outgoingEdges].map((edge) => `${edge.from}|${edge.when ?? ""}|${edge.to}`),
  );
  const nextEdges = reconnectEdge
    ? dedupeWorkflowEdges([
        ...workflow.edges.filter((edge) => !removedEdgeKeys.has(`${edge.from}|${edge.when ?? ""}|${edge.to}`)),
        reconnectEdge,
      ])
    : workflow.edges.filter((edge) => edge.from !== nodeId && edge.to !== nodeId);
  const nextGroups = workflow.groups
    .map((group) => ({
      ...group,
      members: group.members.filter((member) => member !== nodeId),
    }))
    .filter((group) => group.members.length >= 2);
  const output =
    workflow.output?.mode === "explicit" && workflow.output.nodeId === nodeId
      ? { mode: "mainline_last" as const, nodeId: null }
      : workflow.output;

  return {
    ...workflow,
    nodes: nextNodes,
    edges: nextEdges,
    groups: nextGroups,
    ...(output ? { output } : {}),
  };
};
