import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import type { PipelineInboundJob, PipelineInboundJobStatus, PipelineInboundQueueEvent } from "../types/pipeline-link";
import { buildJobId } from "../types/pipeline-link";
import { resolveTaskMeldDataPath } from "../../app/data-dir";

const QUEUE_FILE = resolveTaskMeldDataPath("pipeline-inbound-queue.jsonl");
const MAX_COMPLETED_JOBS = 500;
const COMPACT_TRIGGER_EVENT_COUNT = 2000;

const pruneCompletedJobs = (snapshot: Map<string, PipelineInboundJob>) => {
  const completed: PipelineInboundJob[] = [];
  for (const job of snapshot.values()) {
    if (job.status === "success" || job.status === "failed" || job.status === "canceled") {
      completed.push(job);
    }
  }
  if (completed.length <= MAX_COMPLETED_JOBS) return;
  completed.sort((a, b) => (a.finishedAt ?? "").localeCompare(b.finishedAt ?? ""));
  const toDelete = completed.length - MAX_COMPLETED_JOBS;
  for (let i = 0; i < toDelete; i++) {
    snapshot.delete(completed[i].jobId);
  }
};

export type PipelineInboundQueue = {
  getJobs: (toPipelineId: string) => PipelineInboundJob[];
  getPendingJobs: (toPipelineId: string) => PipelineInboundJob[];
  getRunningJob: (toPipelineId: string) => PipelineInboundJob | null;
  getJobById: (jobId: string) => PipelineInboundJob | null;
  getJobCount: (toPipelineId: string) => number;
  getPendingCount: (toPipelineId: string) => number;
  appendEvent: (event: PipelineInboundQueueEvent) => Promise<void>;
  cancelJob: (jobId: string, reason: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  retryJob: (jobId: string) => Promise<{ ok: true; job: PipelineInboundJob } | { ok: false; error: string }>;
  getJobSnapshot: () => Map<string, PipelineInboundJob>;
  initialize: () => Promise<void>;
};

export const createPipelineInboundQueue = (): PipelineInboundQueue => {
  let jobSnapshot = new Map<string, PipelineInboundJob>();

  const replay = async (): Promise<void> => {
    const newSnapshot = new Map<string, PipelineInboundJob>();
    try {
      const raw = await readFile(QUEUE_FILE, "utf8");
      const lines = raw.trim().split("\n").filter(Boolean);
      for (const line of lines) {
        try {
          const event = JSON.parse(line) as PipelineInboundQueueEvent;
          applyEvent(event, newSnapshot);
        } catch {
          // Skip malformed lines
        }
      }
    } catch {
      // File not found, start empty
    }
    // 重放后自动回收"running"状态的 job：这些 job 属于上次进程崩溃前已启动但未完成的任务，
    // 恢复为 pending 并清空 targetRunId，让 drainer 重新调度执行。
    for (const [jobId, job] of newSnapshot) {
      if (job.status === "running") {
        newSnapshot.set(jobId, {
          ...job,
          status: "pending",
          targetRunId: null,
          startedAt: null,
          error: "recovered_after_crash",
        });
      }
    }
    jobSnapshot = newSnapshot;
  };

  const applyEvent = (event: PipelineInboundQueueEvent, snapshot: Map<string, PipelineInboundJob>) => {
    const now = new Date().toISOString();
    switch (event.type) {
      case "job.created": {
        snapshot.set(event.job.jobId, { ...event.job });
        break;
      }
      case "job.running": {
        const job = snapshot.get(event.jobId);
        if (job) {
          snapshot.set(event.jobId, {
            ...job,
            status: "running",
            targetRunId: event.targetRunId,
            startedAt: event.at,
            attempts: job.attempts + 1,
          });
        }
        break;
      }
      case "job.success": {
        const job = snapshot.get(event.jobId);
        if (job) {
          snapshot.set(event.jobId, {
            ...job,
            status: "success",
            finishedAt: event.at,
          });
        }
        pruneCompletedJobs(snapshot);
        break;
      }
      case "job.failed": {
        const job = snapshot.get(event.jobId);
        if (job) {
          snapshot.set(event.jobId, {
            ...job,
            status: "failed",
            targetRunId: event.targetRunId ?? job.targetRunId,
            finishedAt: event.at,
            error: event.error,
          });
        }
        pruneCompletedJobs(snapshot);
        break;
      }
      case "job.canceled": {
        const job = snapshot.get(event.jobId);
        if (job) {
          snapshot.set(event.jobId, {
            ...job,
            status: "canceled",
            finishedAt: event.at,
          });
        }
        pruneCompletedJobs(snapshot);
        break;
      }
      case "job.retry_requested": {
        const job = snapshot.get(event.jobId);
        if (job) {
          snapshot.set(event.jobId, {
            ...job,
            status: "pending",
            targetRunId: null,
            startedAt: null,
            finishedAt: null,
            error: null,
          });
        }
        break;
      }
    }
  };

  const persistEvent = async (event: PipelineInboundQueueEvent): Promise<void> => {
    await mkdir(resolveTaskMeldDataPath(), { recursive: true });
    const line = JSON.stringify(event) + "\n";
    await appendFile(QUEUE_FILE, line, "utf8");
  };

  let writeChain: Promise<void> = Promise.resolve();
  let eventsSinceCompact = 0;

  const enqueueWrite = <T>(op: () => Promise<T>): Promise<T> => {
    const next = writeChain.catch(() => {}).then(op);
    writeChain = next.then(
      () => {},
      () => {},
    );
    return next;
  };

  const compactJsonl = async (snapshot: Map<string, PipelineInboundJob>): Promise<void> => {
    const tmpFile = `${QUEUE_FILE}.compact`;
    await mkdir(resolveTaskMeldDataPath(), { recursive: true });
    const lines: string[] = [];
    const now = new Date().toISOString();
    for (const job of snapshot.values()) {
      lines.push(JSON.stringify({ type: "job.created", at: now, job }));
    }
    await writeFile(tmpFile, lines.length > 0 ? lines.join("\n") + "\n" : "", "utf8");
    await rename(tmpFile, QUEUE_FILE);
    eventsSinceCompact = 0;
  };

  const filterByPipeline = (toPipelineId: string, status?: PipelineInboundJobStatus): PipelineInboundJob[] =>
    [...jobSnapshot.values()]
      .filter((j) => j.toPipelineId === toPipelineId && (!status || j.status === status))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.jobId.localeCompare(b.jobId));

  const queue: PipelineInboundQueue = {
    initialize: async () => {
      await enqueueWrite(async () => {
        await replay();
        pruneCompletedJobs(jobSnapshot);
        await compactJsonl(jobSnapshot);
      });
    },

    getJobs: (toPipelineId: string) => filterByPipeline(toPipelineId),

    getPendingJobs: (toPipelineId: string) => filterByPipeline(toPipelineId, "pending"),

    getRunningJob: (toPipelineId: string) => {
      const running = filterByPipeline(toPipelineId, "running");
      return running.length > 0 ? running[0] : null;
    },

    getJobById: (jobId: string) => jobSnapshot.get(jobId) ?? null,

    getJobCount: (toPipelineId: string) => filterByPipeline(toPipelineId).length,

    getPendingCount: (toPipelineId: string) => filterByPipeline(toPipelineId, "pending").length,

    appendEvent: async (event: PipelineInboundQueueEvent) => {
      await enqueueWrite(async () => {
        await persistEvent(event);
        applyEvent(event, jobSnapshot);
        eventsSinceCompact += 1;
        if (eventsSinceCompact >= COMPACT_TRIGGER_EVENT_COUNT) {
          await compactJsonl(jobSnapshot);
        }
      });
    },

    cancelJob: async (jobId: string, reason: string) => {
      const job = jobSnapshot.get(jobId);
      if (!job) return { ok: false, error: "pipeline_queue_job_not_found" };
      if (job.status !== "pending") return { ok: false, error: "pipeline_queue_job_not_cancelable" };
      await queue.appendEvent({ type: "job.canceled", at: new Date().toISOString(), jobId, reason });
      return { ok: true };
    },

    retryJob: async (jobId: string) => {
      const job = jobSnapshot.get(jobId);
      if (!job) return { ok: false, error: "pipeline_queue_job_not_found" };
      if (job.status !== "failed" && job.status !== "canceled") {
        return { ok: false, error: "pipeline_queue_job_not_retryable" };
      }
      await queue.appendEvent({ type: "job.retry_requested", at: new Date().toISOString(), jobId });
      const updated = jobSnapshot.get(jobId);
      if (!updated) return { ok: false, error: "pipeline_queue_job_not_found" };
      return { ok: true, job: updated };
    },

    getJobSnapshot: () => jobSnapshot,
  };

  return queue;
};

export { buildJobId };
