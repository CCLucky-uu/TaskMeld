import type { NodeRun } from "../runtime-model";
import type { ResultEnvelope } from "../structured-output";
import { markNodeFailed, markNodeRejected } from "../state";
import type { StateTransitionContext } from "../state";
import { archiveRejectedArtifacts } from "./rejected-artifact-archiver";

const ctx = (reason: string, extra?: Partial<Omit<StateTransitionContext, "reason">>): StateTransitionContext => ({ reason, ...extra });

export const extractEnvelopeErrorMessage = (error: unknown): string => {
  if (!error || typeof error !== "object") return "";
  const obj = error as Record<string, unknown>;
  if (typeof obj.message === "string" && obj.message.trim()) return obj.message.trim();
  if (typeof obj.reason === "string" && obj.reason.trim()) return obj.reason.trim();
  return "";
};

export const extractEnvelopeRejectTargets = (error: unknown): string[] => {
  if (!error || typeof error !== "object") return [];
  const obj = error as Record<string, unknown>;
  if (!Array.isArray(obj.targets)) return [];
  return obj.targets
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
};

export const pickDefaultRejectTarget = (
  node: NodeRun,
  nodes: NodeRun[],
  dependencyIds?: string[],
): string | null => {
  const effectiveDependencyIds = dependencyIds?.length ? dependencyIds : node.dependsOn;
  if (effectiveDependencyIds.length === 0) return null;
  const indexById = new Map(nodes.map((current, index) => [current.id, index]));
  let best: { id: string; index: number } | null = null;
  for (const depId of effectiveDependencyIds) {
    const depIndex = indexById.get(depId);
    if (typeof depIndex !== "number") continue;
    if (!best || depIndex > best.index) {
      best = { id: depId, index: depIndex };
    }
  }
  return best?.id ?? effectiveDependencyIds[effectiveDependencyIds.length - 1] ?? null;
};

export const handleNodeReject = async (params: {
  node: NodeRun;
  envelope: ResultEnvelope;
  itemKey?: string;
  dependencyIds?: string[];
  nodes: NodeRun[];
  runId: string;
  pushTimeline: (text: string, level: "info" | "warn" | "error", detail?: unknown) => void;
  artifactDir: string;
  pipelineId: string;
  getBatchRunId?: () => string | null;
  resetAffectedDownstreamNodes: (opts: {
    targetNodeId: string;
    itemKey?: string;
    skipNodeIds?: string[];
  }) => { affectedNodeCount: number; affectedGroupCount: number };
}): Promise<void> => {
  const { node, envelope, itemKey, dependencyIds, nodes, runId, pushTimeline, artifactDir, pipelineId, getBatchRunId, resetAffectedDownstreamNodes } = params;

  const limit = Number.isFinite(node.maxRejectCount) ? Math.max(0, Math.trunc(node.maxRejectCount)) : 0;
  node.rejectCount = (node.rejectCount ?? 0) + 1;
  if (node.rejectCount > limit) {
    markNodeFailed(node, ctx("reject_limit_exceeded", { error: JSON.stringify(envelope.error ?? "reject_limit_exceeded") }));
    pushTimeline(`节点 ${node.id} 打回超过 ${limit} 次，标记失败`, "error");
    return;
  }

  const effectiveDependencyIds = dependencyIds?.length ? dependencyIds : node.dependsOn;
  const explicitTargets = extractEnvelopeRejectTargets(envelope.error);
  const defaultTarget = pickDefaultRejectTarget(node, nodes, effectiveDependencyIds);
  const rejectTargetIds =
    explicitTargets.length > 0
      ? explicitTargets.filter((id) => effectiveDependencyIds.includes(id))
      : defaultTarget
        ? [defaultTarget]
        : [];
  const rejectMessage = extractEnvelopeErrorMessage(envelope.error) || "下游校验不通过，请修正后重新提交。";

  if (rejectTargetIds.length === 0) {
    markNodeFailed(node, ctx("reject_target_missing", { error: JSON.stringify(envelope.error ?? "reject_target_missing") }));
    pushTimeline(`节点 ${node.id} 请求打回但未找到可用上游节点，标记失败`, "error");
    return;
  }

  markNodeRejected(node, ctx("upstream_reject", { error: JSON.stringify(envelope.error ?? "upstream_reject") }));

  for (const targetId of rejectTargetIds) {
    const targetNode = nodes.find((current) => current.id === targetId);
    if (!targetNode) continue;
    const feedback = `${node.id}(${node.title})打回原因: ${rejectMessage}`;
    targetNode.rejectFeedbacks = [...(targetNode.rejectFeedbacks ?? []), feedback].slice(-5);
    const movedCount = await archiveRejectedArtifacts({
      node: targetNode,
      runId,
      artifactDir,
      pipelineId,
      rejectedByNodeId: node.id,
      getBatchRunId,
      pushTimeline,
    });
    const { affectedNodeCount, affectedGroupCount } = resetAffectedDownstreamNodes({
      targetNodeId: targetId,
      itemKey,
      skipNodeIds: [node.id],
    });
    pushTimeline(
      `节点 ${node.id} 打回 ${targetNode.id}，原因: ${rejectMessage}；重置 ${affectedNodeCount} 个节点/${affectedGroupCount} 个并行组，归档产物 ${movedCount} 条`,
      "warn",
    );
  }
};
