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
import { requestJson } from "../../shared/api/client";

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

const buildPipelinePath = (pipelineId: PipelineId, suffix: string) => `/api/pipelines/${pipelineId}${suffix}`;

export async function fetchPipelineList(): Promise<PipelineListItem[]> {
  const data = await requestJson<{ items?: PipelineListItem[] }>("/api/pipelines");
  return Array.isArray(data.items) ? data.items : [];
}

export async function createPipeline(payload: CreatePipelinePayload) {
  return requestJson<{ ok: boolean; item?: PipelineListItem }>("/api/pipelines", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function deletePipeline(pipelineId: PipelineId) {
  return requestJson<{ ok: boolean; pipelineId?: PipelineId }>(buildPipelinePath(pipelineId, ""), {
    method: "DELETE",
  });
}

export async function renamePipeline(pipelineId: PipelineId, title: string) {
  return requestJson<{ ok: boolean; item?: PipelineListItem }>(buildPipelinePath(pipelineId, ""), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
}

export async function fetchCurrentPipeline(pipelineId: PipelineId): Promise<{ run: Run; scheduler: WorkflowSchedulerState | null }> {
  const data = await requestJson<PipelineResponse>(buildPipelinePath(pipelineId, "/current"));
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
}

export async function fetchWorkflowDefinition(pipelineId: PipelineId): Promise<WorkflowDefinition | null> {
  const data = await requestJson<{ workflow?: WorkflowDefinition }>(buildPipelinePath(pipelineId, "/workflow"));
  return data.workflow ?? null;
}

export async function saveWorkflowDefinition(pipelineId: PipelineId, workflow: WorkflowDefinition) {
  return requestJson<{ ok: boolean; workflow?: WorkflowDefinition; run?: Run }>(buildPipelinePath(pipelineId, "/workflow"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workflow }),
  });
}

export async function togglePipelineScheduler(pipelineId: PipelineId, enabled: boolean) {
  return requestJson<{ ok: boolean; scheduler?: WorkflowSchedulerState }>(buildPipelinePath(pipelineId, "/scheduler/toggle"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
}

export async function setPipelineSchedulerMode(pipelineId: PipelineId, mode: "auto" | "manual") {
  return requestJson<{ ok: boolean; scheduler?: WorkflowSchedulerState }>(buildPipelinePath(pipelineId, "/scheduler/mode"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode }),
  });
}

export async function pipelineManualTick(pipelineId: PipelineId) {
  return requestJson<{ ok: boolean; run?: Run; drained?: { executed: number } }>(buildPipelinePath(pipelineId, "/tick"), {
    method: "POST",
  });
}

export async function fetchPipelineItems(pipelineId: PipelineId) {
  return requestJson<{ items?: NodeItemRun[] }>(buildPipelinePath(pipelineId, "/items"));
}

export async function retryPipelineNode(pipelineId: PipelineId, nodeId: string, itemKey?: string) {
  return requestJson(buildPipelinePath(pipelineId, `/nodes/${nodeId}/retry`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(itemKey ? { itemKey } : {}),
  });
}

type TemplateResponse = { nodes?: PipelineTemplateNode[] };

export async function fetchPipelineTemplate(pipelineId: PipelineId): Promise<PipelineTemplateNode[]> {
  const data = await requestJson<TemplateResponse>(buildPipelinePath(pipelineId, "/template"));
  return Array.isArray(data.nodes) ? data.nodes : [];
}

export async function startPipelineRun(pipelineId: PipelineId) {
  return requestJson<{ ok: boolean; run?: Run }>(buildPipelinePath(pipelineId, "/run"), {
    method: "POST",
  });
}

export async function stopPipelineRun(pipelineId: PipelineId) {
  return requestJson<{
    ok: boolean;
    mode?: "single" | "remote_batch";
    status?: { batchRun?: ItemBatchRunState };
  }>(buildPipelinePath(pipelineId, "/stop"), {
    method: "POST",
  });
}

export async function fetchBatchRunStatus(pipelineId: PipelineId) {
  return requestJson<{ ok: boolean; state?: ItemBatchRunState }>(buildPipelinePath(pipelineId, "/batch-run/status"));
}

export async function startRemoteBatchRun(
  pipelineId: PipelineId,
  payload?: { batchSize?: number; url?: string; startBatch?: number; startIndex?: number },
) {
  return requestJson<{ ok: boolean; state?: ItemBatchRunState; remoteUrl?: string; totalFetched?: number }>(
    buildPipelinePath(pipelineId, "/batch-run/start-remote"),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload ?? {}),
    },
  );
}

export async function stopBatchRun(pipelineId: PipelineId) {
  return requestJson<{ ok: boolean; state?: ItemBatchRunState }>(buildPipelinePath(pipelineId, "/batch-run/stop"), {
    method: "POST",
  });
}

type ExecutorBindingsResponse = {
  bindings?: Record<string, unknown>;
};

export async function fetchPipelineExecutorBindings(pipelineId: PipelineId): Promise<Record<string, string>> {
  const data = await requestJson<ExecutorBindingsResponse>(buildPipelinePath(pipelineId, "/executor-bindings"));
  const raw = data.bindings ?? {};
  const normalized: Record<string, string> = {};
  for (const [agentId, sessionId] of Object.entries(raw)) {
    if (!agentId || typeof sessionId !== "string" || !sessionId.trim()) continue;
    normalized[agentId] = sessionId.trim();
  }
  return normalized;
}

// Pipeline Outputs
export async function fetchPipelineOutputs(pipelineId: PipelineId): Promise<PipelineOutput[]> {
  const data = await requestJson<{ ok?: boolean; items?: PipelineOutput[] }>(buildPipelinePath(pipelineId, "/outputs"));
  return Array.isArray(data.items) ? data.items : [];
}

// Pipeline Links
export async function fetchPipelineLinks(): Promise<PipelineLink[]> {
  const data = await requestJson<{ ok?: boolean; items?: PipelineLink[] }>("/api/pipeline-links");
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
  return requestJson<{ ok: boolean; link?: PipelineLink; error?: string }>("/api/pipeline-links", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function updatePipelineLink(linkId: string, patch: Record<string, unknown>) {
  return requestJson<{ ok: boolean; link?: PipelineLink; error?: string }>(`/api/pipeline-links/${linkId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export async function deletePipelineLink(linkId: string) {
  return requestJson<{ ok: boolean; error?: string }>(`/api/pipeline-links/${linkId}`, {
    method: "DELETE",
  });
}

// Pipeline Queue
export async function fetchPipelineQueue(pipelineId: PipelineId): Promise<PipelineInboundJob[]> {
  const data = await requestJson<{ ok?: boolean; items?: PipelineInboundJob[] }>(buildPipelinePath(pipelineId, "/queue"));
  return Array.isArray(data.items) ? data.items : [];
}

export async function retryPipelineQueueJob(pipelineId: PipelineId, jobId: string) {
  return requestJson<{ ok: boolean; job?: PipelineInboundJob; error?: string }>(buildPipelinePath(pipelineId, `/queue/${jobId}/retry`), {
    method: "POST",
  });
}

export async function cancelPipelineQueueJob(pipelineId: PipelineId, jobId: string, reason?: string) {
  return requestJson<{ ok: boolean; error?: string }>(buildPipelinePath(pipelineId, `/queue/${jobId}/cancel`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason: reason ?? "canceled_by_user" }),
  });
}

export async function drainPipelineQueue(pipelineId: PipelineId) {
  return requestJson<{ ok: boolean }>(buildPipelinePath(pipelineId, "/queue/drain"), {
    method: "POST",
  });
}
