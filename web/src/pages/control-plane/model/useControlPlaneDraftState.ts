import { useEffect, useMemo, useState } from "react";
import { PipelineNode, WorkflowDefinition, WorkflowNode } from "../../../entities/pipeline";

type SelectedGroupDraft = {
  id: string;
  members: string[];
  upstreams: string[];
  joinPolicy: "all" | "any" | "quorum";
} | null;

type UseControlPlaneDraftStateArgs = {
  selectedNode?: PipelineNode;
  selectedWorkflowNode: WorkflowNode | null;
  selectedGroup: SelectedGroupDraft;
  selectedRouteTargets: Record<string, string>;
  workflow: WorkflowDefinition | null;
  isSessionForAgent: (sessionId: string, agentId: string) => boolean;
};

export function useControlPlaneDraftState({
  selectedNode,
  selectedWorkflowNode,
  selectedGroup,
  selectedRouteTargets,
  workflow,
  isSessionForAgent,
}: UseControlPlaneDraftStateArgs) {
  const [draftTitle, setDraftTitle] = useState("");
  const [draftAgentId, setDraftAgentId] = useState("");
  const [draftExecutorSessionId, setDraftExecutorSessionId] = useState("");
  const [draftInstruction, setDraftInstruction] = useState("");
  const [draftDependsOn, setDraftDependsOn] = useState<string[]>([]);
  const [draftAllowReject, setDraftAllowReject] = useState(false);
  const [draftMaxRejectCount, setDraftMaxRejectCount] = useState(3);
  const [draftWorkflowLane, setDraftWorkflowLane] = useState<"main" | "branch">("main");
  const [draftWorkflowRouteAllowed, setDraftWorkflowRouteAllowed] = useState("");
  const [draftWorkflowRouteTargets, setDraftWorkflowRouteTargets] = useState<Record<string, string>>({});
  const [draftGroupId, setDraftGroupId] = useState("");
  const [draftGroupMembers, setDraftGroupMembers] = useState<string[]>([]);
  const [draftGroupUpstreams, setDraftGroupUpstreams] = useState<string[]>([]);
  const [draftGroupJoinPolicy, setDraftGroupJoinPolicy] = useState<"all" | "any" | "quorum">("all");
  const [workflowJsonDraft, setWorkflowJsonDraft] = useState("");
  const [draftCreateKind, setDraftCreateKind] = useState<"node" | "group">("node");
  const [draftNewNodeId, setDraftNewNodeId] = useState("");
  const [draftNewNodeTitle, setDraftNewNodeTitle] = useState("");
  const [draftNewNodeAgentId, setDraftNewNodeAgentId] = useState("");
  const [draftNewNodeInstruction, setDraftNewNodeInstruction] = useState("");
  const [draftNewNodeDependsOn, setDraftNewNodeDependsOn] = useState<string[]>([]);
  const [draftNewGroupId, setDraftNewGroupId] = useState("");
  const [draftNewGroupMembers, setDraftNewGroupMembers] = useState<string[]>([]);
  const [draftNewGroupUpstreams, setDraftNewGroupUpstreams] = useState<string[]>([]);
  const [draftNewGroupJoinPolicy, setDraftNewGroupJoinPolicy] = useState<"all" | "any" | "quorum">("all");

  useEffect(() => {
    if (!selectedNode) {
      setDraftTitle("");
      setDraftAgentId("");
      setDraftExecutorSessionId("");
      setDraftInstruction("");
      setDraftDependsOn([]);
      setDraftAllowReject(false);
      setDraftMaxRejectCount(3);
      return;
    }
    setDraftTitle(selectedNode.title);
    const selectedAgentId = selectedNode.executor.agentId;
    setDraftAgentId(selectedAgentId);
    setDraftExecutorSessionId(selectedNode.executor.sessionId?.trim() || "");
    setDraftInstruction(selectedNode.instruction ?? "");
    setDraftDependsOn(selectedNode.dependsOn);
    setDraftAllowReject(selectedNode.allowReject === true);
    setDraftMaxRejectCount(Number.isFinite(selectedNode.maxRejectCount) ? selectedNode.maxRejectCount : 3);
  }, [
    selectedNode?.id,
    selectedNode?.title,
    selectedNode?.executor.agentId,
    selectedNode?.executor.sessionId,
    selectedNode?.instruction,
    selectedNode?.dependsOn,
    selectedNode?.allowReject,
    selectedNode?.maxRejectCount,
  ]);

  useEffect(() => {
    const agentId = draftAgentId.trim();
    if (!agentId) {
      if (draftExecutorSessionId) setDraftExecutorSessionId("");
      return;
    }
    const current = draftExecutorSessionId.trim();
    if (current && !isSessionForAgent(current, agentId)) {
      setDraftExecutorSessionId("");
    }
  }, [draftAgentId, draftExecutorSessionId, isSessionForAgent]);

  useEffect(() => {
    if (!selectedWorkflowNode) {
      setDraftWorkflowLane("main");
      setDraftWorkflowRouteAllowed("");
      setDraftWorkflowRouteTargets({});
      return;
    }
    setDraftWorkflowLane(selectedWorkflowNode.lane === "branch" ? "branch" : "main");
    setDraftWorkflowRouteAllowed(selectedWorkflowNode.routePolicy?.allowed?.join(", ") ?? "");
    setDraftWorkflowRouteTargets(selectedRouteTargets);
  }, [selectedWorkflowNode?.lane, selectedWorkflowNode?.routePolicy, selectedRouteTargets]);

  useEffect(() => {
    if (!selectedGroup) {
      setDraftGroupId("");
      setDraftGroupMembers([]);
      setDraftGroupUpstreams([]);
      setDraftGroupJoinPolicy("all");
      return;
    }
    setDraftGroupId(selectedGroup.id);
    setDraftGroupMembers(selectedGroup.members);
    setDraftGroupUpstreams(selectedGroup.upstreams);
    setDraftGroupJoinPolicy(selectedGroup.joinPolicy);
  }, [selectedGroup]);

  useEffect(() => {
    if (!workflow) {
      setWorkflowJsonDraft("");
      return;
    }
    setWorkflowJsonDraft(JSON.stringify(workflow, null, 2));
  }, [workflow]);

  const hasNodeDraftChanges = useMemo(() => {
    if (!selectedNode) return false;
    const normalizedDraftDependsOn = Array.from(new Set(draftDependsOn.map((item) => item.trim()).filter(Boolean)));
    const normalizedCurrentDependsOn = Array.from(
      new Set((selectedNode.dependsOn ?? []).map((item) => item.trim()).filter(Boolean)),
    );
    const dependsEqual =
      normalizedDraftDependsOn.length === normalizedCurrentDependsOn.length &&
      normalizedDraftDependsOn.every((item, index) => item === normalizedCurrentDependsOn[index]);

    return (
      draftTitle.trim() !== (selectedNode.title ?? "").trim() ||
      draftAgentId.trim() !== (selectedNode.executor.agentId ?? "").trim() ||
      draftExecutorSessionId.trim() !==
        ((selectedNode.executor.sessionId && selectedNode.executor.sessionId.trim()) || "") ||
      (draftInstruction ?? "").trim() !== (selectedNode.instruction ?? "").trim() ||
      draftAllowReject !== (selectedNode.allowReject === true) ||
      Math.max(0, Math.min(10, Math.trunc(Number(draftMaxRejectCount) || 0))) !==
        Math.max(0, Math.min(10, Math.trunc(Number(selectedNode.maxRejectCount) || 0))) ||
      !dependsEqual
    );
  }, [
    selectedNode,
    draftTitle,
    draftAgentId,
    draftExecutorSessionId,
    draftInstruction,
    draftDependsOn,
    draftAllowReject,
    draftMaxRejectCount,
  ]);

  const hasWorkflowDraftChanges = useMemo(() => {
    if (!selectedWorkflowNode) return false;
    const currentLane = selectedWorkflowNode.lane === "branch" ? "branch" : "main";
    const currentAllowed = selectedWorkflowNode.routePolicy?.allowed ?? [];
    const normalizedCurrentAllowed = Array.from(new Set(currentAllowed.map((item) => item.trim()).filter(Boolean)));
    const normalizedDraftAllowed = Array.from(
      new Set(
        draftWorkflowRouteAllowed
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    );
    const allowedEqual =
      normalizedCurrentAllowed.length === normalizedDraftAllowed.length &&
      normalizedCurrentAllowed.every((item, index) => item === normalizedDraftAllowed[index]);
    if (currentLane !== draftWorkflowLane || !allowedEqual) return true;

    const currentTargets = Object.fromEntries(
      normalizedCurrentAllowed.map((route) => [route, (selectedRouteTargets[route] ?? "").trim()]),
    );
    const draftTargets = Object.fromEntries(
      normalizedDraftAllowed.map((route) => [route, (draftWorkflowRouteTargets[route] ?? "").trim()]),
    );
    const currentRoutes = Object.keys(currentTargets);
    const draftRoutes = Object.keys(draftTargets);
    if (currentRoutes.length !== draftRoutes.length) return true;
    return draftRoutes.some((route) => currentTargets[route] !== draftTargets[route]);
  }, [
    selectedWorkflowNode,
    selectedRouteTargets,
    draftWorkflowLane,
    draftWorkflowRouteAllowed,
    draftWorkflowRouteTargets,
  ]);

  const setDraftWorkflowRouteTarget = (route: string, targetNodeId: string) => {
    setDraftWorkflowRouteTargets((prev) => ({
      ...prev,
      [route]: targetNodeId,
    }));
  };

  return {
    draftTitle,
    setDraftTitle,
    draftAgentId,
    setDraftAgentId,
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
    setDraftWorkflowRouteTargets,
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
  };
}
