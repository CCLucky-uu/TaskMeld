import {
  ItemBatchRunState,
  NodeItemRun,
  NodeRun,
  PipelineId,
  PipelineInboundJob,
  PipelineLink,
  PipelineListItem,
  PipelineOutput,
  PipelineTemplateNode,
  Run,
  WorkflowDefinition,
  WorkflowSchedulerState,
} from "./types";
import { wsRequest } from "../../shared/ws-client";

type PipelineResponse = {
  run?: Run;
  runId?: string;
  nodes?: NodeRun[];
  scheduler?: WorkflowSchedulerState | null;
};

export type CreatePipelinePayload = {
  id: PipelineId;
  title?: string;
  cloneFrom?: PipelineId;
};

const normalizePipelineRun = (data: PipelineResponse): { run: Run; scheduler: WorkflowSchedulerState | null } => {
  if (data.run && Array.isArray(data.run.nodes)) {
    return { run: data.run, scheduler: data.scheduler ?? null };
  }

  const nodes = Array.isArray(data.nodes) ? data.nodes : [];
  const now = new Date().toISOString();
  return {
    scheduler: data.scheduler ?? null,
    run: {
      id: data.runId ?? "run-241",
      status: "running",
      createdAt: now,
      updatedAt: now,
      nodes,
      itemRuns: [],
      groups: [],
      groupItemRuns: [],
    },
  };
};

const normalizeBindings = (raw: Record<string, unknown>): Record<string, string> => {
  const normalized: Record<string, string> = {};
  for (const [agentId, sessionId] of Object.entries(raw)) {
    if (!agentId || typeof sessionId !== "string" || !sessionId.trim()) continue;
    normalized[agentId] = sessionId.trim();
  }
  return normalized;
};

export async function fetchPipelineList(): Promise<PipelineListItem[]> {
  const data = await wsRequest<{ items?: PipelineListItem[] }>("pipeline.list");
  return Array.isArray(data.items) ? data.items : [];
}

export async function createPipeline(payload: CreatePipelinePayload) {
  return wsRequest<{ ok: boolean; item?: PipelineListItem }>("pipeline.create", payload as Record<string, unknown>);
}

export async function deletePipeline(pipelineId: PipelineId) {
  return wsRequest<{ ok: boolean; pipelineId?: PipelineId }>("pipeline.delete", { pipelineId });
}

export async function renamePipeline(pipelineId: PipelineId, title: string) {
  return wsRequest<{ ok: boolean; item?: PipelineListItem }>("pipeline.rename", { pipelineId, title });
}

export async function fetchCurrentPipeline(
  pipelineId: PipelineId,
): Promise<{ run: Run; scheduler: WorkflowSchedulerState | null }> {
  const data = await wsRequest<PipelineResponse>("pipeline.current", { pipelineId });
  return normalizePipelineRun(data);
}

export async function fetchWorkflowDefinition(pipelineId: PipelineId): Promise<WorkflowDefinition | null> {
  const data = await wsRequest<{ workflow?: WorkflowDefinition }>("pipeline.workflow.get", { pipelineId });
  return data.workflow ?? null;
}

export async function saveWorkflowDefinition(pipelineId: PipelineId, workflow: WorkflowDefinition) {
  return wsRequest<{ ok: boolean; workflow?: WorkflowDefinition; run?: Run }>("pipeline.workflow.save", {
    pipelineId,
    workflow,
  });
}

export async function togglePipelineScheduler(pipelineId: PipelineId, enabled: boolean) {
  return wsRequest<{ ok: boolean; scheduler?: WorkflowSchedulerState }>("pipeline.scheduler.toggle", {
    pipelineId,
    enabled,
  });
}

export async function setPipelineSchedulerMode(pipelineId: PipelineId, mode: "auto" | "manual") {
  return wsRequest<{ ok: boolean; scheduler?: WorkflowSchedulerState }>("pipeline.scheduler.mode", {
    pipelineId,
    mode,
  });
}

export async function pipelineManualTick(pipelineId: PipelineId) {
  return wsRequest<{ ok: boolean; run?: Run; drained?: { executed: number } }>("pipeline.tick", { pipelineId });
}

export async function fetchPipelineItems(pipelineId: PipelineId) {
  return wsRequest<{ items?: NodeItemRun[] }>("pipeline.items", { pipelineId });
}

export async function retryPipelineNode(pipelineId: PipelineId, nodeId: string, itemKey?: string) {
  return wsRequest("pipeline.node.retry", { pipelineId, nodeId, ...(itemKey ? { itemKey } : {}) });
}

type TemplateResponse = { nodes?: PipelineTemplateNode[] };

export async function fetchPipelineTemplate(pipelineId: PipelineId): Promise<PipelineTemplateNode[]> {
  const data = await wsRequest<TemplateResponse>("pipeline.template", { pipelineId });
  return Array.isArray(data.nodes) ? data.nodes : [];
}

export async function startPipelineRun(pipelineId: PipelineId) {
  return wsRequest<{ ok: boolean; run?: Run }>("pipeline.run", { pipelineId });
}

export async function stopPipelineRun(pipelineId: PipelineId) {
  return wsRequest<{
    ok: boolean;
    mode?: "single" | "remote_batch";
    status?: { batchRun?: ItemBatchRunState };
  }>("pipeline.stop", { pipelineId });
}

export async function fetchBatchRunStatus(pipelineId: PipelineId) {
  return wsRequest<{ ok: boolean; state?: ItemBatchRunState }>("pipeline.batchRun.status", { pipelineId });
}

export async function startRemoteBatchRun(
  pipelineId: PipelineId,
  payload?: { batchSize?: number; url?: string; startBatch?: number; startIndex?: number },
) {
  return wsRequest<{ ok: boolean; state?: ItemBatchRunState; remoteUrl?: string; totalFetched?: number }>(
    "pipeline.batchRun.startRemote",
    { pipelineId, ...payload },
  );
}

export async function stopBatchRun(pipelineId: PipelineId) {
  return wsRequest<{ ok: boolean; state?: ItemBatchRunState }>("pipeline.batchRun.stop", { pipelineId });
}

export async function fetchPipelineExecutorBindings(pipelineId: PipelineId): Promise<Record<string, string>> {
  const data = await wsRequest<{ bindings?: Record<string, unknown> }>("pipeline.executorBindings", { pipelineId });
  return normalizeBindings(data.bindings ?? {});
}

// Pipeline Outputs
export async function fetchPipelineOutputs(pipelineId: PipelineId): Promise<PipelineOutput[]> {
  const data = await wsRequest<{ ok?: boolean; items?: PipelineOutput[] }>("pipeline.output.list", { pipelineId });
  return Array.isArray(data.items) ? data.items : [];
}

// Pipeline Links
export async function fetchPipelineLinks(): Promise<PipelineLink[]> {
  const data = await wsRequest<{ ok?: boolean; items?: PipelineLink[] }>("pipeline.link.list");
  return Array.isArray(data.items) ? data.items : [];
}

export async function createPipelineLink(payload: {
  id?: string;
  fromPipelineId: string;
  toPipelineId: string;
  inputContract?: PipelineLink["inputContract"];
  onJobFailed?: "continue" | "pause";
  maxPendingJobs?: number;
}) {
  return wsRequest<{ ok: boolean; link?: PipelineLink; error?: string }>(
    "pipeline.link.create",
    payload as Record<string, unknown>,
  );
}

export async function updatePipelineLink(linkId: string, patch: Record<string, unknown>) {
  return wsRequest<{ ok: boolean; link?: PipelineLink; error?: string }>("pipeline.link.update", { linkId, ...patch });
}

export async function deletePipelineLink(linkId: string) {
  return wsRequest<{ ok: boolean; error?: string }>("pipeline.link.delete", { linkId });
}

// Pipeline Queue
export async function fetchPipelineQueue(pipelineId: PipelineId): Promise<PipelineInboundJob[]> {
  const data = await wsRequest<{ ok?: boolean; items?: PipelineInboundJob[] }>("pipeline.queue.list", { pipelineId });
  return Array.isArray(data.items) ? data.items : [];
}

export async function retryPipelineQueueJob(pipelineId: PipelineId, jobId: string) {
  return wsRequest<{ ok: boolean; job?: PipelineInboundJob; error?: string }>("pipeline.queue.retry", {
    pipelineId,
    jobId,
  });
}

export async function cancelPipelineQueueJob(pipelineId: PipelineId, jobId: string, reason?: string) {
  return wsRequest<{ ok: boolean; error?: string }>("pipeline.queue.cancel", {
    pipelineId,
    jobId,
    reason: reason ?? "canceled_by_user",
  });
}

export async function drainPipelineQueue(pipelineId: PipelineId) {
  return wsRequest<{ ok: boolean }>("pipeline.queue.drain", { pipelineId });
}
