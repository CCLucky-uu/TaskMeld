import { AgentItem } from "../../../entities/agent";
import { PipelineNode, PipelineTemplateNode, WorkflowDefinition, WorkflowGroup } from "../../../entities/pipeline";
import { TimelineItem } from "../../../entities/timeline";
import type { ApiError } from "../../../shared/ws-client";

export type InferredParallelGroup = {
  id: string;
  members: string[];
  joinPolicy: "all" | "any" | "quorum";
};

export const dedupeEdges = (edges: Array<{ from: string; to: string; when: string | null }>) => {
  const seen = new Set<string>();
  const out: Array<{ from: string; to: string; when: string | null }> = [];
  for (const edge of edges) {
    const key = `${edge.from}|${edge.to}|${edge.when ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(edge);
  }
  return out;
};

export const dependsOnFromWorkflow = (workflow: WorkflowDefinition, nodeId: string) =>
  workflow.edges.filter((edge) => edge.to === nodeId && edge.when === null).map((edge) => edge.from);

export const getParallelGroupMembers = (workflow: WorkflowDefinition, groupId: string) =>
  workflow.nodes.filter((node) => (node.parallelGroupId ?? "").trim() === groupId).map((node) => node.id);

export const getInferredParallelGroups = (workflow: WorkflowDefinition): InferredParallelGroup[] => {
  const explicitById = new Map(workflow.groups.map((group) => [group.id, group]));
  const groupIds = Array.from(
    new Set(workflow.nodes.map((node) => (node.parallelGroupId ?? "").trim()).filter(Boolean)),
  );

  return groupIds
    .map((groupId) => {
      const members = getParallelGroupMembers(workflow, groupId);
      if (members.length < 2) return null;
      const explicit = explicitById.get(groupId) ?? null;
      if (explicit) {
        return {
          id: explicit.id,
          members,
          joinPolicy: explicit.joinPolicy,
        };
      }
      return {
        id: groupId,
        members,
        joinPolicy: "all" as const,
      };
    })
    .filter((group): group is InferredParallelGroup => !!group);
};

export const materializeParallelGroups = (
  workflow: WorkflowDefinition,
  nodes: WorkflowDefinition["nodes"],
  edges: WorkflowDefinition["edges"],
  groups: WorkflowGroup[],
) => {
  const nextWorkflow: WorkflowDefinition = {
    ...workflow,
    nodes,
    edges,
    groups,
  };
  return getInferredParallelGroups(nextWorkflow).map((group) => ({
    id: group.id,
    type: "parallel" as const,
    members: group.members,
    joinPolicy: group.joinPolicy,
  }));
};

export const reorderWorkflowNodeWithinLane = (
  workflow: WorkflowDefinition,
  nodeId: string,
  targetNodeId: string,
  position: "before" | "after" = "before",
): WorkflowDefinition => {
  if (!nodeId || !targetNodeId || nodeId === targetNodeId) return workflow;
  const sourceIndex = workflow.nodes.findIndex((node) => node.id === nodeId);
  const targetIndex = workflow.nodes.findIndex((node) => node.id === targetNodeId);
  if (sourceIndex < 0 || targetIndex < 0) return workflow;

  const sourceLane = workflow.nodes[sourceIndex]?.lane === "branch" ? "branch" : "main";
  const targetLane = workflow.nodes[targetIndex]?.lane === "branch" ? "branch" : "main";
  if (sourceLane !== targetLane) return workflow;

  const nextNodes = [...workflow.nodes];
  const [movedNode] = nextNodes.splice(sourceIndex, 1);
  if (!movedNode) return workflow;

  const nextTargetIndex = nextNodes.findIndex((node) => node.id === targetNodeId);
  if (nextTargetIndex < 0) return workflow;
  // Reorder must explicitly distinguish "insert before target" vs "insert after target", otherwise moving down and dragging backwards would both incorrectly insert before.
  const insertIndex = position === "after" ? nextTargetIndex + 1 : nextTargetIndex;
  nextNodes.splice(insertIndex, 0, movedNode);

  return {
    ...workflow,
    nodes: nextNodes,
  };
};

export const moveWorkflowNodeWithinLane = (
  workflow: WorkflowDefinition,
  nodeId: string,
  direction: "up" | "down",
): WorkflowDefinition => {
  const currentIndex = workflow.nodes.findIndex((node) => node.id === nodeId);
  if (currentIndex < 0) return workflow;

  const currentNode = workflow.nodes[currentIndex];
  const lane = currentNode.lane === "branch" ? "branch" : "main";
  const laneNodeIndices = workflow.nodes.reduce<number[]>((indices, node, index) => {
    if ((node.lane === "branch" ? "branch" : "main") === lane) {
      indices.push(index);
    }
    return indices;
  }, []);
  const lanePosition = laneNodeIndices.indexOf(currentIndex);
  if (lanePosition < 0) return workflow;

  const swapTargetIndex = direction === "up" ? laneNodeIndices[lanePosition - 1] : laneNodeIndices[lanePosition + 1];
  if (swapTargetIndex === undefined) return workflow;

  const targetNodeId = workflow.nodes[swapTargetIndex]?.id ?? "";
  if (!targetNodeId) return workflow;
  return reorderWorkflowNodeWithinLane(workflow, nodeId, targetNodeId, direction === "up" ? "before" : "after");
};

type UpdateParallelGroupInput = {
  workflow: WorkflowDefinition;
  previousGroupId: string;
  nextGroupId: string;
  memberIds: string[];
  upstreamIds: string[];
  joinPolicy: "all" | "any" | "quorum";
};

export const updateParallelGroupInWorkflow = ({
  workflow,
  previousGroupId,
  nextGroupId,
  memberIds,
  upstreamIds,
  joinPolicy,
}: UpdateParallelGroupInput): WorkflowDefinition => {
  const inferredGroups = getInferredParallelGroups(workflow);
  const previousGroup = inferredGroups.find((group) => group.id === previousGroupId) ?? null;
  if (!previousGroup) return workflow;

  const previousMembers = previousGroup.members;
  const removedMemberIds = previousMembers.filter((memberId) => !memberIds.includes(memberId));
  const involvedMemberIds = [...new Set([...previousMembers, ...memberIds])];
  const downstreamIds = getCommonDownstreamIdsForGroup(workflow, previousGroupId, previousMembers);
  const keptGroupIds = workflow.groups.filter((group) => group.id !== previousGroupId && group.id !== nextGroupId);

  const nextNodes = workflow.nodes.map((node) => {
    if (removedMemberIds.includes(node.id)) {
      return { ...node, parallelGroupId: null };
    }
    if (memberIds.includes(node.id)) {
      return { ...node, parallelGroupId: nextGroupId };
    }
    return node;
  });

  const remapEntityId = (entityId: string) => (entityId === previousGroupId ? nextGroupId : entityId);
  const nextEdges = dedupeEdges([
    ...workflow.edges
      .map((edge) => ({
        ...edge,
        from: remapEntityId(edge.from),
        to: remapEntityId(edge.to),
      }))
      .filter((edge) => {
        if (edge.when !== null) {
          return edge.from !== previousGroupId && edge.to !== previousGroupId;
        }

        // After parallel-group membership changes, the old unconditional-edge semantics between the group and members are stale:
        // keeping them would leave "removed members" dangling, or give members both a group edge and a direct edge,
        // triggering backend workflow validation failures. Clear old structure and rebuild from new members/upstream/downstream.
        if (edge.from === nextGroupId || edge.to === nextGroupId) return false;
        if (involvedMemberIds.includes(edge.from) || involvedMemberIds.includes(edge.to)) return false;
        return true;
      }),
    ...upstreamIds.map((from) => ({ from, to: nextGroupId, when: null as string | null })),
    ...downstreamIds.map((to) => ({ from: nextGroupId, to, when: null as string | null })),
    ...removedMemberIds.flatMap((memberId) => [
      ...upstreamIds.map((from) => ({ from, to: memberId, when: null as string | null })),
      ...downstreamIds.map((to) => ({ from: memberId, to, when: null as string | null })),
    ]),
  ]);

  const nextGroups = materializeParallelGroups(workflow, nextNodes, nextEdges, [
    ...keptGroupIds,
    {
      id: nextGroupId,
      type: "parallel",
      members: memberIds,
      joinPolicy,
    },
  ]);

  return {
    ...workflow,
    nodes: nextNodes,
    edges: nextEdges,
    groups: nextGroups,
  };
};

export const getCommonUpstreamIdsForGroup = (workflow: WorkflowDefinition, groupId: string, memberIds: string[]) => {
  const groupIncoming = workflow.edges.filter((edge) => edge.to === groupId).map((edge) => edge.from);
  if (groupIncoming.length > 0) {
    return [...new Set(groupIncoming)];
  }
  if (memberIds.length === 0) return [] as string[];
  const incomingSets = memberIds.map(
    (memberId) =>
      new Set(
        workflow.edges
          .filter((edge) => edge.to === memberId && edge.when === null && !memberIds.includes(edge.from))
          .map((edge) => edge.from),
      ),
  );
  const [first, ...rest] = incomingSets;
  return [...first].filter((candidate) => rest.every((set) => set.has(candidate)));
};

export const getCommonDownstreamIdsForGroup = (workflow: WorkflowDefinition, groupId: string, memberIds: string[]) => {
  const groupOutgoing = workflow.edges
    .filter((edge) => edge.from === groupId && edge.when === null)
    .map((edge) => edge.to);
  if (groupOutgoing.length > 0) {
    return [...new Set(groupOutgoing)];
  }
  if (memberIds.length === 0) return [] as string[];
  const outgoingSets = memberIds.map(
    (memberId) =>
      new Set(
        workflow.edges
          .filter((edge) => edge.from === memberId && edge.when === null && !memberIds.includes(edge.to))
          .map((edge) => edge.to),
      ),
  );
  const [first, ...rest] = outgoingSets;
  return [...first].filter((candidate) => rest.every((set) => set.has(candidate)));
};

export const getDisallowedDependencyIdsForNode = (workflow: WorkflowDefinition, nodeId: string) => {
  const disallowed = new Set<string>([nodeId]);
  const node = workflow.nodes.find((entry) => entry.id === nodeId) ?? null;
  const groupId = (node?.parallelGroupId ?? "").trim();
  if (!groupId) return disallowed;

  const group = getInferredParallelGroups(workflow).find((entry) => entry.id === groupId) ?? null;
  if (!group) return disallowed;

  disallowed.add(groupId);
  for (const memberId of group.members) {
    if (memberId !== nodeId) disallowed.add(memberId);
  }
  for (const edge of workflow.edges) {
    if (edge.to !== groupId) continue;
    disallowed.add(edge.from);
  }
  return disallowed;
};

export const buildTemplateNodesFromWorkflow = (
  workflow: WorkflowDefinition | null,
  pipeline: PipelineNode[],
): PipelineTemplateNode[] => {
  if (workflow && workflow.nodes.length > 0) {
    const pipelineById = new Map(pipeline.map((node) => [node.id, node]));
    return workflow.nodes.map((node) => {
      const fallback = pipelineById.get(node.id);
      return {
        id: node.id,
        title: node.name ?? fallback?.title ?? node.id,
        executor: node.executor ??
          fallback?.executor ?? {
            agentId: "operator-main",
            role: "operator",
            fallbackAgentId: null,
            sessionId: null,
          },
        instruction: node.instruction ?? fallback?.instruction ?? "",
        outputSpec: node.outputSpec ?? fallback?.outputSpec ?? { type: "generic.v1", schemaVersion: 1 },
        dependsOn: dependsOnFromWorkflow(workflow, node.id),
        allowReject: node.allowReject ?? fallback?.allowReject ?? false,
        maxRejectCount: node.maxRejectCount ?? fallback?.maxRejectCount ?? 3,
      };
    });
  }

  return pipeline.map((node) => ({
    id: node.id,
    title: node.title,
    executor: node.executor,
    instruction: node.instruction,
    outputSpec: node.outputSpec,
    dependsOn: node.dependsOn,
    allowReject: node.allowReject,
    maxRejectCount: node.maxRejectCount,
  }));
};

export const insertWorkflowNodeByDependencies = (
  workflow: WorkflowDefinition,
  nextNode: WorkflowDefinition["nodes"][number],
  dependsOn: string[],
) => {
  const targetLane = nextNode.lane === "branch" ? "branch" : "main";
  const inferredGroups = getInferredParallelGroups(workflow);
  const nodeIndexById = new Map(workflow.nodes.map((node, index) => [node.id, index]));
  const groupAnchorIndexById = new Map(
    inferredGroups.map((group) => [
      group.id,
      Math.max(...group.members.map((memberId) => nodeIndexById.get(memberId) ?? -1)),
    ]),
  );

  const resolveEntityAnchorIndex = (entityId: string) => {
    const groupAnchorIndex = groupAnchorIndexById.get(entityId);
    if (typeof groupAnchorIndex === "number" && groupAnchorIndex >= 0) {
      return groupAnchorIndex;
    }
    return nodeIndexById.get(entityId) ?? -1;
  };

  const firstLaneIndex = workflow.nodes.findIndex(
    (node) => (node.lane === "branch" ? "branch" : "main") === targetLane,
  );
  const normalizedDependsOn = Array.from(new Set(dependsOn.map((item) => item.trim()).filter(Boolean)));
  const insertIndex =
    normalizedDependsOn.length === 0
      ? firstLaneIndex >= 0
        ? firstLaneIndex
        : workflow.nodes.length
      : Math.max(...normalizedDependsOn.map(resolveEntityAnchorIndex)) + 1;

  const nextNodes = [...workflow.nodes];
  // Insert new node after the "last upstream dependency";
  // this way the DAG visual order matches the dependency choices made in the "add node" panel.
  nextNodes.splice(Math.max(0, Math.min(insertIndex, workflow.nodes.length)), 0, nextNode);
  return nextNodes;
};

const extractEventField = (text: string) => {
  const matched = text.match(/\bevent:[^\s,)\]]+/i);
  return matched?.[0] ?? "";
};

export const buildAgentCards = (
  agents: AgentItem[],
  pipeline: PipelineNode[],
  timeline: TimelineItem[],
  agentOutputById: Record<string, { runId: string; content: string; updatedAt: number }>,
) => {
  const timelineBusyCounts = (() => {
    const counts: Record<string, number> = {};
    const started = /Agent\s+([^\s]+)\s+started/;
    const finished = /Agent\s+([^\s]+)\s+finished/;
    for (const item of [...timeline].reverse()) {
      const text = item.text ?? "";
      const startMatch = text.match(started);
      if (startMatch) {
        const agentId = startMatch[1];
        counts[agentId] = (counts[agentId] ?? 0) + 1;
        continue;
      }
      const endMatch = text.match(finished);
      if (endMatch) {
        const agentId = endMatch[1];
        const current = counts[agentId] ?? 0;
        if (current <= 1) {
          delete counts[agentId];
        } else {
          counts[agentId] = current - 1;
        }
      }
    }
    return counts;
  })();

  return agents.map((agent) => {
    const ownedNodes = pipeline.filter((node) => node.executor.agentId === agent.id);
    const busy = (timelineBusyCounts[agent.id] ?? 0) > 0;
    const lastAgentEvent =
      timeline.find((item) => item.text.includes(`Agent ${agent.id} `) || item.text.includes(`agent:${agent.id}`))
        ?.text ?? "";
    const lastAgentEventField = extractEventField(lastAgentEvent);
    const output = agentOutputById[agent.id];
    const lastNode = ownedNodes
      .filter((node) => node.status === "success" || node.status === "failed")
      .sort((a, b) => {
        const aTime = Date.parse(a.finishedAt ?? "") || 0;
        const bTime = Date.parse(b.finishedAt ?? "") || 0;
        return bTime - aTime;
      })[0];

    return {
      ...agent,
      workStatus: busy ? ("busy" as const) : ("idle" as const),
      outputRunId: output?.runId ?? null,
      outputContent: output?.content ?? "",
      outputPreview: output?.content ? `${output.content.slice(0, 72)}${output.content.length > 72 ? "..." : ""}` : "",
      eventPreview: lastAgentEventField,
      lastExecution: lastNode
        ? {
            nodeId: lastNode.id,
            nodeTitle: lastNode.title,
            status: lastNode.status === "success" ? "success" : "failed",
            finishedAt: lastNode.finishedAt,
          }
        : null,
    };
  });
};

export const hasPipelineExecution = (pipeline: PipelineNode[], isRunning: boolean) =>
  isRunning ||
  pipeline.some(
    (node) =>
      node.status === "running" ||
      node.status === "success" ||
      node.status === "failed" ||
      (node.attempt ?? 0) > 0 ||
      Boolean(node.startedAt) ||
      Boolean(node.finishedAt),
  );

const isApiErrorLike = (value: unknown): value is ApiError => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { status?: unknown };
  return typeof candidate.status === "number";
};

export const getApiErrorMessage = (error: unknown) =>
  isApiErrorLike(error)
    ? String(
        (() => {
          const body = ((error as { body?: unknown }).body as { error?: string; detail?: string } | null) ?? null;
          if (body?.error && body?.detail) return `${body.error}: ${body.detail}`;
          return body?.error ?? `HTTP ${(error as { status: number }).status}`;
        })(),
      )
    : error instanceof Error
      ? error.message
      : "unknown_error";

