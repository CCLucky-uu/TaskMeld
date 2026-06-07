import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AgentItem, fetchAgents } from "../../../entities/agent";
import { GatewayStatus } from "../../../entities/gateway";
import {
  createPipeline as createPipelineReq,
  deletePipeline as deletePipelineReq,
  fetchPipelineList,
  fetchWorkflowDefinition,
  ItemBatchRunState,
  pipelineManualTick,
  PipelineId,
  PipelineListItem,
  PipelineNode,
  NodeExecutor,
  NodeItemRun,
  PipelineTemplateNode,
  WorkflowNode,
  WorkflowDefinition,
  WorkflowGroup,
  GroupItemRun,
  GroupRun,
  WorkflowRemoteBatchPlugin,
  WorkflowPlugins,
  WorkflowSchedulerState,
  saveWorkflowDefinition as saveWorkflowDefinitionReq,
  renamePipeline as renamePipelineReq,
  setPipelineSchedulerMode,
  startRemoteBatchRun,
  startPipelineRun as startPipelineRunReq,
  stopPipelineRun as stopPipelineRunReq,
  stopBatchRun as stopBatchRunReq,
  togglePipelineScheduler,
} from "../../../entities/pipeline";
import { fetchSessions, SessionItem } from "../../../entities/session";
import { TimelineItem } from "../../../entities/timeline";
import { NavKey } from "../../../widgets/nav-panel/model/navItem";
import { onWsEvent } from "../../../shared/ws-client";
import { dispatchGatewayWsEvent } from "../../../shared/realtime/gateway-events";
import { useNodeRetryFeature } from "../../../features/node-retry";
import { useSessionCreateFeature } from "../../../features/session-create";
import { useSessionSendFeature } from "../../../features/session-send";
import {
  buildAgentCards,
  buildTemplateNodesFromWorkflow,
  dedupeEdges,
  getApiErrorMessage,
  getCommonDownstreamIdsForGroup,
  getCommonUpstreamIdsForGroup,
  getDisallowedDependencyIdsForNode,
  getInferredParallelGroups,
  getParallelGroupMembers,
  hasPipelineExecution as computeHasPipelineExecution,
  materializeParallelGroups,
  insertWorkflowNodeByDependencies,
  moveWorkflowNodeWithinLane,
  reorderWorkflowNodeWithinLane,
  updateParallelGroupInWorkflow,
  validateWorkflowBeforeSave,
} from "./controlPlaneUtils";
import { buildWorkflowAfterNodeDelete } from "./workflowEditUtils";
import { useControlPlaneDraftState } from "./useControlPlaneDraftState";

type DerivedItemKeyMeta = {
  parentItemKey: string;
  splitNodeId: string;
  route: string;
};

type PipelineViewState = {
  runId: string;
  pipeline: PipelineNode[];
  workflow: WorkflowDefinition | null;
  schedulerState: WorkflowSchedulerState | null;
  pipelineItems: NodeItemRun[];
  pipelineGroups: GroupRun[];
  pipelineGroupItems: GroupItemRun[];
  batchRunState: ItemBatchRunState | null;
  isRunning: boolean;
};

const DEFAULT_REMOTE_BATCH_PLUGIN: WorkflowRemoteBatchPlugin = {
  enabled: false,
  url: "",
  startBatch: 1,
  batchSize: 5,
  sourceField: "list30",
};
const DEFAULT_REMOTE_BATCH_CONFIG = {
  enabled: false,
  url: "",
  startBatch: 1,
  batchSize: 5,
  sourceField: "list30",
};

// Helper: find a plugin instance from the plugins array by pluginId
const findPlugin = (plugins: WorkflowPlugins | undefined, pluginId: string) =>
  Array.isArray(plugins) ? plugins.find((p) => p.pluginId === pluginId) : undefined;

const getRemoteBatchConfig = (plugins: WorkflowPlugins | undefined) => {
  const inst = findPlugin(plugins, "remote-batch");
  return inst?.enabled
    ? { ...DEFAULT_REMOTE_BATCH_CONFIG, enabled: true, ...inst.config }
    : DEFAULT_REMOTE_BATCH_CONFIG;
};

const isSchedulerEnabled = (plugins: WorkflowPlugins | undefined) => {
  const inst = findPlugin(plugins, "scheduler");
  return inst ? inst.enabled : false;
};
const MAINLINE_ROUTE_VALUE = "yes";
const DEFAULT_BRANCH_ROUTE_VALUE = "no";

const normalizeRouteOptionsWithDefaults = (routes: string[]) => {
  const custom = routes.map((item) => item.trim()).filter(Boolean);
  if (custom.length === 0) return [] as string[];
  return Array.from(new Set([MAINLINE_ROUTE_VALUE, DEFAULT_BRANCH_ROUTE_VALUE, ...custom])).slice(0, 5);
};

const createEmptyPipelineViewState = (): PipelineViewState => ({
  runId: "run-241",
  pipeline: [],
  workflow: null,
  schedulerState: null,
  pipelineItems: [],
  pipelineGroups: [],
  pipelineGroupItems: [],
  batchRunState: null,
  isRunning: false,
});

const parseDerivedItemKey = (itemKey: string): DerivedItemKeyMeta | null => {
  const branchSep = itemKey.lastIndexOf("::");
  if (branchSep < 0) return null;
  const suffix = itemKey.slice(branchSep + 2);
  const routeSep = suffix.indexOf(":");
  if (routeSep <= 0 || routeSep === suffix.length - 1) return null;
  return {
    parentItemKey: itemKey.slice(0, branchSep),
    splitNodeId: suffix.slice(0, routeSep),
    route: suffix.slice(routeSep + 1),
  };
};

const collectVisibleNodeIdsForBranch = (
  workflow: WorkflowDefinition,
  splitNodeId: string,
  route: string,
): Set<string> => {
  const visibleNodeIds = new Set<string>([splitNodeId]);
  const visitedEntities = new Set<string>();
  const queue = workflow.edges
    .filter(
      (edge) =>
        edge.from === splitNodeId && (route === MAINLINE_ROUTE_VALUE ? edge.when === null : edge.when === route),
    )
    .map((edge) => edge.to);
  const groupMembersById = new Map(workflow.groups.map((group) => [group.id, group.members]));

  // Derived itemKey copies ancestor node state so branches can read upstream artifacts;
  // the run view must filter to "which nodes this branch actually reaches" to avoid misreading context copies as duplicate execution.
  while (queue.length > 0) {
    const entityId = queue.shift();
    if (!entityId || visitedEntities.has(entityId)) continue;
    visitedEntities.add(entityId);

    const groupMembers = groupMembersById.get(entityId);
    if (groupMembers) {
      for (const memberId of groupMembers) {
        visibleNodeIds.add(memberId);
        if (!visitedEntities.has(memberId)) {
          queue.push(memberId);
        }
      }
    } else {
      visibleNodeIds.add(entityId);
    }

    for (const edge of workflow.edges) {
      if (edge.from === entityId) {
        queue.push(edge.to);
      }
    }
  }

  return visibleNodeIds;
};

export function useControlPlanePage() {
  const { t } = useTranslation("common");
  const [active, setActive] = useState<NavKey>("overview");
  const [activePipelineId, setActivePipelineId] = useState<PipelineId>("");
  const [sessionModalOpen, setSessionModalOpen] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [gateway, setGateway] = useState<GatewayStatus>({
    status: "idle",
    protocol: null,
    scopes: [],
    lastError: null,
  });
  const [serverVersion, setServerVersion] = useState("-");
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [agents, setAgents] = useState<AgentItem[]>([]);
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [pipelineList, setPipelineList] = useState<PipelineListItem[]>([]);
  const [pipelineStateById, setPipelineStateById] = useState<Record<string, PipelineViewState>>({});
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [actionMessage, setActionMessage] = useState("");
  const [isBatchOperating, setIsBatchOperating] = useState(false);
  const [isCreatingPipeline, setIsCreatingPipeline] = useState(false);
  const [isDeletingPipeline, setIsDeletingPipeline] = useState(false);
  const [isRenamingPipeline, setIsRenamingPipeline] = useState(false);
  const [batchStartBatchById, setBatchStartBatchById] = useState<Record<string, string>>({});
  const [editingPipelineId, setEditingPipelineId] = useState<PipelineId | null>(null);
  const [isCreateNodeModalOpen, setIsCreateNodeModalOpen] = useState(false);
  const [deleteTargetNodeId, setDeleteTargetNodeId] = useState("");
  const [deleteTargetGroupId, setDeleteTargetGroupId] = useState("");
  const [agentOutputModalAgentId, setAgentOutputModalAgentId] = useState("");
  const [isSavingWorkflowConfig, setIsSavingWorkflowConfig] = useState(false);
  const [workflowSaveFailed, setWorkflowSaveFailed] = useState(false);
  const [isSavingGroupConfig, setIsSavingGroupConfig] = useState(false);
  const [isSavingWorkflowJson, setIsSavingWorkflowJson] = useState(false);
  const [isSavingNodeConfig, setIsSavingNodeConfig] = useState(false);
  const [isAddingNode, setIsAddingNode] = useState(false);
  const [isDeletingNode, setIsDeletingNode] = useState(false);
  const [agentOutputById, setAgentOutputById] = useState<
    Record<string, { runId: string; content: string; updatedAt: number }>
  >({});
  const assistantTextByRunAgentRef = useRef<Map<string, string>>(new Map());
  const pendingNodeSaveRef = useRef<Promise<void> | null>(null);
  const getPipelineStateSnapshot = useCallback(
    (pipelineId: PipelineId, stateById: Record<string, PipelineViewState>) =>
      stateById[pipelineId] ?? createEmptyPipelineViewState(),
    [],
  );
  const currentPipelineListRef = useRef(pipelineList);
  const activePipelineIdRef = useRef(activePipelineId);
  useEffect(() => {
    currentPipelineListRef.current = pipelineList;
  }, [pipelineList]);
  useEffect(() => {
    activePipelineIdRef.current = activePipelineId;
  }, [activePipelineId]);
  const updatePipelineState = useCallback(
    (pipelineId: PipelineId, updater: (prev: PipelineViewState) => PipelineViewState) => {
      setPipelineStateById((prev) => ({
        ...prev,
        [pipelineId]: updater(getPipelineStateSnapshot(pipelineId, prev)),
      }));
    },
    [getPipelineStateSnapshot],
  );
  const isSessionForAgent = (sessionId: string, agentId: string) => {
    const sid = sessionId.trim();
    const aid = agentId.trim();
    if (!sid || !aid) return false;
    return sid === aid || sid.startsWith(`agent:${aid}:`);
  };
  const mainSessionIdForAgent = (agentId: string) => `agent:${agentId}:main`;
  const currentPipelineState = getPipelineStateSnapshot(activePipelineId, pipelineStateById);
  const activePipelineTitle = pipelineList.find((item) => item.id === activePipelineId)?.title ?? "";
  const runId = currentPipelineState.runId;
  const pipeline = currentPipelineState.pipeline;
  const workflow = currentPipelineState.workflow;
  const schedulerState = currentPipelineState.schedulerState;
  const pipelineItems = currentPipelineState.pipelineItems;
  const pipelineGroups = currentPipelineState.pipelineGroups;
  const pipelineGroupItems = currentPipelineState.pipelineGroupItems;
  const batchRunState = currentPipelineState.batchRunState;
  const isRunning = currentPipelineState.isRunning;
  const isPipelineEditing = editingPipelineId === activePipelineId;
  const batchStartBatch =
    batchStartBatchById[activePipelineId] ||
    String(getRemoteBatchConfig(currentPipelineState.workflow?.plugins).startBatch);

  const inferredGroups = useMemo(() => (workflow ? getInferredParallelGroups(workflow) : []), [workflow]);
  const parallelGroups = useMemo(
    () =>
      inferredGroups.map((group) => ({
        id: group.id,
        members: group.members,
      })),
    [inferredGroups],
  );
  const selectedNode = useMemo(
    () => (selectedGroupId ? undefined : pipeline.find((n) => n.id === selectedNodeId)),
    [selectedNodeId, selectedGroupId, pipeline],
  );
  const selectedWorkflowNode = useMemo(
    () =>
      selectedNodeId && !selectedGroupId ? (workflow?.nodes.find((node) => node.id === selectedNodeId) ?? null) : null,
    [workflow, selectedNodeId, selectedGroupId],
  );
  const selectedGroup = useMemo(() => {
    if (!workflow || !selectedGroupId) return null;
    const existing = inferredGroups.find((group) => group.id === selectedGroupId) ?? null;
    if (!existing) return null;
    const runtimeGroup = pipelineGroups.find((group) => group.id === selectedGroupId) ?? null;
    const memberRuns = existing.members
      .map((memberId) => pipeline.find((node) => node.id === memberId))
      .filter((node): node is PipelineNode => Boolean(node));
    const runtimeItems = pipelineGroupItems.filter((item) => item.groupId === selectedGroupId);
    return {
      id: existing.id,
      members: existing.members,
      upstreams: getCommonUpstreamIdsForGroup(workflow, existing.id, existing.members),
      joinPolicy: existing.joinPolicy,
      status: runtimeGroup?.status ?? "blocked",
      artifacts: runtimeGroup?.artifacts ?? [],
      startedAt: runtimeGroup?.startedAt ?? null,
      finishedAt: runtimeGroup?.finishedAt ?? null,
      lastError: runtimeGroup?.lastError ?? null,
      memberRuns,
      itemRuns: runtimeItems,
    };
  }, [workflow, selectedGroupId, inferredGroups, pipelineGroups, pipelineGroupItems, pipeline]);
  const visiblePipelineItems = useMemo(() => {
    if (!workflow || pipelineItems.length === 0) return pipelineItems;

    const branchVisibleNodeIdsCache = new Map<string, Set<string>>();
    return pipelineItems.filter((item) => {
      const derivedMeta = parseDerivedItemKey(item.itemKey);
      if (!derivedMeta) return true;

      const cacheKey = `${derivedMeta.splitNodeId}:${derivedMeta.route}`;
      let visibleNodeIds = branchVisibleNodeIdsCache.get(cacheKey);
      if (!visibleNodeIds) {
        visibleNodeIds = collectVisibleNodeIdsForBranch(workflow, derivedMeta.splitNodeId, derivedMeta.route);
        branchVisibleNodeIdsCache.set(cacheKey, visibleNodeIds);
      }
      return visibleNodeIds.has(item.nodeId);
    });
  }, [workflow, pipelineItems]);
  const selectedRouteTargets = useMemo(() => {
    if (!workflow || !selectedNodeId) return {} as Record<string, string>;
    return workflow.edges
      .filter((edge) => edge.from === selectedNodeId && edge.when)
      .reduce<Record<string, string>>((acc, edge) => {
        if (edge.when) acc[edge.when] = edge.to;
        return acc;
      }, {});
  }, [workflow, selectedNodeId]);
  const {
    draftTitle,
    setDraftTitle,
    draftAgentId,
    setDraftAgentId: setDraftAgentIdBase,
    draftExecutorSessionId,
    setDraftExecutorSessionId,
    draftInstruction,
    setDraftInstruction,
    draftDependsOn,
    setDraftDependsOn,
    draftAllowReject,
    setDraftAllowReject,
    draftMaxRejectCount,
    setDraftMaxRejectCount,
    draftWorkflowLane,
    setDraftWorkflowLane,
    draftWorkflowRouteAllowed,
    setDraftWorkflowRouteAllowed,
    draftWorkflowRouteTargets,
    setDraftWorkflowRouteTarget,
    draftGroupId,
    setDraftGroupId,
    draftGroupMembers,
    setDraftGroupMembers,
    draftGroupUpstreams,
    setDraftGroupUpstreams,
    draftGroupJoinPolicy,
    setDraftGroupJoinPolicy,
    workflowJsonDraft,
    setWorkflowJsonDraft,
    draftCreateKind,
    setDraftCreateKind,
    draftNewNodeId,
    setDraftNewNodeId,
    draftNewNodeTitle,
    setDraftNewNodeTitle,
    draftNewNodeAgentId,
    setDraftNewNodeAgentId,
    draftNewNodeInstruction,
    setDraftNewNodeInstruction,
    draftNewNodeDependsOn,
    setDraftNewNodeDependsOn,
    draftNewGroupId,
    setDraftNewGroupId,
    draftNewGroupMembers,
    setDraftNewGroupMembers,
    draftNewGroupUpstreams,
    setDraftNewGroupUpstreams,
    draftNewGroupJoinPolicy,
    setDraftNewGroupJoinPolicy,
    hasNodeDraftChanges,
    hasWorkflowDraftChanges,
  } = useControlPlaneDraftState({
    selectedNode,
    selectedWorkflowNode,
    selectedGroup,
    selectedRouteTargets,
    workflow,
    isSessionForAgent,
  });
  const templateNodes = useMemo(() => buildTemplateNodesFromWorkflow(workflow, pipeline), [workflow, pipeline]);

  const dependencyOptions = useMemo(() => {
    if (!selectedNode || !workflow) return [] as Array<{ id: string; title: string }>;
    const disallowedIds = getDisallowedDependencyIdsForNode(workflow, selectedNode.id);
    const selectedIndex = templateNodes.findIndex((node) => node.id === selectedNode.id);
    const nodeOptions =
      selectedIndex <= 0
        ? []
        : templateNodes
            .slice(0, selectedIndex)
            .filter((node) => !disallowedIds.has(node.id))
            .map((node) => ({ id: node.id, title: node.title }));
    const groupOptions = inferredGroups
      .filter((group) => !disallowedIds.has(group.id))
      .map((group) => ({ id: group.id, title: `${t("modal:fieldLabel.group")} ${group.id}` }));
    return [...nodeOptions, ...groupOptions];
  }, [selectedNode?.id, templateNodes, workflow, inferredGroups]);
  const groupUpstreamOptions = useMemo(() => {
    const memberIds = new Set(selectedGroup?.members ?? []);
    return [
      ...templateNodes.filter((node) => !memberIds.has(node.id)).map((node) => ({ id: node.id, title: node.title })),
      ...inferredGroups
        .filter((group) => group.id !== selectedGroup?.id && !group.members.some((memberId) => memberIds.has(memberId)))
        .map((group) => ({ id: group.id, title: `${t("modal:fieldLabel.group")} ${group.id}` })),
    ];
  }, [selectedGroup?.members, selectedGroup?.id, templateNodes, inferredGroups]);
  const newGroupUpstreamOptions = useMemo(() => {
    const memberIds = new Set(draftNewGroupMembers);
    return [
      ...templateNodes.filter((node) => !memberIds.has(node.id)).map((node) => ({ id: node.id, title: node.title })),
      ...inferredGroups
        .filter((group) => !group.members.some((memberId) => memberIds.has(memberId)))
        .map((group) => ({ id: group.id, title: `${t("modal:fieldLabel.group")} ${group.id}` })),
    ];
  }, [templateNodes, draftNewGroupMembers, inferredGroups]);
  const groupMemberOptions = useMemo(
    () =>
      templateNodes.map((node) => ({
        id: node.id,
        title: node.title,
      })),
    [templateNodes],
  );
  const routeTargetOptions = useMemo(() => {
    if (!workflow || !selectedNodeId) return [] as Array<{ id: string; title: string }>;
    const inferredGroups = getInferredParallelGroups(workflow);

    const branchNodes = templateNodes.filter((node) => {
      if (node.id === selectedNodeId) return false;
      const workflowNode = workflow.nodes.find((item) => item.id === node.id);
      return workflowNode?.lane === "branch";
    });

    const options: Array<{ id: string; title: string }> = [];
    for (const group of inferredGroups) {
      const workflowNodeIds = new Set(branchNodes.map((node) => node.id));
      if (!group.members.some((memberId) => workflowNodeIds.has(memberId))) continue;
      options.push({
        id: group.id,
        title: `${t("pipeline:branchNodes")} | ${group.id} | ${group.members.join(", ")}`,
      });
    }
    for (const node of branchNodes) {
      options.push({
        id: node.id,
        title: `${t("pipeline:branchNodes")} | ${node.title} | agent:${node.executor.agentId}`,
      });
    }
    return options;
  }, [templateNodes, selectedNodeId, workflow]);

  const newNodeDependencyOptions = useMemo(
    () => [
      ...templateNodes.map((node) => ({ id: node.id, title: node.title })),
      ...inferredGroups.map((group) => ({ id: group.id, title: `${t("modal:fieldLabel.group")} ${group.id}` })),
    ],
    [templateNodes, inferredGroups],
  );
  const newGroupMemberOptions = newNodeDependencyOptions;
  const nodeSessionOptions = useMemo(() => {
    const agentId = draftAgentId.trim();
    if (!agentId) return [] as SessionItem[];
    const matched = sessions.filter((session) => isSessionForAgent(session.id, agentId));
    const mainId = mainSessionIdForAgent(agentId);
    if (!matched.some((session) => session.id === mainId)) {
      matched.unshift({ id: mainId, title: mainId });
    }
    const dedup = new Set<string>();
    return matched.filter((session) => {
      if (!session.id || dedup.has(session.id)) return false;
      dedup.add(session.id);
      return true;
    });
  }, [sessions, draftAgentId]);

  const draftExecutorSessionDisplayId = useMemo(() => {
    const agentId = draftAgentId.trim();
    const current = draftExecutorSessionId.trim();
    if (!agentId) return current;
    return current || mainSessionIdForAgent(agentId);
  }, [draftAgentId, draftExecutorSessionId]);

  const setDraftAgentIdWithSessionSync = useCallback(
    (nextAgentId: string) => {
      const normalizedAgentId = nextAgentId.trim();
      setDraftAgentIdBase(normalizedAgentId);
      setDraftExecutorSessionId((current) => {
        const currentId = current.trim();
        if (!normalizedAgentId || !currentId) return "";
        return isSessionForAgent(currentId, normalizedAgentId) ? currentId : "";
      });
    },
    [setDraftAgentIdBase, setDraftExecutorSessionId],
  );

  const filteredSessionsForSelectedAgent = useMemo(() => {
    if (!selectedAgentId) return sessions;
    const matched = sessions.filter((session) => isSessionForAgent(session.id, selectedAgentId));
    if (matched.length > 0) return matched;
    return [
      {
        id: `agent:${selectedAgentId}:main`,
        title: `agent:${selectedAgentId}:main`,
      },
    ] as SessionItem[];
  }, [sessions, selectedAgentId]);

  const agentCards = useMemo(
    () => buildAgentCards(agents, pipeline, timeline, agentOutputById),
    [agents, pipeline, timeline, agentOutputById],
  );

  const hasPipelineExecution = useMemo(() => computeHasPipelineExecution(pipeline, isRunning), [isRunning, pipeline]);

  const getPipelineRemoteBatchPlugin = useCallback(
    (pipelineId: PipelineId): WorkflowRemoteBatchPlugin =>
      getRemoteBatchConfig(getPipelineStateSnapshot(pipelineId, pipelineStateById).workflow?.plugins),
    [getPipelineStateSnapshot, pipelineStateById],
  );

  const getPipelinePlugins = useCallback(
    (pipelineId: PipelineId): WorkflowPlugins =>
      getPipelineStateSnapshot(pipelineId, pipelineStateById).workflow?.plugins ?? [],
    [getPipelineStateSnapshot, pipelineStateById],
  );

  const getPipelineSchedulerPlugin = useCallback(
    (pipelineId: PipelineId) => {
      const inst = findPlugin(getPipelinePlugins(pipelineId), "scheduler");
      return { enabled: inst ? inst.enabled : false };
    },
    [getPipelinePlugins],
  );

  const load = useCallback(async () => {
    const startedAt = performance.now();
    const [pipelineListResult, agentsResult, sessionsResult] = await Promise.allSettled([
      fetchPipelineList(),
      fetchAgents(),
      fetchSessions(),
    ]);
    const nextPipelineList =
      pipelineListResult.status === "fulfilled" && pipelineListResult.value.length > 0
        ? pipelineListResult.value
        : currentPipelineListRef.current;
    const pipelineIds = nextPipelineList.map((item) => item.id);
    const workflowPayloads = await Promise.allSettled(
      pipelineIds.map((pipelineId) => fetchWorkflowDefinition(pipelineId)),
    );

    setLatencyMs(Math.round(performance.now() - startedAt));
    if (pipelineListResult.status === "fulfilled") {
      setPipelineList(nextPipelineList);
    }
    if (agentsResult.status === "fulfilled") {
      setAgents(agentsResult.value);
      setDraftNewNodeAgentId((current) => current || agentsResult.value[0]?.id || "operator-main");
    }
    if (sessionsResult.status === "fulfilled") {
      setSessions(sessionsResult.value);
    }
    setPipelineStateById((prev) => {
      const nextState: Record<string, PipelineViewState> = {};
      for (let index = 0; index < pipelineIds.length; index += 1) {
        const pipelineId = pipelineIds[index]!;
        const workflowEntry = workflowPayloads[index] as PromiseSettledResult<
          Awaited<ReturnType<typeof fetchWorkflowDefinition>>
        >;
        const previousState = getPipelineStateSnapshot(pipelineId, prev);
        const workflowValue = workflowEntry?.status === "fulfilled" ? workflowEntry.value : previousState.workflow;
        nextState[pipelineId] = {
          ...previousState,
          workflow: workflowValue,
        };
      }
      return nextState;
    });
    setBatchStartBatchById((prev) => {
      const next: Record<string, string> = {};
      for (let index = 0; index < pipelineIds.length; index += 1) {
        const workflowEntry = workflowPayloads[index] as PromiseSettledResult<
          Awaited<ReturnType<typeof fetchWorkflowDefinition>>
        >;
        const pipelineId = pipelineIds[index]!;
        const current = prev[pipelineId]?.trim();
        next[pipelineId] =
          current ||
          (workflowEntry?.status === "fulfilled" && workflowEntry.value
            ? String(getRemoteBatchConfig(workflowEntry.value.plugins).startBatch)
            : "");
      }
      return next;
    });

    if (nextPipelineList.length > 0) {
      setActivePipelineId((current) =>
        nextPipelineList.some((item) => item.id === current) ? current : nextPipelineList[0]!.id,
      );
      setEditingPipelineId((current) =>
        current && nextPipelineList.some((item) => item.id === current) ? current : null,
      );
    } else {
      setActivePipelineId("");
      setEditingPipelineId(null);
      setSelectedNodeId("");
      setSelectedGroupId("");
    }

    if (
      [pipelineListResult, agentsResult, sessionsResult, ...workflowPayloads].some(
        (entry) => entry.status === "rejected",
      )
    ) {
      setActionMessage((current) => current || t("actionMessage.partialLoadFailed"));
    }
  }, [getPipelineStateSnapshot, setDraftNewNodeAgentId]);

  const refresh = useCallback(async () => {
    const [pipelineListResult, agentsResult, sessionsResult] = await Promise.allSettled([
      fetchPipelineList(),
      fetchAgents(),
      fetchSessions(),
    ]);
    const nextPipelineList =
      pipelineListResult.status === "fulfilled" && pipelineListResult.value.length > 0
        ? pipelineListResult.value
        : currentPipelineListRef.current;

    if (pipelineListResult.status === "fulfilled") {
      setPipelineList(nextPipelineList);
    }
    if (agentsResult.status === "fulfilled") {
      setAgents(agentsResult.value);
      setDraftNewNodeAgentId((current) => current || agentsResult.value[0]?.id || "operator-main");
    }
    if (sessionsResult.status === "fulfilled") {
      setSessions(sessionsResult.value);
    }

    if (nextPipelineList.length > 0) {
      setActivePipelineId((current) =>
        nextPipelineList.some((item) => item.id === current) ? current : nextPipelineList[0]!.id,
      );
      setEditingPipelineId((current) =>
        current && nextPipelineList.some((item) => item.id === current) ? current : null,
      );
    } else {
      setActivePipelineId("");
      setEditingPipelineId(null);
      setSelectedNodeId("");
      setSelectedGroupId("");
    }
  }, [setDraftNewNodeAgentId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (pipelineList.length === 0) {
      if (activePipelineId) setActivePipelineId("");
      if (editingPipelineId) setEditingPipelineId(null);
      if (selectedNodeId) setSelectedNodeId("");
      if (selectedGroupId) setSelectedGroupId("");
      return;
    }
    if (!pipelineList.some((item) => item.id === activePipelineId)) {
      setActivePipelineId(pipelineList[0]!.id);
      setSelectedNodeId("");
      setSelectedGroupId("");
    }
    if (editingPipelineId && !pipelineList.some((item) => item.id === editingPipelineId)) {
      setEditingPipelineId(null);
    }
  }, [activePipelineId, editingPipelineId, pipelineList, selectedGroupId, selectedNodeId]);

  useEffect(() => {
    const disconnect = onWsEvent((event) => {
      dispatchGatewayWsEvent(event, {
        bootstrap: (boot) => {
          if (!boot) return;
          if (boot.status) setGateway(boot.status);
          if (boot.pipelines) {
            const pipelineEntries = Object.entries(boot.pipelines);
            // bootstrap is the server's current full snapshot; must replace wholesale so deleted pipelines don't leak back into the list from stale local state after reconnect.
            setPipelineList(pipelineEntries.map(([pipelineId, entry]) => ({ id: pipelineId, title: entry.title })));
            setPipelineStateById((prev) => {
              const next: Record<string, PipelineViewState> = {};
              for (const [pipelineId, entry] of pipelineEntries) {
                const run = entry.run;
                const previousState = getPipelineStateSnapshot(pipelineId, prev);
                next[pipelineId] = {
                  ...previousState,
                  runId: entry.runId ?? run?.id ?? previousState.runId,
                  pipeline: entry.pipeline ?? run?.nodes ?? previousState.pipeline,
                  pipelineGroups: Array.isArray(run?.groups) ? run.groups : previousState.pipelineGroups,
                  pipelineGroupItems: Array.isArray(run?.groupItemRuns)
                    ? run.groupItemRuns
                    : previousState.pipelineGroupItems,
                  schedulerState: entry.scheduler ?? previousState.schedulerState,
                  pipelineItems: Array.isArray(run?.itemRuns) ? run.itemRuns : previousState.pipelineItems,
                  batchRunState: entry.batchRunState !== undefined ? entry.batchRunState : previousState.batchRunState,
                };
              }
              return next;
            });
          } else {
            const fallbackPipelineId = currentPipelineListRef.current[0]?.id ?? activePipelineIdRef.current ?? "A";
            if (boot.run) {
              updatePipelineState(fallbackPipelineId, (prev) => ({
                ...prev,
                runId: boot.run?.id ?? prev.runId,
                pipeline: boot.run?.nodes ?? prev.pipeline,
                pipelineGroups: Array.isArray(boot.run?.groups) ? boot.run.groups : prev.pipelineGroups,
                pipelineGroupItems: Array.isArray(boot.run?.groupItemRuns)
                  ? boot.run.groupItemRuns
                  : prev.pipelineGroupItems,
              }));
            }
            if (boot.pipeline) {
              updatePipelineState(fallbackPipelineId, (prev) => ({
                ...prev,
                pipeline: boot.pipeline ?? prev.pipeline,
              }));
            }
            if (boot.runId)
              updatePipelineState(fallbackPipelineId, (prev) => ({ ...prev, runId: boot.runId ?? prev.runId }));
            if (boot.scheduler) {
              updatePipelineState(fallbackPipelineId, (prev) => ({
                ...prev,
                schedulerState: boot.scheduler ?? prev.schedulerState,
              }));
            }
          }
          if (boot.timeline) setTimeline(boot.timeline);
          setServerVersion(boot.hello?.server?.version ?? "-");
        },
        gatewayStatus: (status) => {
          if (status) setGateway(status);
        },
        gatewayReady: (ready) => {
          setServerVersion(ready?.server?.version ?? "-");
        },
        gatewayFrame: (frame) => {
          if (!frame || frame.type !== "event" || frame.event !== "agent") return;
          const payload = frame.payload as Record<string, unknown> | undefined;
          if (!payload) return;
          const sessionKey = typeof payload.sessionKey === "string" ? payload.sessionKey.trim() : "";
          const runId = typeof payload.runId === "string" ? payload.runId.trim() : "";
          if (!sessionKey || !runId) return;

          const match = sessionKey.match(/^agent:([^:]+):/i);
          if (!match) return;
          const agentId = match[1];
          const stream = typeof payload.stream === "string" ? payload.stream : "";
          const data = (payload.data ?? {}) as Record<string, unknown>;
          const key = `${runId}::${agentId}`;

          if (stream === "assistant") {
            const text = typeof data.text === "string" ? data.text : "";
            if (!text) return;
            assistantTextByRunAgentRef.current.set(key, text);
            return;
          }

          if (stream === "lifecycle") {
            const phase = typeof data.phase === "string" ? data.phase : "";
            if (phase === "start") {
              assistantTextByRunAgentRef.current.delete(key);
              return;
            }
            if (phase === "end") {
              const finalContent = assistantTextByRunAgentRef.current.get(key) ?? "";
              if (!finalContent.trim()) return;
              setAgentOutputById((prev) => ({
                ...prev,
                [agentId]: {
                  runId,
                  content: finalContent,
                  updatedAt: Date.now(),
                },
              }));
            }
          }
        },
        pipelineUpdated: (payload) => {
          if (!payload) return;
          const pipelineId =
            payload.pipelineId ?? currentPipelineListRef.current[0]?.id ?? activePipelineIdRef.current ?? "A";
          if (payload.scheduler) {
            updatePipelineState(pipelineId, (prev) => ({
              ...prev,
              schedulerState: payload.scheduler ?? prev.schedulerState,
            }));
          }
          if (payload.batchRunState !== undefined) {
            updatePipelineState(pipelineId, (prev) => ({
              ...prev,
              batchRunState: payload.batchRunState ?? prev.batchRunState,
            }));
          }
          if (payload.run) {
            updatePipelineState(pipelineId, (prev) => ({
              ...prev,
              runId: payload.run?.id ?? prev.runId,
              pipeline: payload.run?.nodes ?? prev.pipeline,
              pipelineGroups: Array.isArray(payload.run?.groups) ? payload.run.groups : prev.pipelineGroups,
              pipelineGroupItems: Array.isArray(payload.run?.groupItemRuns)
                ? payload.run.groupItemRuns
                : prev.pipelineGroupItems,
              pipelineItems: Array.isArray(payload.run?.itemRuns) ? payload.run.itemRuns : prev.pipelineItems,
            }));
            return;
          }
          if (payload.runId)
            updatePipelineState(pipelineId, (prev) => ({ ...prev, runId: payload.runId ?? prev.runId }));
          if (Array.isArray(payload.nodes))
            updatePipelineState(pipelineId, (prev) => ({ ...prev, pipeline: payload.nodes ?? prev.pipeline }));
        },
        timelineUpdated: (payload) => {
          if (payload?.item) {
            const item = payload.item;
            setTimeline((prev) => {
              const next = [item, ...prev];
              if (next.length > 200) next.length = 200;
              return next;
            });
          }
        },
      });
    });

    return () => disconnect();
  }, [getPipelineStateSnapshot, updatePipelineState]);

  const {
    selectedSessionId,
    setSelectedSessionId,
    sessionMessage,
    setSessionMessage,
    sendMode,
    setSendMode,
    lastSendInfo,
    ensureDefaultSession,
    selectPreferredSessionForAgent,
    sendSessionMessage,
  } = useSessionSendFeature({ reload: refresh });

  const { sessionCreatePayload, setSessionCreatePayload, createSession } = useSessionCreateFeature({ reload: refresh });
  const { retryNode } = useNodeRetryFeature();

  useEffect(() => {
    ensureDefaultSession(sessions);
  }, [sessions]);

  const openSessionModalForAgent = (agentId: string) => {
    setSelectedAgentId(agentId);
    selectPreferredSessionForAgent(
      agentId,
      sessions.filter((session) => isSessionForAgent(session.id, agentId)),
    );
    setSessionModalOpen(true);
  };

  const selectNodeInPipeline = (pipelineId: PipelineId, nodeId: string) => {
    setActivePipelineId(pipelineId);
    setSelectedGroupId("");
    setSelectedNodeId(nodeId);
  };

  const selectGroupInPipeline = (pipelineId: PipelineId, groupId: string) => {
    setActivePipelineId(pipelineId);
    setSelectedNodeId("");
    setSelectedGroupId(groupId);
  };

  const setPipelineEditing = (pipelineId: PipelineId, editing: boolean) => {
    setActivePipelineId(pipelineId);
    setEditingPipelineId((current) => (editing ? pipelineId : current === pipelineId ? null : current));
  };

  const setBatchStartBatch = (pipelineId: PipelineId, value: string) => {
    setBatchStartBatchById((prev) => ({
      ...prev,
      [pipelineId]: value,
    }));
  };

  const savePipelinePlugins = useCallback(
    async (pipelineId: PipelineId, plugins: WorkflowPlugins) => {
      const currentWorkflow = getPipelineStateSnapshot(pipelineId, pipelineStateById).workflow;
      if (!currentWorkflow) {
        setActionMessage(t("actionMessage.pluginSaveFailedNoWorkflow"));
        return;
      }
      const nextWorkflow: WorkflowDefinition = {
        ...currentWorkflow,
        plugins,
        // When the scheduler plugin is disabled, also disable scheduler.enabled to prevent background auto-scheduling after the UI is turned off.
        scheduler: isSchedulerEnabled(plugins)
          ? currentWorkflow.scheduler
          : {
              ...currentWorkflow.scheduler,
              enabled: false,
            },
      };
      try {
        await saveWorkflowDefinitionReq(pipelineId, nextWorkflow);
        updatePipelineState(pipelineId, (prev) => ({ ...prev, workflow: nextWorkflow }));
        setBatchStartBatchById((prev) => ({
          ...prev,
          [pipelineId]: prev[pipelineId]?.trim() ? prev[pipelineId] : String(getRemoteBatchConfig(plugins).startBatch),
        }));
      } catch (error) {
        const message = getApiErrorMessage(error);
        setActionMessage(t("actionMessage.pluginSaveFailed", { message }));
      }
    },
    [getPipelineStateSnapshot, pipelineStateById],
  );

  const createPipeline = useCallback(
    async (input: { id: string; title?: string; cloneFrom?: string }) => {
      const pipelineId = input.id.trim();
      const title = input.title?.trim() ?? "";
      const cloneFrom = input.cloneFrom?.trim() || undefined;
      if (!pipelineId) {
        return { ok: false as const, message: t("actionMessage.idEmpty", { field: "pipelineId" }) };
      }

      setIsCreatingPipeline(true);
      setActionMessage("");
      try {
        const result = await createPipelineReq({ id: pipelineId, title: title || undefined, cloneFrom });
        const createdPipelineId = result.item?.id ?? pipelineId;
        await refresh();
        setActivePipelineId(createdPipelineId);
        setSelectedNodeId("");
        setSelectedGroupId("");
        setEditingPipelineId(null);
        setActionMessage(t("actionMessage.pipelineCreated", { id: createdPipelineId }));
        return { ok: true as const, pipelineId: createdPipelineId };
      } catch (error) {
        const message = getApiErrorMessage(error);
        setActionMessage(t("actionMessage.createPipelineFailed", { message }));
        return { ok: false as const, message };
      } finally {
        setIsCreatingPipeline(false);
      }
    },
    [refresh],
  );

  const renamePipeline = useCallback(
    async (pipelineId: PipelineId, title: string) => {
      const normalizedPipelineId = pipelineId.trim();
      const normalizedTitle = title.trim();
      if (!normalizedPipelineId) {
        return { ok: false as const, message: t("actionMessage.idEmpty", { field: "pipelineId" }) };
      }
      if (!normalizedTitle) {
        return { ok: false as const, message: t("actionMessage.pipelineTitleEmpty") };
      }

      setIsRenamingPipeline(true);
      setActionMessage("");
      try {
        await renamePipelineReq(normalizedPipelineId, normalizedTitle);
        await refresh();
        setActionMessage(t("actionMessage.pipelineTitleUpdated", { id: normalizedPipelineId }));
        return { ok: true as const, pipelineId: normalizedPipelineId };
      } catch (error) {
        const message = getApiErrorMessage(error);
        setActionMessage(t("actionMessage.renamePipelineFailed", { message }));
        return { ok: false as const, message };
      } finally {
        setIsRenamingPipeline(false);
      }
    },
    [refresh],
  );

  const deletePipeline = useCallback(
    async (pipelineId: PipelineId) => {
      if (!pipelineId.trim()) {
        return { ok: false as const, message: t("actionMessage.idEmpty", { field: "pipelineId" }) };
      }

      setIsDeletingPipeline(true);
      setActionMessage("");
      try {
        await deletePipelineReq(pipelineId);
        setEditingPipelineId((current) => (current === pipelineId ? null : current));
        if (activePipelineIdRef.current === pipelineId) {
          setSelectedNodeId("");
          setSelectedGroupId("");
        }
        await refresh();
        setActionMessage(t("actionMessage.pipelineDeleted", { id: pipelineId }));
        return { ok: true as const, pipelineId };
      } catch (error) {
        const message = getApiErrorMessage(error);
        setActionMessage(t("actionMessage.deletePipelineFailed", { message }));
        return { ok: false as const, message };
      } finally {
        setIsDeletingPipeline(false);
      }
    },
    [refresh],
  );

  useEffect(() => {
    if (!sessionModalOpen || !selectedAgentId) return;
    if (filteredSessionsForSelectedAgent.length === 0) return;
    const hasCurrent = filteredSessionsForSelectedAgent.some((session) => session.id === selectedSessionId);
    if (!hasCurrent) {
      setSelectedSessionId(filteredSessionsForSelectedAgent[0].id);
    }
  }, [sessionModalOpen, selectedAgentId, filteredSessionsForSelectedAgent, selectedSessionId, setSelectedSessionId]);

  const startPipelineRun = async (pipelineId: PipelineId = activePipelineId) => {
    if (pendingNodeSaveRef.current) {
      await pendingNodeSaveRef.current;
    } else if (pipelineId === activePipelineId && selectedNode && hasNodeDraftChanges) {
      await saveSelectedNodeConfig({ silentSuccess: true });
    }
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

  const toggleScheduler = async (enabled: boolean, pipelineId: PipelineId = activePipelineId) => {
    await togglePipelineScheduler(pipelineId, enabled);
    await refresh();
  };

  const switchSchedulerMode = async (mode: "auto" | "manual", pipelineId: PipelineId = activePipelineId) => {
    await setPipelineSchedulerMode(pipelineId, mode);
    await refresh();
  };

  const manualTick = async (pipelineId: PipelineId = activePipelineId) => {
    await pipelineManualTick(pipelineId);
    await refresh();
  };

  const startRemoteKeywordBatchRun = async (pipelineId: PipelineId = activePipelineId) => {
    setIsBatchOperating(true);
    setActionMessage("");
    try {
      const pluginState = getPipelineRemoteBatchPlugin(pipelineId);
      const normalizedStartBatch = Math.max(
        1,
        Math.trunc(
          Number(batchStartBatchById[pipelineId] || String(pluginState.startBatch || 1)) || pluginState.startBatch || 1,
        ),
      );
      const remoteUrl = pluginState.url.trim();
      // Remote keyword pool defaults to batch size 5 to avoid excessive per-batch processing time.
      const result = await startRemoteBatchRun(pipelineId, {
        batchSize: pluginState.batchSize,
        startBatch: normalizedStartBatch,
        url: remoteUrl || undefined,
      });
      if (result.state) {
        updatePipelineState(pipelineId, (prev) => ({ ...prev, batchRunState: result.state ?? prev.batchRunState }));
      }
      setActionMessage(
        t("actionMessage.remoteBatchStarted", {
          startBatch: normalizedStartBatch,
          totalItems: result.totalFetched ?? result.state?.totalItems ?? 0,
          batchSize: result.state?.batchSize ?? 5,
        }),
      );
      await refresh();
    } catch (error) {
      const message = getApiErrorMessage(error);
      setActionMessage(t("actionMessage.remoteBatchStartFailed", { message }));
    } finally {
      setIsBatchOperating(false);
    }
  };

  const stopKeywordBatchRun = async (pipelineId: PipelineId = activePipelineId) => {
    setIsBatchOperating(true);
    try {
      const result = await stopBatchRunReq(pipelineId);
      if (result.state) {
        updatePipelineState(pipelineId, (prev) => ({ ...prev, batchRunState: result.state ?? prev.batchRunState }));
      }
      setActionMessage(t("actionMessage.batchStopRequested"));
      await refresh();
    } catch (error) {
      const message = getApiErrorMessage(error);
      setActionMessage(t("actionMessage.batchStopFailed", { message }));
    } finally {
      setIsBatchOperating(false);
    }
  };

  const stopPipelineRun = async (pipelineId: PipelineId = activePipelineId) => {
    setIsBatchOperating(true);
    setActionMessage("");
    try {
      const result = await stopPipelineRunReq(pipelineId);
      if (result.status?.batchRun) {
        updatePipelineState(pipelineId, (prev) => ({
          ...prev,
          batchRunState: result.status?.batchRun ?? prev.batchRunState,
        }));
      }
      updatePipelineState(pipelineId, (prev) => ({ ...prev, isRunning: false }));
      setActionMessage(
        result.mode === "remote_batch"
          ? t("actionMessage.batchStopNodeRequested")
          : t("actionMessage.pipelineStopRequested"),
      );
      await refresh();
    } catch (error) {
      const message = getApiErrorMessage(error);
      setActionMessage(t("actionMessage.stopPipelineFailed", { message }));
    } finally {
      setIsBatchOperating(false);
    }
  };

  const buildNextWorkflowForSelectedNode = ({
    includeNodeConfig,
    includeWorkflowConfig,
  }: {
    includeNodeConfig: boolean;
    includeWorkflowConfig: boolean;
  }): { ok: true; workflow: WorkflowDefinition } | { ok: false; error: string } => {
    if (!workflow || !selectedNode) {
      return { ok: false, error: t("actionMessage.nodeSaveFailedNoWorkflow") };
    }
    const target = workflow.nodes.find((node) => node.id === selectedNode.id);
    if (!target) {
      return { ok: false, error: t("actionMessage.nodeSaveFailedNodeNotFound", { nodeId: selectedNode.id }) };
    }

    const title = draftTitle.trim();
    const agentId = draftAgentId.trim();
    const rawSessionId = draftExecutorSessionId.trim();
    const sessionId =
      rawSessionId && isSessionForAgent(rawSessionId, agentId) ? rawSessionId : mainSessionIdForAgent(agentId);
    const dependsOn = Array.from(new Set(draftDependsOn.map((item) => item.trim()).filter(Boolean)));
    const maxRejectCount = Math.max(0, Math.min(10, Math.trunc(Number(draftMaxRejectCount) || 0)));
    const rawAllowed = Array.from(
      new Set(
        draftWorkflowRouteAllowed
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    );
    const allowed = normalizeRouteOptionsWithDefaults(rawAllowed);

    if (includeNodeConfig) {
      if (!title || !agentId) {
        return { ok: false, error: t("actionMessage.nodeSaveFailedEmptyFields") };
      }
      const validEntityIds = new Set<string>([
        ...workflow.nodes.map((node) => node.id),
        ...getInferredParallelGroups(workflow).map((group) => group.id),
      ]);
      const badDepends = dependsOn.find((dep) => !validEntityIds.has(dep) || dep === selectedNode.id);
      if (badDepends) {
        return { ok: false, error: t("actionMessage.nodeSaveFailedInvalidDep", { depId: badDepends }) };
      }
      const disallowedDepends = getDisallowedDependencyIdsForNode(workflow, selectedNode.id);
      const invalidParallelDepends = dependsOn.find((dep) => disallowedDepends.has(dep));
      if (invalidParallelDepends) {
        return {
          ok: false,
          error: t("actionMessage.nodeSaveFailedParallelGroupDep", { depId: invalidParallelDepends }),
        };
      }
    }

    if (includeWorkflowConfig) {
      if (allowed.length > 5) {
        return { ok: false, error: t("actionMessage.routeSaveFailedMaxAllowed") };
      }
    }

    const routeTargets = allowed.reduce<Record<string, string>>((acc, route) => {
      if (route === MAINLINE_ROUTE_VALUE) return acc;
      const targetNodeId = (draftWorkflowRouteTargets[route] ?? "").trim();
      if (targetNodeId) acc[route] = targetNodeId;
      return acc;
    }, {});
    if (includeWorkflowConfig) {
      const validTargetIds = new Set([
        ...workflow.nodes.map((node) => node.id),
        ...materializeParallelGroups(workflow, workflow.nodes, workflow.edges, workflow.groups).map(
          (group) => group.id,
        ),
      ]);
      const invalidRouteTarget = Object.entries(routeTargets).find(
        ([route, targetId]) =>
          !allowed.includes(route) ||
          !validTargetIds.has(targetId) ||
          targetId === selectedNode.id ||
          route === MAINLINE_ROUTE_VALUE,
      );
      if (invalidRouteTarget) {
        return {
          ok: false,
          error: t("actionMessage.routeSaveFailedInvalidTarget", {
            route: invalidRouteTarget[0],
            targetId: invalidRouteTarget[1],
          }),
        };
      }
    }

    const nextNodes = workflow.nodes.map((node) =>
      node.id !== selectedNode.id
        ? node
        : (() => {
            const currentExecutor: NodeExecutor = node.executor ?? selectedNode.executor;
            const agentChanged = (currentExecutor.agentId ?? "").trim() !== agentId;
            return {
              ...node,
              name: includeNodeConfig ? title : node.name,
              instruction: includeNodeConfig ? draftInstruction.trim() : node.instruction,
              allowReject: includeNodeConfig ? draftAllowReject : node.allowReject,
              maxRejectCount: includeNodeConfig ? maxRejectCount : node.maxRejectCount,
              executor: includeNodeConfig
                ? {
                    ...currentExecutor,
                    agentId,
                    sessionId,
                    fallbackAgentId: agentChanged ? null : currentExecutor.fallbackAgentId,
                  }
                : currentExecutor,
              lane: includeWorkflowConfig ? draftWorkflowLane : node.lane,
              isMainline: includeWorkflowConfig ? draftWorkflowLane !== "branch" : node.isMainline,
              routePolicy: includeWorkflowConfig ? (allowed.length >= 2 ? { allowed } : null) : node.routePolicy,
            } as WorkflowNode;
          })(),
    );

    // uiLane is only for main/branch display and must not implicitly rewrite execution edges.
    // Execution edges can only be updated through the two explicit edit entry points: "upstream dependencies" and "route targets".
    let nextEdges = [...workflow.edges];
    if (includeNodeConfig) {
      // Upstream dependencies only correspond to dependency edges (when=null).
      nextEdges = dedupeEdges([
        ...nextEdges.filter((edge) => !(edge.to === selectedNode.id && edge.when === null)),
        ...dependsOn.map((dep) => ({ from: dep, to: selectedNode.id, when: null as string | null })),
      ]);
    }
    if (includeWorkflowConfig) {
      // Route targets only correspond to route edges (when=route); cannot reuse dependency edges.
      nextEdges = nextEdges.filter((edge) => !(edge.from === selectedNode.id && edge.when !== null));
      nextEdges = dedupeEdges([
        ...nextEdges,
        ...Object.entries(routeTargets).map(([route, to]) => ({
          from: selectedNode.id,
          to,
          when: route,
        })),
      ]);
    }

    return {
      ok: true,
      workflow: {
        ...workflow,
        nodes: nextNodes,
        edges: nextEdges,
        groups: materializeParallelGroups(workflow, nextNodes, nextEdges, workflow.groups),
      },
    };
  };

  const saveSelectedWorkflowNodeConfig = useCallback(
    async (opts?: { silentSuccess?: boolean }) => {
      if (!workflow || !selectedNode) return;

      setIsSavingWorkflowConfig(true);
      if (!opts?.silentSuccess) setActionMessage("");
      try {
        const built = buildNextWorkflowForSelectedNode({ includeNodeConfig: false, includeWorkflowConfig: true });
        if (!built.ok) {
          setActionMessage(built.error);
          return;
        }
        const validation = validateWorkflowBeforeSave(built.workflow);
        if (!validation.ok) {
          setActionMessage(t("validation.workflowConfigSaveFailed", { message: validation.message }));
          return;
        }
        await saveWorkflowDefinitionReq(activePipelineId, built.workflow);
        updatePipelineState(activePipelineId, (prev) => ({ ...prev, workflow: built.workflow }));
        setWorkflowSaveFailed(false);
        await refresh();
        if (!opts?.silentSuccess) {
          setActionMessage(t("actionMessage.nodeWorkflowSaved", { nodeId: selectedNode.id }));
        }
      } catch (error) {
        const message = getApiErrorMessage(error);
        setActionMessage(t("validation.workflowConfigSaveFailed", { message }));
        setWorkflowSaveFailed(true);
      } finally {
        setIsSavingWorkflowConfig(false);
      }
    },
    [
      workflow,
      selectedNode,
      draftTitle,
      draftAgentId,
      draftExecutorSessionId,
      draftDependsOn,
      draftInstruction,
      draftAllowReject,
      draftMaxRejectCount,
      draftWorkflowLane,
      draftWorkflowRouteAllowed,
      draftWorkflowRouteTargets,
      isSessionForAgent,
    ],
  );

  // Reset save failure when switching to a different node
  useEffect(() => {
    setWorkflowSaveFailed(false);
  }, [selectedNode?.id]);

  useEffect(() => {
    if (!selectedNode || !hasWorkflowDraftChanges) return;
    if (isSavingWorkflowConfig || workflowSaveFailed) return;
    const timer = setTimeout(() => {
      void saveSelectedWorkflowNodeConfig({ silentSuccess: true });
    }, 250);
    return () => clearTimeout(timer);
  }, [
    selectedNode?.id,
    hasWorkflowDraftChanges,
    isSavingWorkflowConfig,
    workflowSaveFailed,
    saveSelectedWorkflowNodeConfig,
  ]);

  const saveSelectedGroupConfig = useCallback(async () => {
    if (!workflow || !selectedGroup) return;
    const nextGroupId = draftGroupId.trim();
    const memberIds = Array.from(new Set(draftGroupMembers.map((item) => item.trim()).filter(Boolean)));
    if (!nextGroupId) {
      setActionMessage(t("actionMessage.groupSaveFailedEmptyId"));
      return;
    }
    if (memberIds.length < 2) {
      setActionMessage(t("actionMessage.groupSaveFailedMinMembers"));
      return;
    }
    const validNodeIds = new Set(workflow.nodes.map((node) => node.id));
    const invalidMember = memberIds.find((id) => !validNodeIds.has(id));
    if (invalidMember) {
      setActionMessage(t("actionMessage.groupSaveFailedInvalidMember", { memberId: invalidMember }));
      return;
    }
    const upstreamIds = Array.from(new Set(draftGroupUpstreams.map((item) => item.trim()).filter(Boolean)));
    const validEntityIds = new Set<string>([
      ...workflow.nodes.map((node) => node.id),
      ...getInferredParallelGroups(workflow).map((group) => group.id),
    ]);
    const invalidUpstream = upstreamIds.find(
      (id) => !validEntityIds.has(id) || memberIds.includes(id) || id === nextGroupId,
    );
    if (invalidUpstream) {
      setActionMessage(t("actionMessage.groupSaveFailedInvalidUpstream", { upstreamId: invalidUpstream }));
      return;
    }

    const nextWorkflow = updateParallelGroupInWorkflow({
      workflow,
      previousGroupId: selectedGroup.id,
      nextGroupId,
      memberIds,
      upstreamIds,
      joinPolicy: draftGroupJoinPolicy,
    });
    const groupValidation = validateWorkflowBeforeSave(nextWorkflow);
    if (!groupValidation.ok) {
      setActionMessage(t("actionMessage.groupSaveFailed", { message: groupValidation.message }));
      return;
    }

    setIsSavingGroupConfig(true);
    try {
      await saveWorkflowDefinitionReq(activePipelineId, nextWorkflow);
      updatePipelineState(activePipelineId, (prev) => ({ ...prev, workflow: nextWorkflow }));
      setSelectedGroupId(nextGroupId);
      setActionMessage(t("actionMessage.groupSaved", { groupId: nextGroupId }));
      await refresh();
    } catch (error) {
      const message = getApiErrorMessage(error);
      setActionMessage(t("actionMessage.groupSaveFailed", { message }));
    } finally {
      setIsSavingGroupConfig(false);
    }
  }, [workflow, selectedGroup, draftGroupId, draftGroupMembers, draftGroupUpstreams, draftGroupJoinPolicy, refresh]);

  const moveNode = useCallback(
    async (pipelineId: PipelineId, nodeId: string, direction: "up" | "down") => {
      if (isSavingNodeConfig) return;
      const targetWorkflow = getPipelineStateSnapshot(pipelineId, pipelineStateById).workflow;
      if (!targetWorkflow) return;
      const nextWorkflow = moveWorkflowNodeWithinLane(targetWorkflow, nodeId, direction);
      if (nextWorkflow === targetWorkflow) return;

      setIsSavingNodeConfig(true);
      setActionMessage("");
      try {
        // Order editing may happen on a non-active pipeline card; must explicitly use the source pipelineId to save.
        await saveWorkflowDefinitionReq(pipelineId, nextWorkflow);
        updatePipelineState(pipelineId, (prev) => ({ ...prev, workflow: nextWorkflow }));
        setActivePipelineId(pipelineId);
        setSelectedNodeId(nodeId);
        setActionMessage(
          direction === "up"
            ? t("actionMessage.nodeMovedUp", { nodeId })
            : t("actionMessage.nodeMovedDown", { nodeId }),
        );
        await refresh();
      } catch (error) {
        const message = getApiErrorMessage(error);
        setActionMessage(t("actionMessage.nodeMoveFailed", { message }));
      } finally {
        setIsSavingNodeConfig(false);
      }
    },
    [getPipelineStateSnapshot, isSavingNodeConfig, pipelineStateById, refresh, updatePipelineState],
  );

  const reorderNode = useCallback(
    async (pipelineId: PipelineId, nodeId: string, targetNodeId: string, position: "before" | "after" = "before") => {
      if (isSavingNodeConfig) return;
      const targetWorkflow = getPipelineStateSnapshot(pipelineId, pipelineStateById).workflow;
      if (!targetWorkflow) return;
      const nextWorkflow = reorderWorkflowNodeWithinLane(targetWorkflow, nodeId, targetNodeId, position);
      if (nextWorkflow === targetWorkflow) return;

      setIsSavingNodeConfig(true);
      setActionMessage("");
      try {
        // Drag-and-drop reorder and button reorder share the same explicit pipeline save path to avoid writing to the wrong target when switching between pipeline A/B cards.
        await saveWorkflowDefinitionReq(pipelineId, nextWorkflow);
        updatePipelineState(pipelineId, (prev) => ({ ...prev, workflow: nextWorkflow }));
        setActivePipelineId(pipelineId);
        setSelectedNodeId(nodeId);
        setActionMessage(
          position === "after"
            ? t("actionMessage.nodeReorderedAfter", { nodeId, targetNodeId })
            : t("actionMessage.nodeReorderedBefore", { nodeId, targetNodeId }),
        );
        await refresh();
      } catch (error) {
        const message = getApiErrorMessage(error);
        setActionMessage(t("actionMessage.nodeReorderFailed", { message }));
      } finally {
        setIsSavingNodeConfig(false);
      }
    },
    [getPipelineStateSnapshot, isSavingNodeConfig, pipelineStateById, refresh, updatePipelineState],
  );

  const saveWorkflowJsonDraft = useCallback(async () => {
    if (!workflowJsonDraft.trim()) {
      setActionMessage(t("actionMessage.workflowJsonEmpty"));
      return;
    }
    let parsed: WorkflowDefinition;
    try {
      parsed = JSON.parse(workflowJsonDraft) as WorkflowDefinition;
    } catch (error) {
      setActionMessage(t("actionMessage.workflowJsonInvalid", { error: String(error) }));
      return;
    }
    setIsSavingWorkflowJson(true);
    try {
      const validation = validateWorkflowBeforeSave(parsed);
      if (!validation.ok) {
        setActionMessage(t("actionMessage.workflowJsonSaveFailed", { message: validation.message }));
        return;
      }
      await saveWorkflowDefinitionReq(activePipelineId, parsed);
      updatePipelineState(activePipelineId, (prev) => ({ ...prev, workflow: parsed }));
      await refresh();
      setActionMessage(t("actionMessage.workflowJsonSaved"));
    } catch (error) {
      const message = getApiErrorMessage(error);
      setActionMessage(t("actionMessage.workflowJsonSaveFailed", { message }));
    } finally {
      setIsSavingWorkflowJson(false);
    }
  }, [workflowJsonDraft]);

  const saveSelectedNodeConfig = useCallback(
    async (opts?: { silentSuccess?: boolean }) => {
      if (!selectedNode || !workflow) return;
      setIsSavingNodeConfig(true);
      if (!opts?.silentSuccess) setActionMessage("");
      try {
        const built = buildNextWorkflowForSelectedNode({ includeNodeConfig: true, includeWorkflowConfig: false });
        if (!built.ok) {
          setActionMessage(built.error);
          return;
        }
        const validation = validateWorkflowBeforeSave(built.workflow);
        if (!validation.ok) {
          setActionMessage(t("validation.nodeConfigSaveFailed", { message: validation.message }));
          return;
        }
        await saveWorkflowDefinitionReq(activePipelineId, built.workflow);
        updatePipelineState(activePipelineId, (prev) => ({
          ...prev,
          workflow: built.workflow,
          pipeline: prev.pipeline.map((node) =>
            node.id === selectedNode.id
              ? (() => {
                  const title = draftTitle.trim();
                  const agentId = draftAgentId.trim();
                  const rawSessionId = draftExecutorSessionId.trim();
                  const sessionId =
                    rawSessionId && isSessionForAgent(rawSessionId, agentId)
                      ? rawSessionId
                      : mainSessionIdForAgent(agentId);
                  const dependsOn = Array.from(new Set(draftDependsOn.map((item) => item.trim()).filter(Boolean)));
                  const maxRejectCount = Math.max(0, Math.min(10, Math.trunc(Number(draftMaxRejectCount) || 0)));
                  const agentChanged = (node.executor.agentId ?? "").trim() !== agentId;
                  return {
                    ...node,
                    title,
                    instruction: draftInstruction.trim(),
                    dependsOn,
                    allowReject: draftAllowReject,
                    maxRejectCount,
                    executor: {
                      ...node.executor,
                      agentId,
                      sessionId,
                      fallbackAgentId: agentChanged ? null : node.executor.fallbackAgentId,
                    },
                  };
                })()
              : node,
          ),
        }));
        if (!opts?.silentSuccess) {
          setActionMessage(t("actionMessage.nodeSaved", { nodeId: selectedNode.id }));
        }
        await refresh();
      } catch (error) {
        const message = getApiErrorMessage(error);
        setActionMessage(t("actionMessage.nodeSaveFailed", { message }));
      } finally {
        setIsSavingNodeConfig(false);
      }
    },
    [
      workflow,
      selectedNode,
      draftTitle,
      draftAgentId,
      draftExecutorSessionId,
      draftDependsOn,
      draftInstruction,
      draftAllowReject,
      draftMaxRejectCount,
      isSessionForAgent,
    ],
  );

  const saveSelectedNodeConfigOnBlur = () => {
    if (!selectedNode) return;
    if (!hasNodeDraftChanges) return;
    if (isSavingNodeConfig) return;
    const task = saveSelectedNodeConfig({ silentSuccess: true });
    pendingNodeSaveRef.current = task;
    void task.finally(() => {
      if (pendingNodeSaveRef.current === task) {
        pendingNodeSaveRef.current = null;
      }
    });
  };

  const addTemplateNode = async () => {
    if (!workflow) {
      setActionMessage(t("actionMessage.nodeAddFailedNoWorkflow"));
      return;
    }
    const nodeId = draftNewNodeId.trim();
    const title = draftNewNodeTitle.trim();
    const agentId = draftNewNodeAgentId.trim();
    const instruction = draftNewNodeInstruction.trim();

    if (!nodeId || !title || !agentId) {
      setActionMessage(t("actionMessage.nodeAddFailedEmptyFields"));
      return;
    }
    if (templateNodes.some((node) => node.id === nodeId)) {
      setActionMessage(t("actionMessage.nodeAddFailedDuplicateId", { nodeId }));
      return;
    }

    const dependsOn = Array.from(new Set(draftNewNodeDependsOn.map((item) => item.trim()).filter(Boolean)));
    const validEntityIds = new Set<string>([
      ...templateNodes.map((node) => node.id),
      ...inferredGroups.map((group) => group.id),
      nodeId,
    ]);
    const badDepends = dependsOn.find((dep) => !validEntityIds.has(dep) || dep === nodeId);
    if (badDepends) {
      setActionMessage(t("actionMessage.nodeAddFailedInvalidDep", { depId: badDepends }));
      return;
    }

    const baseOutput = selectedNode?.outputSpec ?? { type: "generic.v1", schemaVersion: 1 };
    const nextWorkflowNode: WorkflowDefinition["nodes"][number] = {
      id: nodeId,
      name: title,
      type: "task",
      enabled: true,
      isMainline: true,
      lane: "main",
      parallelGroupId: null,
      inputMode: "single",
      outputMode: "single",
      routePolicy: null,
      retryPolicy: { maxAttempts: 2, backoffMs: 0 },
      executor: {
        agentId,
        role: "operator",
        fallbackAgentId: null,
        sessionId: mainSessionIdForAgent(agentId),
      },
      instruction,
      outputSpec: {
        type: baseOutput.type,
        schemaVersion: baseOutput.schemaVersion,
      },
      allowReject: false,
      maxRejectCount: 3,
    };

    const nextWorkflow: WorkflowDefinition = {
      ...workflow,
      nodes: insertWorkflowNodeByDependencies(workflow, nextWorkflowNode, dependsOn),
      edges: dedupeEdges([
        ...workflow.edges,
        ...dependsOn.map((dep) => ({ from: dep, to: nodeId, when: null as string | null })),
      ]),
    };
    const nodeWorkflowValidation = validateWorkflowBeforeSave(nextWorkflow);
    if (!nodeWorkflowValidation.ok) {
      setActionMessage(t("actionMessage.nodeAddFailed", { message: nodeWorkflowValidation.message }));
      return;
    }

    setIsAddingNode(true);
    setActionMessage("");
    try {
      await saveWorkflowDefinitionReq(activePipelineId, nextWorkflow);
      updatePipelineState(activePipelineId, (prev) => ({ ...prev, workflow: nextWorkflow }));
      setDraftNewNodeId("");
      setDraftNewNodeTitle("");
      setDraftNewNodeInstruction("");
      setDraftNewNodeDependsOn([]);
      setIsCreateNodeModalOpen(false);
      setActionMessage(t("actionMessage.nodeAdded", { nodeId }));
      await refresh();
      setSelectedNodeId(nodeId);
    } catch (error) {
      const message = getApiErrorMessage(error);
      setActionMessage(t("actionMessage.nodeAddFailed", { message }));
    } finally {
      setIsAddingNode(false);
    }
  };

  const addParallelGroup = async () => {
    if (!workflow) {
      setActionMessage(t("actionMessage.groupAddFailedNoWorkflow"));
      return;
    }
    const groupId = draftNewGroupId.trim();
    if (!groupId) {
      setActionMessage(t("actionMessage.groupAddFailedEmptyId"));
      return;
    }
    if (workflow.groups.some((group) => group.id === groupId)) {
      setActionMessage(t("actionMessage.groupAddFailedDuplicateId", { groupId }));
      return;
    }
    const memberIds = Array.from(new Set(draftNewGroupMembers.map((item) => item.trim()).filter(Boolean)));
    if (memberIds.length < 2) {
      setActionMessage(t("actionMessage.groupAddFailedMinMembers"));
      return;
    }
    const validNodeIds = new Set(workflow.nodes.map((node) => node.id));
    const badMember = memberIds.find((id) => !validNodeIds.has(id));
    if (badMember) {
      setActionMessage(t("actionMessage.groupAddFailedInvalidMember", { memberId: badMember }));
      return;
    }
    const upstreamIds = Array.from(new Set(draftNewGroupUpstreams.map((item) => item.trim()).filter(Boolean)));
    const validEntityIds = new Set<string>([
      ...workflow.nodes.map((node) => node.id),
      ...getInferredParallelGroups(workflow).map((group) => group.id),
    ]);
    const invalidUpstream = upstreamIds.find(
      (id) => !validEntityIds.has(id) || memberIds.includes(id) || id === groupId,
    );
    if (invalidUpstream) {
      setActionMessage(t("actionMessage.groupAddFailedInvalidUpstream", { upstreamId: invalidUpstream }));
      return;
    }

    const nextNodes = workflow.nodes.map((node) =>
      memberIds.includes(node.id)
        ? {
            ...node,
            parallelGroupId: groupId,
          }
        : node,
    );
    const downstreamIds = getCommonDownstreamIdsForGroup(workflow, groupId, memberIds);
    let nextEdges = workflow.edges.filter((edge) => {
      if (edge.when !== null) return true;
      if (edge.to === groupId || edge.from === groupId) return false;
      if (memberIds.includes(edge.to)) return false;
      if (memberIds.includes(edge.from) && !memberIds.includes(edge.to)) return false;
      return true;
    });
    nextEdges = dedupeEdges([
      ...nextEdges,
      ...upstreamIds.map((from) => ({ from, to: groupId, when: null as string | null })),
      ...downstreamIds.map((to) => ({ from: groupId, to, when: null as string | null })),
    ]);

    const nextWorkflow: WorkflowDefinition = {
      ...workflow,
      nodes: nextNodes,
      edges: nextEdges,
      groups: materializeParallelGroups(workflow, nextNodes, nextEdges, [
        ...workflow.groups,
        {
          id: groupId,
          type: "parallel",
          members: memberIds,
          joinPolicy: draftNewGroupJoinPolicy,
        },
      ]),
    };
    const groupWorkflowValidation = validateWorkflowBeforeSave(nextWorkflow);
    if (!groupWorkflowValidation.ok) {
      setActionMessage(t("actionMessage.groupAddFailed", { message: groupWorkflowValidation.message }));
      return;
    }

    setIsAddingNode(true);
    setActionMessage("");
    try {
      await saveWorkflowDefinitionReq(activePipelineId, nextWorkflow);
      updatePipelineState(activePipelineId, (prev) => ({ ...prev, workflow: nextWorkflow }));
      setDraftNewGroupId("");
      setDraftNewGroupMembers([]);
      setDraftNewGroupUpstreams([]);
      setDraftNewGroupJoinPolicy("all");
      setDraftCreateKind("node");
      setIsCreateNodeModalOpen(false);
      setSelectedNodeId("");
      setSelectedGroupId(groupId);
      setActionMessage(t("actionMessage.groupAdded", { groupId }));
      await refresh();
    } catch (error) {
      const message = getApiErrorMessage(error);
      setActionMessage(t("actionMessage.groupAddFailed", { message }));
    } finally {
      setIsAddingNode(false);
    }
  };

  const deleteTemplateNodeById = async (nodeId: string) => {
    if (!workflow) {
      setActionMessage(t("actionMessage.nodeDeleteFailedNoWorkflow"));
      return;
    }
    const nodeToDelete = templateNodes.find((node) => node.id === nodeId);
    if (!nodeToDelete) return;
    if (templateNodes.length <= 1) {
      setActionMessage(t("actionMessage.nodeDeleteFailedMinNodes"));
      return;
    }

    const nextWorkflow = buildWorkflowAfterNodeDelete(workflow, nodeId);
    const deleteWorkflowValidation = validateWorkflowBeforeSave(nextWorkflow);
    if (!deleteWorkflowValidation.ok) {
      setActionMessage(t("actionMessage.nodeDeleteFailed", { message: deleteWorkflowValidation.message }));
      return;
    }

    setIsDeletingNode(true);
    setActionMessage("");
    try {
      await saveWorkflowDefinitionReq(activePipelineId, nextWorkflow);
      updatePipelineState(activePipelineId, (prev) => ({ ...prev, workflow: nextWorkflow }));
      setDeleteTargetNodeId("");
      setActionMessage(t("actionMessage.nodeDeleted", { nodeId: nodeToDelete.id }));
      await refresh();
      setSelectedNodeId((currentSelectedId) => (currentSelectedId === nodeId ? "" : currentSelectedId));
    } catch (error) {
      const message = getApiErrorMessage(error);
      setActionMessage(t("actionMessage.nodeDeleteFailed", { message }));
    } finally {
      setIsDeletingNode(false);
    }
  };

  const deleteParallelGroupById = async (groupId: string) => {
    if (!workflow) {
      setActionMessage(t("actionMessage.groupDeleteFailedNoWorkflow"));
      return;
    }
    const targetGroup = materializeParallelGroups(workflow, workflow.nodes, workflow.edges, workflow.groups).find(
      (group) => group.id === groupId,
    );
    if (!targetGroup) {
      setActionMessage(t("actionMessage.groupDeleteFailedNotFound", { groupId }));
      return;
    }

    const memberIds = new Set(targetGroup.members);
    const nextNodes = workflow.nodes.map((node) =>
      memberIds.has(node.id)
        ? {
            ...node,
            parallelGroupId: null,
          }
        : node,
    );
    const nextEdges = workflow.edges.filter((edge) => {
      if (edge.when !== null) {
        return edge.from !== groupId && edge.to !== groupId;
      }
      if (edge.from === groupId || edge.to === groupId) return false;
      return true;
    });
    const nextGroups = workflow.groups.filter((group) => group.id !== groupId);
    const nextWorkflow: WorkflowDefinition = {
      ...workflow,
      nodes: nextNodes,
      edges: nextEdges,
      groups: materializeParallelGroups(workflow, nextNodes, nextEdges, nextGroups),
    };

    setIsDeletingNode(true);
    setActionMessage("");
    try {
      await saveWorkflowDefinitionReq(activePipelineId, nextWorkflow);
      updatePipelineState(activePipelineId, (prev) => ({ ...prev, workflow: nextWorkflow }));
      setDeleteTargetGroupId("");
      setSelectedGroupId((current) => (current === groupId ? "" : current));
      setActionMessage(t("actionMessage.groupDeleted", { groupId }));
      await refresh();
    } catch (error) {
      const message = getApiErrorMessage(error);
      setActionMessage(t("actionMessage.groupDeleteFailed", { message }));
    } finally {
      setIsDeletingNode(false);
    }
  };

  const getParallelGroupsForPipeline = (pipelineId: PipelineId) => {
    const targetWorkflow = getPipelineStateSnapshot(pipelineId, pipelineStateById).workflow;
    if (!targetWorkflow) return [] as Array<{ id: string; members: string[] }>;
    return getInferredParallelGroups(targetWorkflow).map((group) => ({
      id: group.id,
      members: group.members,
    }));
  };

  const getHasPipelineExecutionForPipeline = (pipelineId: PipelineId) =>
    computeHasPipelineExecution(
      getPipelineStateSnapshot(pipelineId, pipelineStateById).pipeline,
      getPipelineStateSnapshot(pipelineId, pipelineStateById).isRunning,
    );

  const getIsPipelineEditing = (pipelineId: PipelineId) => editingPipelineId === pipelineId;

  return {
    active,
    setActive,
    sessionModalOpen,
    setSessionModalOpen,
    selectedAgentId,
    gateway,
    pipelineList,
    activePipelineId,
    activePipelineTitle,
    setActivePipelineId,
    pipelineStateById,
    runId,
    latencyMs,
    agents,
    sessions,
    filteredSessionsForSelectedAgent,
    selectedSessionId,
    setSelectedSessionId,
    sessionMessage,
    setSessionMessage,
    sendMode,
    setSendMode,
    lastSendInfo,
    sessionCreatePayload,
    setSessionCreatePayload,
    pipeline,
    workflow,
    parallelGroups,
    getParallelGroupsForPipeline,
    schedulerState,
    batchRunState,
    batchStartBatch,
    batchStartBatchById,
    agentCards,
    selectedNode,
    selectedGroup,
    selectedWorkflowNode,
    dependencyOptions,
    groupMemberOptions,
    groupUpstreamOptions,
    routeTargetOptions,
    newNodeDependencyOptions,
    setSelectedNodeId,
    setSelectedGroupId,
    selectNodeInPipeline,
    selectGroupInPipeline,
    timeline,
    pipelineItems: visiblePipelineItems,
    createSession,
    sendSessionMessage,
    retryNode: () => retryNode(activePipelineId, selectedNode?.id),
    openSessionModalForAgent,
    serverVersion,
    actionMessage,
    isCreatingPipeline,
    isDeletingPipeline,
    isRenamingPipeline,
    isRunning,
    startPipelineRun,
    stopPipelineRun,
    createPipeline,
    renamePipeline,
    deletePipeline,
    getHasPipelineExecutionForPipeline,
    isBatchOperating,
    getPipelineRemoteBatchPlugin,
    getPipelinePlugins,
    getPipelineSchedulerPlugin,
    savePipelinePlugins,
    setBatchStartBatch,
    startRemoteKeywordBatchRun,
    stopKeywordBatchRun,
    toggleScheduler,
    switchSchedulerMode,
    manualTick,
    workflowJsonDraft,
    setWorkflowJsonDraft,
    isSavingWorkflowJson,
    saveWorkflowJsonDraft,
    hasPipelineExecution,
    isPipelineEditing,
    getIsPipelineEditing,
    setIsPipelineEditing: (editing: boolean) => setPipelineEditing(activePipelineId, editing),
    setPipelineEditing,
    isCreateNodeModalOpen,
    setIsCreateNodeModalOpen,
    deleteTargetNodeId,
    setDeleteTargetNodeId,
    deleteTargetGroupId,
    setDeleteTargetGroupId,
    agentOutputModalAgentId,
    setAgentOutputModalAgentId,
    draftTitle,
    setDraftTitle,
    draftAgentId,
    setDraftAgentId: setDraftAgentIdWithSessionSync,
    draftExecutorSessionId: draftExecutorSessionDisplayId,
    setDraftExecutorSessionId,
    nodeSessionOptions,
    draftInstruction,
    setDraftInstruction,
    draftDependsOn,
    setDraftDependsOn,
    draftAllowReject,
    setDraftAllowReject,
    draftMaxRejectCount,
    setDraftMaxRejectCount,
    draftWorkflowLane,
    setDraftWorkflowLane,
    draftWorkflowRouteAllowed,
    setDraftWorkflowRouteAllowed,
    draftWorkflowRouteTargets,
    setDraftWorkflowRouteTarget,
    isSavingWorkflowConfig,
    saveSelectedWorkflowNodeConfig,
    draftGroupId,
    setDraftGroupId,
    draftGroupMembers,
    setDraftGroupMembers,
    draftGroupUpstreams,
    setDraftGroupUpstreams,
    draftGroupJoinPolicy,
    setDraftGroupJoinPolicy,
    isSavingGroupConfig,
    saveSelectedGroupConfig,
    isSavingNodeConfig,
    saveSelectedNodeConfig,
    saveSelectedNodeConfigOnBlur,
    moveSelectedNodeUp: (nodeId = selectedNode?.id ?? "", pipelineId = activePipelineId) =>
      moveNode(pipelineId, nodeId, "up"),
    moveSelectedNodeDown: (nodeId = selectedNode?.id ?? "", pipelineId = activePipelineId) =>
      moveNode(pipelineId, nodeId, "down"),
    reorderNode,
    draftCreateKind,
    setDraftCreateKind,
    draftNewNodeId,
    setDraftNewNodeId,
    draftNewNodeTitle,
    setDraftNewNodeTitle,
    draftNewNodeAgentId,
    setDraftNewNodeAgentId,
    draftNewNodeInstruction,
    setDraftNewNodeInstruction,
    draftNewNodeDependsOn,
    setDraftNewNodeDependsOn,
    draftNewGroupId,
    setDraftNewGroupId,
    draftNewGroupMembers,
    setDraftNewGroupMembers,
    draftNewGroupUpstreams,
    setDraftNewGroupUpstreams,
    draftNewGroupJoinPolicy,
    setDraftNewGroupJoinPolicy,
    newGroupMemberOptions,
    newGroupUpstreamOptions,
    isAddingNode,
    addTemplateNode,
    addParallelGroup,
    isDeletingNode,
    deleteTemplateNodeById,
    deleteParallelGroupById,
    refreshAgents: async () => {
      try {
        const result = await fetchAgents();
        setAgents(result);
      } catch {
        /* best-effort refresh */
      }
    },
  };
}
