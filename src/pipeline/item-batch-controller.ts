export type ItemBatchRunStatus = "idle" | "running" | "completed" | "failed" | "stopped";

export type ItemBatchRunSnapshot = {
  status: ItemBatchRunStatus;
  batchSize: number;
  totalItems: number;
  totalBatches: number;
  processedItems: number;
  processedBatches: number;
  nextBatchIndex: number;
  currentBatchIndex: number | null;
  currentBatchItemKey: string | null;
  currentBatchItems: string[];
  startedAt: string | null;
  finishedAt: string | null;
  lastBatchItems: string[];
  error: string | null;
  stopRequested: boolean;
  batchRunId: string | null;
};

export type ExecuteBatchInput = {
  batchItems: string[];
  batchIndex: number;
  totalBatches: number;
  totalItems: number;
};

type ExecuteBatchResult = {
  ok: boolean;
  error?: string;
  hardStop?: boolean;
};

type CreateItemBatchControllerDeps = {
  pipelineId: string;
  executeBatch: (input: ExecuteBatchInput) => Promise<ExecuteBatchResult>;
};

type StartBatchRunOptions = {
  startIndex?: number;
};

const DEFAULT_BATCH_SIZE = 10;

const clampBatchSize = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_BATCH_SIZE;
  return Math.min(200, Math.max(1, Math.trunc(value)));
};

const clampStartIndex = (value: unknown, total: number): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.min(Math.max(0, Math.trunc(value)), Math.max(0, total));
};

const createIdleSnapshot = (): ItemBatchRunSnapshot => ({
  status: "idle",
  batchSize: DEFAULT_BATCH_SIZE,
  totalItems: 0,
  totalBatches: 0,
  processedItems: 0,
  processedBatches: 0,
  nextBatchIndex: 1,
  currentBatchIndex: null,
  currentBatchItemKey: null,
  currentBatchItems: [],
  startedAt: null,
  finishedAt: null,
  lastBatchItems: [],
  error: null,
  stopRequested: false,
  batchRunId: null,
});

const cloneSnapshot = (snapshot: ItemBatchRunSnapshot): ItemBatchRunSnapshot => ({
  ...snapshot,
  currentBatchItems: [...snapshot.currentBatchItems],
  lastBatchItems: [...snapshot.lastBatchItems],
});

export const normalizePoolItems = (value: unknown): string[] => {
  const rawList: string[] = [];
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry === "string") rawList.push(entry);
    }
  } else if (typeof value === "string") {
    // Support mixed comma and newline input for easy pasting of keyword pools.
    rawList.push(...value.split(/[\n,]/g));
  }
  const unique = new Set<string>();
  for (const item of rawList) {
    const normalized = item.trim();
    if (!normalized) continue;
    unique.add(normalized);
  }
  return [...unique];
};

import { buildBatchRunId } from "./identity";

export const createItemBatchController = (deps: CreateItemBatchControllerDeps) => {
  let snapshot = createIdleSnapshot();
  let runToken = 0;
  let hasBatchErrors = false;

  const runLoop = async (token: number, queue: string[]) => {
    while (queue.length > 0) {
      if (token !== runToken) return;
      if (snapshot.stopRequested) {
        snapshot = {
          ...snapshot,
          status: "stopped",
          finishedAt: new Date().toISOString(),
        };
        return;
      }

      const currentBatchItems = queue.splice(0, snapshot.batchSize);
      const currentBatchIndex = snapshot.processedBatches + 1;
      snapshot = {
        ...snapshot,
        currentBatchIndex,
        currentBatchItemKey: `batch-${currentBatchIndex}`,
        currentBatchItems: [...currentBatchItems],
        lastBatchItems: [...currentBatchItems],
      };

      let result: ExecuteBatchResult;
      try {
        result = await deps.executeBatch({
          batchItems: currentBatchItems,
          batchIndex: currentBatchIndex,
          totalBatches: snapshot.totalBatches,
          totalItems: snapshot.totalItems,
        });
      } catch (error) {
        // The batch-run controller runs outside HTTP requests; if an exception escapes here, the snapshot would permanently stay at running,
        // and subsequent start() calls would falsely detect an existing batch run in progress. Must guard the state inside the controller.
        if (token !== runToken) return;
        hasBatchErrors = true;
        snapshot = {
          ...snapshot,
          status: "failed",
          currentBatchIndex: null,
          currentBatchItemKey: null,
          currentBatchItems: [],
          error: error instanceof Error ? error.message : String(error),
          finishedAt: new Date().toISOString(),
        };
        return;
      }

      if (token !== runToken) return;

      snapshot = {
        ...snapshot,
        processedBatches: snapshot.processedBatches + 1,
        processedItems: snapshot.processedItems + currentBatchItems.length,
        nextBatchIndex: snapshot.processedBatches + 2,
        currentBatchIndex: null,
        currentBatchItemKey: null,
        currentBatchItems: [],
      };

      if (!result.ok) {
        hasBatchErrors = true;
        snapshot = {
          ...snapshot,
          error: result.error ?? "batch_execute_failed",
        };
        if (result.hardStop) {
          snapshot = {
            ...snapshot,
            status: "failed",
            currentBatchIndex: null,
            currentBatchItemKey: null,
            currentBatchItems: [],
            finishedAt: new Date().toISOString(),
          };
          return;
        }
      }
    }

    if (token !== runToken) return;
    snapshot = {
      ...snapshot,
      status: hasBatchErrors ? "failed" : "completed",
      currentBatchIndex: null,
      currentBatchItemKey: null,
      currentBatchItems: [],
      finishedAt: new Date().toISOString(),
      nextBatchIndex: snapshot.processedBatches + 1,
    };
  };

  const start = (items: string[], batchSize?: number, options?: StartBatchRunOptions) => {
    if (snapshot.status === "running") {
      return { ok: false as const, error: "batch_run_in_progress", snapshot: cloneSnapshot(snapshot) };
    }
    if (items.length === 0) {
      return { ok: false as const, error: "batch_items_empty", snapshot: cloneSnapshot(snapshot) };
    }

    const normalizedBatchSize = clampBatchSize(batchSize);
    const totalBatches = Math.ceil(items.length / normalizedBatchSize);
    const startIndex = clampStartIndex(options?.startIndex, items.length);
    const queuedItems = items.slice(startIndex);
    const processedBatches = Math.floor(startIndex / normalizedBatchSize);
    runToken += 1;
    hasBatchErrors = false;
    const batchRunId = buildBatchRunId(deps.pipelineId);
    snapshot = {
      status: "running",
      batchSize: normalizedBatchSize,
      totalItems: items.length,
      totalBatches,
      processedItems: startIndex,
      processedBatches,
      nextBatchIndex: processedBatches + 1,
      currentBatchIndex: null,
      currentBatchItemKey: null,
      currentBatchItems: [],
      startedAt: new Date().toISOString(),
      finishedAt: null,
      lastBatchItems: [],
      error: null,
      stopRequested: false,
      batchRunId,
    };

    // Run asynchronously in the background to avoid blocking the HTTP request.
    void runLoop(runToken, [...queuedItems]);
    return { ok: true as const, snapshot: cloneSnapshot(snapshot) };
  };

  const stop = () => {
    if (snapshot.status !== "running") {
      return { ok: false as const, error: "batch_run_not_running", snapshot: cloneSnapshot(snapshot) };
    }
    // Only request stop; the current batch will exit safely after completion.
    snapshot = {
      ...snapshot,
      stopRequested: true,
    };
    return { ok: true as const, snapshot: cloneSnapshot(snapshot) };
  };

  const cancel = () => {
    if (snapshot.status !== "running") {
      return { ok: false as const, error: "batch_run_not_running", snapshot: cloneSnapshot(snapshot) };
    }
    // When the plugin is disabled, the running batch controller should not be retained; switch runToken to invalidate old loop results.
    runToken += 1;
    snapshot = {
      ...snapshot,
      status: "stopped",
      currentBatchIndex: null,
      currentBatchItemKey: null,
      currentBatchItems: [],
      stopRequested: false,
      finishedAt: new Date().toISOString(),
    };
    return { ok: true as const, snapshot: cloneSnapshot(snapshot) };
  };

  const getSnapshot = () => cloneSnapshot(snapshot);

  return {
    start,
    stop,
    cancel,
    getSnapshot,
  };
};
