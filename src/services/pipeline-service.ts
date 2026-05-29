import type { PipelineRegistry } from "../app/pipeline-registry";
import { DEFAULT_REMOTE_BATCH_URL } from "../app/pipeline-config";
import {
  buildPipelineExecutionStatus,
  type PipelineExecutionStatusPayload,
} from "../pipeline/execution-status";
import { normalizePoolItems } from "../pipeline/item-batch-controller";
import {
  buildPipelineStatusResult,
  type PipelineStatusResult as SharedPipelineStatusResult,
} from "./pipeline-status";
import type { PipelineOutput } from "../pipeline/types/pipeline-output";
import type { PipelineLink, PipelineInboundJob } from "../pipeline/types/pipeline-link";

type PipelineRuntime = NonNullable<ReturnType<PipelineRegistry["getPipelineRuntime"]>>;

export type PipelineListItem = {
  id: string;
  title: string;
};

export type PipelineDetail = {
  pipelineId: string;
  title: string;
  run: ReturnType<PipelineRuntime["runtime"]["getRun"]>;
  scheduler: ReturnType<PipelineRuntime["pipeline"]["getSchedulerState"]>;
  batchRun: ReturnType<PipelineRuntime["pipeline"]["getBatchRunState"]>;
  templateNodes: ReturnType<PipelineRuntime["workflow"]["getTemplateNodes"]>;
  workflow: ReturnType<PipelineRuntime["workflow"]["getWorkflow"]>;
};

export type PipelineService = {
  listPipelines: () => PipelineListItem[];
  getPipeline: (pipelineId: string) => PipelineDetail | null;
  getTimeline: () => ReturnType<PipelineRegistry["runtime"]["getCombinedTimeline"]>;
  startPipeline: (pipelineId: string) => Promise<PipelineStartResult>;
  getPipelineExecutionStatus: (pipelineId: string, target?: PipelineRunIdentityTarget) => PipelineStatusResult;
  stopPipeline: (pipelineId: string, target?: PipelineRunIdentityTarget) => PipelineStopResult;
  runPipeline: (pipelineId: string) => Promise<PipelineRunResult>;
  startBatchRun: (input: PipelineStartBatchInput) => PipelineStartBatchResult;
  startRemoteBatchRun: (input: PipelineStartRemoteBatchInput) => Promise<PipelineStartRemoteBatchResult>;
  retryNode: (input: PipelineRetryInput) => Promise<PipelineRetryResult>;
  listOutputs: (pipelineId: string) => Promise<PipelineOutput[]>;
  getOutput: (pipelineId: string, runId?: string) => Promise<PipelineOutput | null>;
  listLinks: () => Promise<PipelineLink[]>;
  getQueue: (pipelineId: string) => PipelineInboundJob[];
  cancelJob: (pipelineId: string, jobId: string, reason?: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  retryJob: (pipelineId: string, jobId: string) => Promise<{ ok: true; job: PipelineInboundJob } | { ok: false; error: string }>;
};

export type PipelineRunIdentityTarget = {
  runId?: string;
  batchRunId?: string;
};

export type PipelineIdentitySnapshot = {
  pipelineId: string;
  runId: string | null;
  batchRunId: string | null;
};

export type PipelineIdentityMetadata = PipelineIdentitySnapshot & {
  requestedRunId: string | null;
  requestedBatchRunId: string | null;
  matchedBy: "pipelineId" | "runId" | "batchRunId" | null;
};

export type PipelineStartResult =
  | {
    ok: true;
    mode: "single";
    pipelineId: string;
    accepted: true;
    runId: string;
    run: ReturnType<PipelineRuntime["runtime"]["getRun"]>;
    workflowNodes: ReturnType<PipelineRuntime["workflow"]["getWorkflow"]>["nodes"];
  }
  | {
    ok: true;
    mode: "remote_batch";
    pipelineId: string;
    accepted: true;
    batchRunId: string;
    runId: string | null;
    remoteUrl: string;
    totalFetched: number;
    batchRun: ReturnType<PipelineRuntime["pipeline"]["getBatchRunState"]>;
    templateNodes: ReturnType<PipelineRuntime["workflow"]["getTemplateNodes"]>;
    edges: ReturnType<PipelineRuntime["workflow"]["getWorkflow"]>["edges"];
    workflowNodes: ReturnType<PipelineRuntime["workflow"]["getWorkflow"]>["nodes"];
  }
  | {
    ok: false;
    pipelineId: string;
    error:
    | "pipeline_not_found"
    | "batch_run_in_progress"
    | "remote_pool_url_empty"
    | "remote_pool_fetch_failed"
    | "remote_pool_fetch_error"
    | "remote_batch_items_empty"
    | "batch_items_empty";
    state?: ReturnType<PipelineRuntime["pipeline"]["getBatchRunState"]>;
    remoteUrl?: string;
    status?: number;
    detail?: string;
  };

export type PipelineRunResult = PipelineStartResult;

export type PipelineExecutionStatus = PipelineExecutionStatusPayload<
  ReturnType<PipelineRuntime["pipeline"]["getSchedulerState"]>,
  ReturnType<PipelineRuntime["pipeline"]["getBatchRunState"]>
>;

type PipelineStatusBaseResult = SharedPipelineStatusResult<
  ReturnType<PipelineRuntime["pipeline"]["getSchedulerState"]>,
  ReturnType<PipelineRuntime["pipeline"]["getBatchRunState"]>
>;

export type PipelineStatusResult =
  | (PipelineStatusBaseResult & PipelineIdentityMetadata)
  | ({
    ok: false;
    pipelineId: string;
    error: "run_not_found";
  } & PipelineIdentityMetadata);

export type PipelineStopResult =
  | {
    ok: true;
    mode: "remote_batch";
    stopped: ReturnType<PipelineRuntime["pipeline"]["stopBatchRun"]>;
    status: PipelineExecutionStatus;
  } & PipelineIdentityMetadata
  | {
    ok: true;
    mode: "single";
    status: PipelineExecutionStatus;
  } & PipelineIdentityMetadata
  | {
    ok: false;
    error: "pipeline_not_found" | "run_not_found" | "batch_run_not_running";
    status?: PipelineExecutionStatus;
  } & PipelineIdentityMetadata;

export type PipelineRetryInput = {
  pipelineId: string;
  nodeId: string;
  itemKey?: string;
};

export type PipelineStartBatchInput = {
  pipelineId: string;
  items: string[];
  batchSize?: number;
  startIndex?: number;
  startBatch?: number;
};

export type PipelineStartRemoteBatchInput = {
  pipelineId: string;
  url?: string;
  batchSize?: number;
  startIndex?: number;
  startBatch?: number;
};

export type PipelineRetryResult =
  | {
    ok: true;
    pipelineId: string;
    run: ReturnType<PipelineRuntime["runtime"]["getRun"]>;
    retry: Awaited<ReturnType<PipelineRuntime["pipeline"]["retryNodeExecution"]>>;
  }
  | {
    ok: false;
    pipelineId: string;
    error: "pipeline_not_found";
  };

export type PipelineStartBatchResult =
  | {
    ok: true;
    pipelineId: string;
    state: ReturnType<PipelineRuntime["pipeline"]["getBatchRunState"]>;
  }
  | {
    ok: false;
    pipelineId: string;
    error: "pipeline_not_found" | "batch_items_empty" | "batch_run_in_progress";
    state?: ReturnType<PipelineRuntime["pipeline"]["getBatchRunState"]>;
  };

export type PipelineStartRemoteBatchResult =
  | {
    ok: true;
    pipelineId: string;
    state: ReturnType<PipelineRuntime["pipeline"]["getBatchRunState"]>;
    remoteUrl: string;
    totalFetched: number;
  }
  | {
    ok: false;
    pipelineId: string;
    error:
    | "pipeline_not_found"
    | "pipeline_plugin_disabled"
    | "remote_pool_url_empty"
    | "remote_pool_fetch_failed"
    | "remote_pool_fetch_error"
    | "remote_batch_items_empty"
    | "batch_run_in_progress"
    | "batch_items_empty";
    plugin?: "remoteBatch";
    remoteUrl?: string;
    status?: number;
    detail?: string;
    state?: ReturnType<PipelineRuntime["pipeline"]["getBatchRunState"]>;
  };

const getRuntimeByPipelineId = (app: PipelineRegistry, pipelineId: string): PipelineRuntime | null =>
  app.getPipelineRuntime(pipelineId);

const normalizeIdentityValue = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

export const normalizePipelineRunIdentityTarget = (target?: PipelineRunIdentityTarget): {
  runId: string | null;
  batchRunId: string | null;
} => ({
  runId: normalizeIdentityValue(target?.runId),
  batchRunId: normalizeIdentityValue(target?.batchRunId),
});

export const extractKeywordPoolFromUnknown = (value: unknown, depth = 0): string[] => {
  if (depth > 5) return [];
  const normalizedDirect = normalizePoolItems(value);
  if (normalizedDirect.length > 0) return normalizedDirect;
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];

  const record = value as Record<string, unknown>;
  // 远端关键词池优先按约定字段提取，兼容现有 list30/list/items 等结构。
  const priorityKeys = ["list30", "list", "keywords", "items", "pool"];
  for (const key of priorityKeys) {
    const candidates = extractKeywordPoolFromUnknown(record[key], depth + 1);
    if (candidates.length > 0) return candidates;
  }

  const mapValue = record.map;
  if (mapValue && typeof mapValue === "object" && !Array.isArray(mapValue)) {
    const mapCandidates = normalizePoolItems(Object.values(mapValue as Record<string, unknown>));
    if (mapCandidates.length > 0) return mapCandidates;
  }

  for (const nested of Object.values(record)) {
    const candidates = extractKeywordPoolFromUnknown(nested, depth + 1);
    if (candidates.length > 0) return candidates;
  }
  return [];
};

export const readNestedValueByPath = (value: unknown, sourceField: string): unknown => {
  const normalizedPath = sourceField.trim();
  if (!normalizedPath) return null;
  const segments = normalizedPath
    .split(".")
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.length === 0) return null;

  let current: unknown = value;
  for (const segment of segments) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return null;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
};

const normalizeBatchSize = (value: unknown): number | undefined => {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.max(1, Math.trunc(value));
};

const normalizeStartIndex = (
  startIndex: unknown,
  startBatch: unknown,
  batchSize?: number,
): number | undefined => {
  if (typeof startIndex === "number" && Number.isFinite(startIndex)) {
    return Math.max(0, Math.trunc(startIndex));
  }
  if (typeof startBatch === "number" && Number.isFinite(startBatch) && typeof batchSize === "number") {
    return Math.max(0, (Math.trunc(startBatch) - 1) * batchSize);
  }
  return undefined;
};

const buildBatchRunId = (pipelineId: string, snapshot: Record<string, unknown>): string => {
  if (typeof snapshot.batchRunId === "string" && snapshot.batchRunId.trim()) {
    return snapshot.batchRunId.trim();
  }
  const startedAt = typeof snapshot.startedAt === "string" && snapshot.startedAt.trim() ? snapshot.startedAt.trim() : String(Date.now());
  return `batch:${pipelineId}:${startedAt}`;
};

const markRunningRunStopped = (run: ReturnType<PipelineRuntime["runtime"]["getRun"]>) => {
  const now = new Date().toISOString();
  // 停止是用户主动中止，不应继续让 queued/blocked 节点保持可调度状态。
  for (const node of run.nodes) {
    if (node.status === "success" || node.status === "failed" || node.status === "rejected" || node.status === "skipped") continue;
    node.status = "stopped";
    node.finishedAt = node.finishedAt ?? now;
    node.lastError = node.lastError ?? "用户手动停止流水线";
  }
  for (const item of run.itemRuns ?? []) {
    if (item.status === "success" || item.status === "failed" || item.status === "rejected" || item.status === "skipped") continue;
    item.status = "stopped";
    item.finishedAt = item.finishedAt ?? now;
    item.lastError = item.lastError ?? "用户手动停止流水线";
  }
  for (const group of run.groups ?? []) {
    if (group.status === "success" || group.status === "failed" || group.status === "rejected" || group.status === "skipped") continue;
    group.status = "stopped";
    group.finishedAt = group.finishedAt ?? now;
    group.lastError = group.lastError ?? "用户手动停止流水线";
  }
  for (const groupItem of run.groupItemRuns ?? []) {
    if (groupItem.status === "success" || groupItem.status === "failed" || groupItem.status === "rejected" || groupItem.status === "skipped") continue;
    groupItem.status = "stopped";
    groupItem.finishedAt = groupItem.finishedAt ?? now;
    groupItem.lastError = groupItem.lastError ?? "用户手动停止流水线";
  }
  run.status = "stopped";
  run.updatedAt = now;
};

export const readPipelineIdentitySnapshot = (
  pipelineId: string,
  run: { id?: string | null } | null | undefined,
  batchRun: { startedAt?: string | null; batchRunId?: string | null } | null | undefined,
): PipelineIdentitySnapshot => {
  if (typeof batchRun?.batchRunId === "string" && batchRun.batchRunId.trim()) {
    return {
      pipelineId,
      runId: normalizeIdentityValue(run?.id),
      batchRunId: batchRun.batchRunId.trim(),
    };
  }
  const startedAt = normalizeIdentityValue(batchRun?.startedAt);
  return {
    pipelineId,
    runId: normalizeIdentityValue(run?.id),
    batchRunId: startedAt ? `batch:${pipelineId}:${startedAt}` : null,
  };
};

export const matchPipelineIdentityTarget = (
  identity: PipelineIdentitySnapshot,
  target?: PipelineRunIdentityTarget,
): {
  ok: true;
  metadata: PipelineIdentityMetadata;
} | {
  ok: false;
  metadata: PipelineIdentityMetadata;
} => {
  const normalizedTarget = normalizePipelineRunIdentityTarget(target);
  const metadata: PipelineIdentityMetadata = {
    ...identity,
    requestedRunId: normalizedTarget.runId,
    requestedBatchRunId: normalizedTarget.batchRunId,
    matchedBy: null,
  };

  if (normalizedTarget.batchRunId) {
    if (identity.batchRunId !== normalizedTarget.batchRunId) {
      return { ok: false, metadata };
    }
    metadata.matchedBy = "batchRunId";
  }
  if (normalizedTarget.runId) {
    if (identity.runId !== normalizedTarget.runId) {
      return { ok: false, metadata };
    }
    metadata.matchedBy = metadata.matchedBy ?? "runId";
  }
  if (!normalizedTarget.batchRunId && !normalizedTarget.runId) {
    metadata.matchedBy = "pipelineId";
  }
  return { ok: true, metadata };
};

const attachIdentityToPipelineStatusResult = (
  result: PipelineStatusBaseResult,
  metadata: PipelineIdentityMetadata,
): PipelineStatusResult => {
  return {
    ...result,
    ...metadata,
  };
};

export const createPipelineService = (app: PipelineRegistry): PipelineService => {
  const listPipelines = (): PipelineListItem[] =>
    app.listPipelines().map((definition) => ({
      id: definition.id,
      title: definition.title,
    }));

  const getPipeline = (pipelineId: string): PipelineDetail | null => {
    const definition = app.getPipelineDefinition(pipelineId);
    const runtime = app.getPipelineRuntime(pipelineId);
    if (!definition || !runtime) return null;
    // 只读 service 直接透出运行态快照，不承担任何写入行为。
    return {
      pipelineId: definition.id,
      title: definition.title,
      run: runtime.runtime.getRun(),
      scheduler: runtime.pipeline.getSchedulerState(),
      batchRun: runtime.pipeline.getBatchRunState(),
      templateNodes: runtime.workflow.getTemplateNodes(),
      workflow: runtime.workflow.getWorkflow(),
    };
  };

  const getTimeline = () => app.runtime.getCombinedTimeline();

  const startPipeline = async (pipelineId: string): Promise<PipelineStartResult> => {
    const runtime = getRuntimeByPipelineId(app, pipelineId);
    if (!runtime) return { ok: false, pipelineId, error: "pipeline_not_found" };

    const batchState = runtime.pipeline.getBatchRunState();
    if (batchState.status === "running") {
      return { ok: false, pipelineId, error: "batch_run_in_progress", state: batchState };
    }

    const workflow = runtime.workflow.getWorkflow();
    const remoteBatchPlugin = workflow.plugins.remoteBatch;
    if (remoteBatchPlugin.enabled) {
      const remoteUrl = remoteBatchPlugin.url.trim() || DEFAULT_REMOTE_BATCH_URL;
      if (!remoteUrl) {
        return { ok: false, pipelineId, error: "remote_pool_url_empty" };
      }

      let remotePayload: unknown = null;
      try {
        const response = await fetch(remoteUrl, { method: "GET" });
        if (!response.ok) {
          return {
            ok: false,
            pipelineId,
            error: "remote_pool_fetch_failed",
            remoteUrl,
            status: response.status,
          };
        }
        const text = await response.text();
        try {
          remotePayload = JSON.parse(text) as unknown;
        } catch {
          // 非 JSON 返回也允许继续尝试解析，兼容逗号/换行文本池。
          remotePayload = text;
        }
      } catch (error) {
        return {
          ok: false,
          pipelineId,
          error: "remote_pool_fetch_error",
          remoteUrl,
          detail: error instanceof Error ? error.message : "unknown_error",
        };
      }

      const preferredPayload = remoteBatchPlugin.sourceField
        ? readNestedValueByPath(remotePayload, remoteBatchPlugin.sourceField)
        : null;
      const items = extractKeywordPoolFromUnknown(preferredPayload ?? remotePayload);
      if (items.length === 0) {
        return { ok: false, pipelineId, error: "remote_batch_items_empty", remoteUrl };
      }

      const batchSize = Math.max(1, remoteBatchPlugin.batchSize || 1);
      const startIndex = Math.max(0, (Math.max(1, remoteBatchPlugin.startBatch || 1) - 1) * batchSize);
      const started = runtime.pipeline.startBatchRun(items, batchSize, { startIndex });
      if (!started.ok) {
        const normalizedError = started.error === "batch_run_in_progress" ? "batch_run_in_progress" : "batch_items_empty";
        return { ok: false, pipelineId, error: normalizedError, state: started.snapshot, remoteUrl };
      }

      runtime.runtime.pushTimeline(
        `[${pipelineId}] 远程关键词池批跑已启动: ${items.length} 个关键词, 每批 ${started.snapshot.batchSize} 个`,
        "info",
        { remoteUrl },
      );
      return {
        ok: true,
        mode: "remote_batch",
        pipelineId,
        accepted: true,
        batchRunId: buildBatchRunId(pipelineId, started.snapshot),
        runId: runtime.runtime.getRun()?.id ?? null,
        remoteUrl,
        totalFetched: items.length,
        batchRun: started.snapshot,
        templateNodes: runtime.workflow.getTemplateNodes(),
        edges: runtime.workflow.getWorkflow().edges,
        workflowNodes: runtime.workflow.getWorkflow().nodes,
      };
    }

    const run = runtime.runtime.seedRun(runtime.workflow.getTemplateNodes());
    runtime.runtime.setRun(run);
    runtime.runtime.pushTimeline(`[${pipelineId}] 已启动新运行: ${run.id}`);
    runtime.runtime.emitPipeline();
    // start 只负责发起运行，不承诺在返回时已执行完成。
    void runtime.pipeline.drainPipeline(`run:start:${run.id}`).then(() => {
      runtime.runtime.touchRun(runtime.runtime.getRun());
    });
    return { ok: true, mode: "single", pipelineId, accepted: true, runId: run.id, run: runtime.runtime.getRun(), workflowNodes: runtime.workflow.getWorkflow().nodes };
  };

  const getPipelineExecutionStatus = (pipelineId: string, target?: PipelineRunIdentityTarget): PipelineStatusResult => {
    const detail = getPipeline(pipelineId);
    if (!detail) {
      const missingIdentity = readPipelineIdentitySnapshot(pipelineId, null, null);
      return {
        ...matchPipelineIdentityTarget(missingIdentity, target).metadata,
        ok: false,
        error: "pipeline_not_found",
      };
    }
    const identity = readPipelineIdentitySnapshot(pipelineId, detail.run, detail.batchRun);
    const matchedIdentity = matchPipelineIdentityTarget(identity, target);
    if (!matchedIdentity.ok) {
      return {
        ...matchedIdentity.metadata,
        ok: false,
        error: "run_not_found",
      };
    }
    // status 命令只表达“当前是否仍在运行”，非运行态改为返回精简联合结构。
    return attachIdentityToPipelineStatusResult(buildPipelineStatusResult({
      pipelineId,
      run: detail.run,
      scheduler: detail.scheduler,
      batchRun: detail.batchRun,
    }), matchedIdentity.metadata);
  };

  const stopPipeline = (pipelineId: string, target?: PipelineRunIdentityTarget): PipelineStopResult => {
    const runtime = getRuntimeByPipelineId(app, pipelineId);
    const missingIdentity = readPipelineIdentitySnapshot(
      pipelineId,
      runtime?.runtime.getRun(),
      runtime?.pipeline.getBatchRunState(),
    );
    if (!runtime) {
      return {
        ...matchPipelineIdentityTarget(missingIdentity, target).metadata,
        ok: false,
        error: "pipeline_not_found",
      };
    }
    const runState = runtime.runtime.getRun();
    const batchRunState = runtime.pipeline.getBatchRunState();
    const identity = readPipelineIdentitySnapshot(pipelineId, runState, batchRunState);
    const matchedIdentity = matchPipelineIdentityTarget(identity, target);
    if (!matchedIdentity.ok) {
      return {
        ...matchedIdentity.metadata,
        ok: false,
        error: "run_not_found",
      };
    }
    if (batchRunState.status !== "running") {
      const currentStatus = getPipelineExecutionStatus(pipelineId, target);
      if (currentStatus.ok && "status" in currentStatus && currentStatus.status.runStatus === "running") {
        if (runState.id) {
          runtime.pipeline.abortRunControllers(runState.id);
        }
        markRunningRunStopped(runState);
        runtime.runtime.pushTimeline(`[${pipelineId}] 已请求停止单次运行: ${runState.id}`, "warn");
        runtime.runtime.emitPipeline();
        const stoppedStatus = buildPipelineExecutionStatus({
          pipelineId,
          run: runState,
          scheduler: runtime.pipeline.getSchedulerState(),
          batchRun: runtime.pipeline.getBatchRunState(),
        });
        return {
          ...matchedIdentity.metadata,
          ok: true,
          mode: "single",
          status: stoppedStatus,
        };
      }
      return {
        ...matchedIdentity.metadata,
        ok: false,
        error: "batch_run_not_running",
        status: currentStatus.ok && "status" in currentStatus ? currentStatus.status : undefined,
      };
    }
    const stopped = runtime.pipeline.stopBatchRun();
    if (!stopped.ok) {
      return {
        ...matchedIdentity.metadata,
        ok: false,
        error: "batch_run_not_running",
      };
    }
    // 中止当前正在执行的节点，同时向远端 agent 发送 /stop 命令
    if (runState.id) {
      runtime.pipeline.abortRunControllers(runState.id);
    }
    const currentStatus = getPipelineExecutionStatus(pipelineId, target);
    return {
      ...matchedIdentity.metadata,
      ok: true,
      mode: "remote_batch",
      stopped,
      status: currentStatus.ok && "status" in currentStatus
        ? currentStatus.status
        : {
          pipelineId,
            mode: "remote_batch",
            running: true,
            runId: null,
            runStatus: "running",
            activeNodeIds: [],
            pendingNodeIds: [],
            scheduler: runtime.pipeline.getSchedulerState(),
            batchRun: runtime.pipeline.getBatchRunState(),
            currentBatch: null,
            lastError: null,
            updatedAt: new Date().toISOString(),
          },
    };
  };

  const runPipeline = async (pipelineId: string): Promise<PipelineRunResult> => {
    // run 仅作为兼容入口，语义等价到 start。
    return startPipeline(pipelineId);
  };

  const startBatchRun = (input: PipelineStartBatchInput): PipelineStartBatchResult => {
    const runtime = getRuntimeByPipelineId(app, input.pipelineId);
    if (!runtime) return { ok: false, pipelineId: input.pipelineId, error: "pipeline_not_found" };
    if (input.items.length === 0) return { ok: false, pipelineId: input.pipelineId, error: "batch_items_empty" };
    const batchSize = normalizeBatchSize(input.batchSize);
    const startIndex = normalizeStartIndex(input.startIndex, input.startBatch, batchSize);
    const started = runtime.pipeline.startBatchRun(input.items, batchSize, startIndex !== undefined ? { startIndex } : undefined);
    if (!started.ok) {
      return {
        ok: false,
        pipelineId: input.pipelineId,
        error: started.error === "batch_run_in_progress" ? "batch_run_in_progress" : "batch_items_empty",
        state: started.snapshot,
      };
    }
    return { ok: true, pipelineId: input.pipelineId, state: started.snapshot };
  };

  const startRemoteBatchRun = async (input: PipelineStartRemoteBatchInput): Promise<PipelineStartRemoteBatchResult> => {
    const runtime = getRuntimeByPipelineId(app, input.pipelineId);
    if (!runtime) return { ok: false, pipelineId: input.pipelineId, error: "pipeline_not_found" };
    const remoteBatchPlugin = runtime.workflow.getWorkflow().plugins.remoteBatch;
    if (!remoteBatchPlugin.enabled) {
      return { ok: false, pipelineId: input.pipelineId, error: "pipeline_plugin_disabled", plugin: "remoteBatch" };
    }

    const remoteUrl = typeof input.url === "string" && input.url.trim()
      ? input.url.trim()
      : remoteBatchPlugin.url.trim() || DEFAULT_REMOTE_BATCH_URL;
    if (!remoteUrl) {
      return { ok: false, pipelineId: input.pipelineId, error: "remote_pool_url_empty" };
    }

    let remotePayload: unknown = null;
    try {
      const response = await fetch(remoteUrl, { method: "GET" });
      if (!response.ok) {
        return { ok: false, pipelineId: input.pipelineId, error: "remote_pool_fetch_failed", remoteUrl, status: response.status };
      }
      const text = await response.text();
      try {
        remotePayload = JSON.parse(text) as unknown;
      } catch {
        // 非 JSON 文本也允许继续解析，避免上游切到纯文本池时整条批跑入口不可用。
        remotePayload = text;
      }
    } catch (error) {
      return {
        ok: false,
        pipelineId: input.pipelineId,
        error: "remote_pool_fetch_error",
        remoteUrl,
        detail: error instanceof Error ? error.message : "unknown_error",
      };
    }

    // sourceField 视为“优先路径”而非严格依赖：路径缺失时退回全量解析以保持兼容。
    const preferredPayload = remoteBatchPlugin.sourceField
      ? readNestedValueByPath(remotePayload, remoteBatchPlugin.sourceField)
      : null;
    const items = extractKeywordPoolFromUnknown(preferredPayload ?? remotePayload);
    if (items.length === 0) {
      return { ok: false, pipelineId: input.pipelineId, error: "remote_batch_items_empty", remoteUrl };
    }

    const batchSize = normalizeBatchSize(input.batchSize) ?? remoteBatchPlugin.batchSize ?? 5;
    const startIndex = normalizeStartIndex(input.startIndex, input.startBatch, batchSize);
    const started = runtime.pipeline.startBatchRun(items, batchSize, startIndex !== undefined ? { startIndex } : undefined);
    if (!started.ok) {
      return {
        ok: false,
        pipelineId: input.pipelineId,
        error: started.error === "batch_run_in_progress" ? "batch_run_in_progress" : "batch_items_empty",
        state: started.snapshot,
        remoteUrl,
      };
    }
    runtime.runtime.pushTimeline(
      `[${input.pipelineId}] 远程关键词池批跑已启动: ${items.length} 个关键词, 每批 ${started.snapshot.batchSize} 个`,
      "info",
      { remoteUrl },
    );
    return {
      ok: true,
      pipelineId: input.pipelineId,
      state: started.snapshot,
      remoteUrl,
      totalFetched: items.length,
    };
  };

  const retryNode = async (input: PipelineRetryInput): Promise<PipelineRetryResult> => {
    const runtime = getRuntimeByPipelineId(app, input.pipelineId);
    if (!runtime) return { ok: false, pipelineId: input.pipelineId, error: "pipeline_not_found" };
    // 中止当前正在执行的节点，避免旧节点与新重试冲突（同时向远端 agent 发送 /stop 命令）
    const runState = runtime.runtime.getRun();
    if (runState.id) {
      runtime.pipeline.abortRunControllers(runState.id);
    }
    const retry = await runtime.pipeline.retryNodeExecution(input.nodeId, input.itemKey);
    const run = runtime.runtime.getRun();
    runtime.runtime.touchRun(run);
    return { ok: true, pipelineId: input.pipelineId, run, retry };
  };

  const listOutputs = async (pipelineId: string): Promise<PipelineOutput[]> => {
    const runtime = app.getPipelineRuntime(pipelineId);
    if (!runtime) return [];
    return runtime.output.list();
  };

  const getOutput = async (pipelineId: string, runId?: string): Promise<PipelineOutput | null> => {
    const runtime = app.getPipelineRuntime(pipelineId);
    if (!runtime) return null;
    if (runId) return runtime.output.getByRunId(runId);
    const outputs = await runtime.output.list();
    return outputs.length > 0 ? outputs[outputs.length - 1] : null;
  };

  const listLinks = async (): Promise<PipelineLink[]> => app.dispatch.listLinks();

  const getQueue = (pipelineId: string): PipelineInboundJob[] => app.dispatch.getQueue(pipelineId);

  const cancelJob = async (pipelineId: string, jobId: string, reason?: string) =>
    app.dispatch.cancelJob(jobId, reason ?? "canceled_by_user");

  const retryJob = async (pipelineId: string, jobId: string) =>
    app.dispatch.retryJob(jobId);

  return {
    listPipelines,
    getPipeline,
    getTimeline,
    startPipeline,
    getPipelineExecutionStatus,
    stopPipeline,
    runPipeline,
    startBatchRun,
    startRemoteBatchRun,
    retryNode,
    listOutputs,
    getOutput,
    listLinks,
    getQueue,
    cancelJob,
    retryJob,
  };
};
