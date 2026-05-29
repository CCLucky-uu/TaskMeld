type PipelineExecutionNodeLike = {
  id?: string | null;
  status?: string | null;
  lastError?: string | null;
};

type PipelineExecutionItemRunLike = {
  itemKey?: string | null;
  nodeId?: string | null;
  status?: string | null;
};

type PipelineExecutionGroupItemRunLike = {
  itemKey?: string | null;
  groupId?: string | null;
  status?: string | null;
};

type PipelineExecutionRunLike = {
  id?: string | null;
  status?: string | null;
  updatedAt?: string | null;
  nodes?: PipelineExecutionNodeLike[] | null;
  itemRuns?: PipelineExecutionItemRunLike[] | null;
  groupItemRuns?: PipelineExecutionGroupItemRunLike[] | null;
};

export type PipelineCurrentBatchProgress = {
  index: number | null;
  itemKey: string | null;
  items: string[];
  runningNodeIds: string[];
  pendingNodeIds: string[];
  completedNodeIds: string[];
  failedNodeIds: string[];
  runningGroupIds: string[];
  pendingGroupIds: string[];
  completedGroupIds: string[];
  failedGroupIds: string[];
};

export type PipelineExecutionStatusPayload<TScheduler = unknown, TBatchRun = unknown> = {
  pipelineId: string;
  mode: "idle" | "single" | "remote_batch";
  running: boolean;
  runId: string | null;
  runStatus: "running" | "success" | "failed" | "stopped";
  activeNodeIds: string[];
  pendingNodeIds: string[];
  scheduler: TScheduler;
  batchRun: TBatchRun;
  currentBatch: PipelineCurrentBatchProgress | null;
  lastError: string | null;
  updatedAt: string;
};

type BuildPipelineExecutionStatusInput<TScheduler, TBatchRun> = {
  pipelineId: string;
  run: PipelineExecutionRunLike;
  scheduler: TScheduler;
  batchRun: TBatchRun;
};

const isNonEmptyString = (value: unknown): value is string => {
  return typeof value === "string" && value.trim().length > 0;
};

const normalizeIdList = (items: string[]): string[] => [...new Set(items.filter(Boolean))];

const readCurrentBatchProgress = (run: PipelineExecutionRunLike, batchRun: unknown): PipelineCurrentBatchProgress | null => {
  const batchRecord = batchRun && typeof batchRun === "object" ? (batchRun as Record<string, unknown>) : null;
  const currentBatchItemKey = isNonEmptyString(batchRecord?.currentBatchItemKey) ? batchRecord.currentBatchItemKey.trim() : null;
  const currentBatchIndex =
    typeof batchRecord?.currentBatchIndex === "number" && Number.isFinite(batchRecord.currentBatchIndex)
      ? Math.trunc(batchRecord.currentBatchIndex)
      : null;
  const currentBatchItems = Array.isArray(batchRecord?.currentBatchItems)
    ? batchRecord.currentBatchItems.filter((item): item is string => isNonEmptyString(item)).map((item) => item.trim())
    : [];

  if (!currentBatchItemKey && currentBatchIndex === null && currentBatchItems.length === 0) {
    return null;
  }

  const itemRuns = Array.isArray(run.itemRuns) ? run.itemRuns : [];
  const groupItemRuns = Array.isArray(run.groupItemRuns) ? run.groupItemRuns : [];
  const currentItemRuns = itemRuns.filter((item) => item.itemKey === currentBatchItemKey);
  const currentGroupItemRuns = groupItemRuns.filter((item) => item.itemKey === currentBatchItemKey);

  const runningNodeIds = normalizeIdList(
    currentItemRuns
      .filter((item) => item.status === "running")
      .map((item) => String(item.nodeId ?? "").trim()),
  );
  const pendingNodeIds = normalizeIdList(
    currentItemRuns
      .filter((item) => item.status === "queued" || item.status === "waiting" || item.status === "blocked")
      .map((item) => String(item.nodeId ?? "").trim()),
  );
  const completedNodeIds = normalizeIdList(
    currentItemRuns
      .filter((item) => item.status === "success" || item.status === "skipped")
      .map((item) => String(item.nodeId ?? "").trim()),
  );
  const failedNodeIds = normalizeIdList(
    currentItemRuns
      .filter((item) => item.status === "failed" || item.status === "rejected" || item.status === "stopped")
      .map((item) => String(item.nodeId ?? "").trim()),
  );
  const runningGroupIds = normalizeIdList(
    currentGroupItemRuns
      .filter((item) => item.status === "running")
      .map((item) => String(item.groupId ?? "").trim()),
  );
  const pendingGroupIds = normalizeIdList(
    currentGroupItemRuns
      .filter((item) => item.status === "queued" || item.status === "waiting" || item.status === "blocked")
      .map((item) => String(item.groupId ?? "").trim()),
  );
  const completedGroupIds = normalizeIdList(
    currentGroupItemRuns
      .filter((item) => item.status === "success" || item.status === "skipped")
      .map((item) => String(item.groupId ?? "").trim()),
  );
  const failedGroupIds = normalizeIdList(
    currentGroupItemRuns
      .filter((item) => item.status === "failed" || item.status === "rejected" || item.status === "stopped")
      .map((item) => String(item.groupId ?? "").trim()),
  );

  return {
    index: currentBatchIndex,
    itemKey: currentBatchItemKey,
    items: currentBatchItems,
    runningNodeIds,
    pendingNodeIds,
    completedNodeIds,
    failedNodeIds,
    runningGroupIds,
    pendingGroupIds,
    completedGroupIds,
    failedGroupIds,
  };
};

export const buildPipelineExecutionStatus = <TScheduler, TBatchRun>(
  input: BuildPipelineExecutionStatusInput<TScheduler, TBatchRun>,
): PipelineExecutionStatusPayload<TScheduler, TBatchRun> => {
  const runNodes = Array.isArray(input.run.nodes) ? input.run.nodes : [];
  const batchRunRecord =
    input.batchRun && typeof input.batchRun === "object" ? (input.batchRun as Record<string, unknown>) : null;
  const batchStatus = typeof batchRunRecord?.status === "string" ? batchRunRecord.status : null;
  const batchError = typeof batchRunRecord?.error === "string" ? batchRunRecord.error : null;
  const isBatchRunning = batchStatus === "running";
  const isSingleRunning = input.run.status === "running";
  const activeNodeIds = runNodes
    .filter((node) => node.status === "running")
    .map((node) => String(node.id ?? "").trim())
    .filter(Boolean);
  const pendingNodeIds = runNodes
    .filter((node) => node.status === "queued" || node.status === "waiting" || node.status === "blocked")
    .map((node) => String(node.id ?? "").trim())
    .filter(Boolean);
  const firstNodeError =
    runNodes.find((node) => isNonEmptyString(node.lastError))?.lastError?.trim() ?? null;
  const currentBatch = readCurrentBatchProgress(input.run, input.batchRun);

  return {
    pipelineId: input.pipelineId,
    mode: isBatchRunning ? "remote_batch" : isSingleRunning ? "single" : "idle",
    running: Boolean(isBatchRunning || isSingleRunning),
    runId: isNonEmptyString(input.run.id) ? input.run.id.trim() : null,
    runStatus:
      input.run.status === "running" || input.run.status === "success" || input.run.status === "failed"
        ? input.run.status
        : "stopped",
    activeNodeIds,
    pendingNodeIds,
    scheduler: input.scheduler,
    batchRun: input.batchRun,
    currentBatch,
    lastError: batchError ?? firstNodeError,
    updatedAt: isNonEmptyString(input.run.updatedAt) ? input.run.updatedAt.trim() : new Date().toISOString(),
  };
};
