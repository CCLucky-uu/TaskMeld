import type {
  PipelineTemplateNode,
  WorkflowDefinitionRuntime,
  WorkflowEdge,
  WorkflowGroup,
  WorkflowNode,
} from "./types/workflow";
import { mergeTemplateNodesIntoWorkflow, workflowToTemplateNodes } from "./workflow/template-mapper";
import { computeNodeScopes, isCrossBranchEdgeByScope, type NodeScopeMap } from "./workflow/branch-rules";
import type { GroupRun, NodeRun, Run } from "./runtime-model";

type WorkflowNodeWithMeta = NodeRun & {
  isMainline: boolean;
  lane: "main" | "branch";
  parallelGroupId: string | null;
};

type WorkflowIndices = {
  nodeById: Map<string, WorkflowNode>;
  incomingEdgesByTarget: Map<string, WorkflowEdge[]>;
  outgoingEdgesBySource: Map<string, WorkflowEdge[]>;
  groupById: Map<string, WorkflowGroup>;
  parallelGroupByMemberNodeId: Map<string, WorkflowGroup>;
  groups: WorkflowGroup[];
  /** Node branch scope cache. null = mainline, non-null = branch scope (e.g. "router:a"). */
  nodeScopes: NodeScopeMap;
};

// Re-export for backward compatibility
export { workflowToTemplateNodes } from "./workflow/template-mapper";

const buildIndices = (workflow: WorkflowDefinitionRuntime): WorkflowIndices => {
  const nodeById = new Map<string, WorkflowNode>();
  const incomingEdgesByTarget = new Map<string, WorkflowEdge[]>();
  const outgoingEdgesBySource = new Map<string, WorkflowEdge[]>();

  for (const node of workflow.nodes) {
    nodeById.set(node.id, node);
  }

  for (const edge of workflow.edges) {
    const incoming = incomingEdgesByTarget.get(edge.to) ?? [];
    incoming.push(edge);
    incomingEdgesByTarget.set(edge.to, incoming);

    const outgoing = outgoingEdgesBySource.get(edge.from) ?? [];
    outgoing.push(edge);
    outgoingEdgesBySource.set(edge.from, outgoing);
  }

  // Compute node branch scope: prefer explicit branchScopeId, derive from route edges when missing.
  // Include both nodes and groups in scope computation so group scopes are correctly propagated.
  const explicitScopes = new Map<string, string | null>();
  for (const node of workflow.nodes) {
    if (node.branchScopeId != null) {
      explicitScopes.set(node.id, node.branchScopeId);
    }
  }
  const allEntities = [
    ...workflow.nodes.map((n) => ({ id: n.id })),
    ...workflow.groups.map((g) => ({ id: g.id })),
  ];
  const nodeScopes = computeNodeScopes(allEntities, workflow.edges, explicitScopes);

  // explicitScopeIds: nodes that explicitly declare a non-default merge strategy (dependencyPolicy != "all"),
  // they are explicit convergence points for multiple branches and should accept dependency edges from different scopes.
  // Reset their scope to null to avoid cross-branch false positives blocking valid branch merges.
  for (const node of workflow.nodes) {
    if (node.dependencyPolicy && node.dependencyPolicy !== "all") {
      nodeScopes.set(node.id, null);
    }
  }

  const explicit = workflow.groups.filter((group) => group.type === "parallel" && group.members.length >= 2);
  const seen = new Set(explicit.map((group) => group.id));
  const inferredMembers = new Map<string, string[]>();
  for (const workflowNode of workflow.nodes) {
    const groupId = workflowNode.parallelGroupId?.trim();
    if (!groupId || seen.has(groupId)) continue;
    const current = inferredMembers.get(groupId) ?? [];
    current.push(workflowNode.id);
    inferredMembers.set(groupId, current);
  }

  const inferred = [...inferredMembers.entries()]
    .filter(([, members]) => members.length >= 2)
    .map(([id, members]) => ({
      id,
      type: "parallel" as const,
      members,
      joinPolicy: "all" as const,
    }));

  const groups = [...explicit, ...inferred];
  const groupById = new Map(groups.map((group) => [group.id, group]));
  const parallelGroupByMemberNodeId = new Map<string, WorkflowGroup>();
  for (const group of groups) {
    for (const memberId of group.members) {
      parallelGroupByMemberNodeId.set(memberId, group);
    }
  }

  return {
    nodeById,
    incomingEdgesByTarget,
    outgoingEdgesBySource,
    groupById,
    parallelGroupByMemberNodeId,
    groups,
    nodeScopes,
  };
};

export const createWorkflowGraph = (initialWorkflow: WorkflowDefinitionRuntime, initialTemplateNodes?: PipelineTemplateNode[]) => {
  let workflow = initialWorkflow;
  let templateNodes = initialTemplateNodes ?? workflowToTemplateNodes(initialWorkflow);
  let indices = buildIndices(workflow);

  const rebuild = () => {
    indices = buildIndices(workflow);
  };

  const setWorkflow = (nextWorkflow: WorkflowDefinitionRuntime) => {
    workflow = nextWorkflow;
    templateNodes = workflowToTemplateNodes(nextWorkflow);
    rebuild();
  };

  const setTemplateNodes = (nextTemplateNodes: PipelineTemplateNode[]) => {
    templateNodes = nextTemplateNodes;
    workflow = mergeTemplateNodesIntoWorkflow(workflow, nextTemplateNodes);
    rebuild();
  };

  const getIncomingEdges = (targetId: string) => indices.incomingEdgesByTarget.get(targetId) ?? [];
  const getOutgoingEdges = (sourceId: string) => indices.outgoingEdgesBySource.get(sourceId) ?? [];
  const getWorkflowNodeById = (nodeId: string) => indices.nodeById.get(nodeId) ?? null;
  const getWorkflowGroupById = (groupId: string) => indices.groupById.get(groupId) ?? null;
  const getParallelGroupByMemberNodeId = (nodeId: string) => indices.parallelGroupByMemberNodeId.get(nodeId) ?? null;
  const isWorkflowNodeEnabled = (nodeId: string) => getWorkflowNodeById(nodeId)?.enabled !== false;
  const isGroupId = (id: string) => indices.groupById.has(id);

  // Phase 2: determine branch identity based on scope, replacing incoming-edge shape inference.
  // scope is null → mainline node; scope is non-null → branch node.
  const isBranchNode = (nodeId: string) => {
    const scope = indices.nodeScopes.get(nodeId);
    return scope != null;
  };

  // Phase 2: determine cross-branch edges based on scope, replacing incoming-edge shape inference.
  // The old version would miss detection when B1→B2 unconditional edges exist because B2 was no longer "purely branch"; the new version is unaffected.
  const isCrossBranchEdge = (edge: { from: string; to: string; when: string | null }) =>
    isCrossBranchEdgeByScope(edge, indices.nodeScopes);

  const getNodeScope = (nodeId: string) => indices.nodeScopes.get(nodeId) ?? null;

  const getNodesWithWorkflowMeta = (nodes: NodeRun[]): WorkflowNodeWithMeta[] =>
    nodes.map((node) => {
      const matched = getWorkflowNodeById(node.id);
      return {
        ...node,
        isMainline: matched?.isMainline ?? true,
        lane: matched?.lane ?? "main",
        parallelGroupId: matched?.parallelGroupId ?? null,
      };
    });

  const syncRunGroupsFromWorkflow = (run: Run) => {
    const current = new Map((run.groups ?? []).map((group) => [group.id, group]));
    run.groups = indices.groups.map((group) => ({
      id: group.id,
      title: `Group ${group.id}`,
      status: current.get(group.id)?.status ?? "blocked",
      members: group.members,
      joinPolicy: group.joinPolicy,
      artifacts: current.get(group.id)?.artifacts ?? [],
      startedAt: current.get(group.id)?.startedAt ?? null,
      finishedAt: current.get(group.id)?.finishedAt ?? null,
      lastError: current.get(group.id)?.lastError ?? null,
    }));
    if (!run.groupItemRuns) run.groupItemRuns = [];
    const groupIds = new Set(indices.groups.map((group) => group.id));
    run.groupItemRuns = run.groupItemRuns.filter((item) => groupIds.has(item.groupId));
  };

  const getRunGroupMeta = (groupId: string, groups: GroupRun[]) => groups.find((group) => group.id === groupId) ?? null;

  return {
    getWorkflow: () => workflow,
    setWorkflow,
    getTemplateNodes: () => templateNodes,
    setTemplateNodes,
    getIndices: () => indices,
    getIncomingEdges,
    getOutgoingEdges,
    getWorkflowNodeById,
    getWorkflowGroupById,
    getParallelGroupByMemberNodeId,
    isWorkflowNodeEnabled,
    isGroupId,
    isBranchNode,
    isCrossBranchEdge,
    getNodeScope,
    getNodesWithWorkflowMeta,
    syncRunGroupsFromWorkflow,
    getRunGroupMeta,
  };
};

export type WorkflowGraph = ReturnType<typeof createWorkflowGraph>;
