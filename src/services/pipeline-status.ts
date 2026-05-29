import {
  buildPipelineExecutionStatus,
  type PipelineExecutionStatusPayload,
} from "../pipeline/execution-status";

type TimestampedRecord = Record<string, unknown> & {
  finishedAt?: string | null;
};

type RunLike = Record<string, unknown> & {
  status?: string | null;
  updatedAt?: string | null;
  nodes?: TimestampedRecord[] | null;
  itemRuns?: TimestampedRecord[] | null;
  groups?: TimestampedRecord[] | null;
  groupItemRuns?: TimestampedRecord[] | null;
};

type BatchRunLike = {
  status?: string | null;
  finishedAt?: string | null;
};

export type PipelineStatusRunningResult<TScheduler = unknown, TBatchRun = unknown> = {
  ok: true;
  status: PipelineExecutionStatusPayload<TScheduler, TBatchRun> & {
    mode: "single" | "remote_batch";
    running: true;
  };
};

export type PipelineStatusIdleResult = {
  ok: true;
  pipelineId: string;
  running: false;
  message: "no active pipeline run";
  lastCompletedAt: string | null;
  lastRunId: string | null;
  lastBatchRunId: string | null;
};

export type PipelineStatusNotFoundResult = {
  ok: false;
  pipelineId: string;
  error: "pipeline_not_found";
};

export type PipelineStatusResult<TScheduler = unknown, TBatchRun = unknown> =
  | PipelineStatusRunningResult<TScheduler, TBatchRun>
  | PipelineStatusIdleResult
  | PipelineStatusNotFoundResult;

type BuildableRun = Parameters<typeof buildPipelineExecutionStatus>[0]["run"];

type BuildPipelineStatusResultInput<TScheduler, TBatchRun> = {
  pipelineId: string;
  run: RunLike;
  scheduler: TScheduler;
  batchRun: TBatchRun;
};

const isNonEmptyString = (value: unknown): value is string => {
  return typeof value === "string" && value.trim().length > 0;
};

const parseTimestamp = (value: unknown): number | null => {
  if (!isNonEmptyString(value)) return null;
  const parsed = Date.parse(value.trim());
  return Number.isFinite(parsed) ? parsed : null;
};

const pickLatestTimestamp = (candidates: unknown[]): string | null => {
  let best: { iso: string; ms: number } | null = null;
  for (const candidate of candidates) {
    if (!isNonEmptyString(candidate)) continue;
    const normalized = candidate.trim();
    const ms = parseTimestamp(normalized);
    if (ms === null) continue;
    if (!best || ms > best.ms) {
      best = { iso: normalized, ms };
    }
  }
  return best?.iso ?? null;
};

const collectFinishedAtValues = (items: TimestampedRecord[] | null | undefined): string[] => {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => item.finishedAt)
    .filter((value): value is string => isNonEmptyString(value))
    .map((value) => value.trim());
};

const isRunTerminal = (run: RunLike): boolean => {
  return run.status === "success" || run.status === "failed" || run.status === "stopped";
};

const isBatchTerminal = (batchRun: unknown): batchRun is BatchRunLike => {
  if (!batchRun || typeof batchRun !== "object") return false;
  const status = (batchRun as BatchRunLike).status;
  return status === "completed" || status === "failed" || status === "stopped";
};

export const readPipelineLastCompletedAt = (run: RunLike, batchRun: unknown): string | null => {
  const candidates: string[] = [];

  // 只有确认 run 已进入终态后，才允许把 updatedAt 视作完成时间候选。
  if (isRunTerminal(run) && isNonEmptyString(run.updatedAt)) {
    candidates.push(run.updatedAt.trim());
  }
  candidates.push(...collectFinishedAtValues(run.nodes));
  candidates.push(...collectFinishedAtValues(run.itemRuns));
  candidates.push(...collectFinishedAtValues(run.groups));
  candidates.push(...collectFinishedAtValues(run.groupItemRuns));

  // 批跑完成时间应来自控制器真实终态，而不是运行中的快照更新时间。
  if (isBatchTerminal(batchRun) && isNonEmptyString(batchRun.finishedAt)) {
    candidates.push(batchRun.finishedAt.trim());
  }

  return pickLatestTimestamp(candidates);
};

export const buildPipelineStatusResult = <TScheduler, TBatchRun>(
  input: BuildPipelineStatusResultInput<TScheduler, TBatchRun>,
): PipelineStatusResult<TScheduler, TBatchRun> => {
  const status = buildPipelineExecutionStatus({
    pipelineId: input.pipelineId,
    // 这里直接复用 execution-status 作为运行态快照构造器，保证 status 字段来源仍然唯一。
    run: input.run as BuildableRun,
    scheduler: input.scheduler,
    batchRun: input.batchRun,
  });

  if (status.running) {
    // status.running=true 时，mode 只能是 single 或 remote_batch；这里显式收窄给 CLI/API 统一消费。
    return {
      ok: true,
      status: {
        ...status,
        mode: status.mode === "remote_batch" ? "remote_batch" : "single",
        running: true,
      },
    };
  }

  const batchRunRecord = input.batchRun && typeof input.batchRun === "object" ? (input.batchRun as Record<string, unknown>) : null;
  return {
    ok: true,
    pipelineId: input.pipelineId,
    running: false,
    message: "no active pipeline run",
    lastCompletedAt: readPipelineLastCompletedAt(input.run, input.batchRun),
    lastRunId: isNonEmptyString(input.run.id) ? input.run.id.trim() : null,
    lastBatchRunId: isNonEmptyString(batchRunRecord?.batchRunId) ? String(batchRunRecord.batchRunId).trim() : null,
  };
};
