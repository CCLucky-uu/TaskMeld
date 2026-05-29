import { readFile } from "node:fs/promises";
import type { GroupItemRun, GroupRun, NodeItemRun, NodeRun, ArtifactManifest } from "../runtime-model";
import type { RuntimeStore } from "../../app/runtime-store";
import type { WorkflowGraph } from "../workflow-graph";
import { persistArtifactFile } from "../artifact-storage";
import { canPromoteToQueuedByDependency } from "./readiness-state";
import {
  markItemReset,
  markItemQueued,
  markGroupItemRunning,
  markGroupItemSuccess,
  markGroupItemFailed,
  markGroupRunning,
  markGroupSuccess,
  markGroupFailed,
} from "../state";
import type { StateTransitionContext } from "../state";
import type { ExecuteNodeResult, ExecuteGroupResult } from "./execution-result";

const ctx = (reason: string, extra?: Partial<Omit<StateTransitionContext, "reason">>): StateTransitionContext => ({ reason, ...extra });

type CreateGroupItemExecutorDeps = {
  runtimeStore: RuntimeStore;
  graph: WorkflowGraph;
  artifactDir: string;
  pipelineId: string;
  getBatchRunId?: () => string | null;
  getRun: () => import("../runtime-model").Run;
  getNodeById: (nodeId: string) => NodeRun | null;
  getGroupById: (groupId: string) => GroupRun | null;
  getItemRun: (nodeId: string, itemKey: string) => NodeItemRun | null;
  ensureItemKeyInitialized: (itemKey: string) => void;
  getEffectiveDependencyIdsForNodeItem: (nodeId: string, itemKey: string) => string[];
  executeNodeItem: (item: NodeItemRun, opts?: { suppressOutgoing?: boolean; dependencyIds?: string[] }) => Promise<ExecuteNodeResult>;
};

export const createGroupItemExecutor = (deps: CreateGroupItemExecutorDeps) => {

  const executeGroupMembers = async (
    item: GroupItemRun,
    group: { members: string[] },
  ): Promise<{ results: ExecuteNodeResult[]; memberItems: NodeItemRun[] }> => {
    const memberItems = group.members
      .map((memberId) => {
        deps.ensureItemKeyInitialized(item.itemKey);
        return deps.getItemRun(memberId, item.itemKey);
      })
      .filter((candidate): candidate is NodeItemRun => !!candidate);

    for (const memberItem of memberItems) {
      markItemReset(memberItem, "queued", ctx("group_member_start"));
      memberItem.route = null;
      memberItem.artifacts = [];
    }

    const groupDependencyIds = [
      ...new Set(group.members.flatMap((memberId) => deps.getEffectiveDependencyIdsForNodeItem(memberId, item.itemKey))),
    ];
    const results = await Promise.all(
      memberItems.map((memberItem) =>
        deps.executeNodeItem(memberItem, {
          suppressOutgoing: true,
          dependencyIds: groupDependencyIds,
        })),
    );

    return { results, memberItems };
  };

  const collectGroupResult = async (
    item: GroupItemRun,
    group: { id: string },
    runGroup: GroupRun,
    memberItems: NodeItemRun[],
  ): Promise<void> => {
    const run = deps.getRun();

    const memberArtifacts = memberItems.flatMap((memberItem) =>
      memberItem.artifacts.map((artifact) => ({
        nodeId: memberItem.nodeId,
        artifact,
      })),
    );
    const memberArtifactContents = await Promise.all(
      memberArtifacts.map(async (entry) => {
        let content: unknown = "[artifact_read_failed]";
        let meta: Record<string, unknown> | undefined;
        try {
          const raw = await readFile(entry.artifact.path, "utf8");
          const parsed = JSON.parse(raw) as unknown;
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && "artifact" in parsed) {
            const artifactObj = (parsed as { artifact?: { content?: unknown; meta?: unknown } }).artifact;
            content = artifactObj?.content ?? raw;
            if (artifactObj?.meta && typeof artifactObj.meta === "object" && !Array.isArray(artifactObj.meta)) {
              meta = artifactObj.meta as Record<string, unknown>;
            }
          } else {
            content = raw;
          }
        } catch {
          // keep fallback marker
        }
        const memberNode = deps.getNodeById(entry.nodeId);
        return {
          nodeId: entry.nodeId,
          nodeTitle: memberNode?.title ?? entry.nodeId,
          type: entry.artifact.type,
          schemaVersion: entry.artifact.schemaVersion,
          name: entry.artifact.name,
          path: entry.artifact.path,
          hash: entry.artifact.hash,
          content,
          meta,
        };
      }),
    );
    const groupContent = memberArtifactContents
      .map((entry) => `${entry.nodeId}(${entry.nodeTitle})\n${typeof entry.content === "string" ? entry.content : JSON.stringify(entry.content, null, 2)}`)
      .join("\n\n");
    const groupArtifact = await persistArtifactFile(
      deps.artifactDir,
      "success",
      {
        runId: run.id,
        pipelineId: deps.pipelineId,
        batchRunId: deps.getBatchRunId?.(),
        groupId: group.id,
        itemKey: item.itemKey,
        kind: "group",
      },
      {
        type: "group.output.v1",
        schemaVersion: 1,
        name: `${group.id}-group-output`,
        content: groupContent,
        meta: { members: memberArtifactContents },
      },
      { fileNameSuffix: `${item.itemKey}-group-output` },
    );
    runGroup.artifacts = [groupArtifact];
    item.artifacts = [groupArtifact];
    markGroupItemSuccess(item, ctx("group_exec_done"));
    markGroupSuccess(runGroup, ctx("group_exec_done"));

    for (const edge of deps.graph.getOutgoingEdges(group.id)) {
      if (edge.when) continue;
      const downstream = deps.getItemRun(edge.to, item.itemKey);
      if (!downstream) continue;
      if (canPromoteToQueuedByDependency(downstream)) {
        markItemQueued(downstream, ctx("group_downstream_promote"));
      }
    }
    deps.runtimeStore.emitPipeline();
  };

  const executeGroupItem = async (item: GroupItemRun): Promise<ExecuteGroupResult> => {
    const run = deps.getRun();
    const group = deps.graph.getWorkflowGroupById(item.groupId);
    const runGroup = deps.getGroupById(item.groupId);
    if (!group || !runGroup) {
      markGroupItemFailed(item, ctx("group_not_found", { error: "group_not_found" }));
      return { ok: false, error: "group_not_found", finalStatus: "failed" };
    }
    markGroupItemRunning(item, ctx("group_start"));
    markGroupRunning(runGroup, ctx("group_start"));
    deps.runtimeStore.pushTimeline(`并行组执行已触发: ${group.id}#${item.itemKey}`);
    deps.runtimeStore.emitPipeline();

    const { results, memberItems } = await executeGroupMembers(item, group);

    if (results.some((result) => !result.ok)) {
      const memberError = results.find((result) => !result.ok)?.error ?? "group_member_failed";
      markGroupItemFailed(item, ctx("member_failed", { error: memberError }));
      markGroupFailed(runGroup, ctx("member_failed", { error: memberError }));
      deps.runtimeStore.emitPipeline();
      return { ok: false, error: item.lastError ?? undefined, finalStatus: "failed" };
    }

    await collectGroupResult(item, group, runGroup, memberItems);
    return { ok: true, finalStatus: "success" };
  };

  return { executeGroupMembers, collectGroupResult, executeGroupItem };
};

export type GroupItemExecutor = ReturnType<typeof createGroupItemExecutor>;
