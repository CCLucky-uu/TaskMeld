import type { PipelineOutput } from "./pipeline-output";

export type PipelineInboundJobStatus =
  | "pending"
  | "running"
  | "success"
  | "failed"
  | "canceled";

export type PipelineInboundJob = {
  schemaVersion: 1;
  jobId: string;
  linkId: string;
  fromPipelineId: string;
  toPipelineId: string;
  status: PipelineInboundJobStatus;
  upstreamOutput: PipelineOutput;
  targetRunId: string | null;
  attempts: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
};

export type PipelineLinkInputContract = {
  requireType?: string;
  requireSchemaVersion?: number;
};

export type PipelineLink = {
  schemaVersion: 1;
  id: string;
  enabled: boolean;
  fromPipelineId: string;
  toPipelineId: string;
  trigger: "on_success";
  dispatchPolicy: "fifo";
  inputContract: PipelineLinkInputContract | null;
  onJobFailed: "continue" | "pause";
  maxPendingJobs: number;
  createdAt: string;
  updatedAt: string;
};

export type PipelineInboundQueueEvent =
  | { type: "job.created"; at: string; job: PipelineInboundJob }
  | { type: "job.running"; at: string; jobId: string; targetRunId: string }
  | { type: "job.success"; at: string; jobId: string; targetRunId: string }
  | { type: "job.failed"; at: string; jobId: string; targetRunId: string | null; error: string }
  | { type: "job.canceled"; at: string; jobId: string; reason: string }
  | { type: "job.retry_requested"; at: string; jobId: string };

export type RunInput =
  | { trigger: "manual" }
  | {
      trigger: "pipeline_link";
      inboundJobId: string;
      linkId: string;
      upstreamOutput: PipelineOutput;
    };

export const buildJobId = (linkId: string, outputId: string): string =>
  `job:${linkId}:${outputId}`;

export const isValidLinkId = (id: string): boolean =>
  /^link:[a-zA-Z0-9._-]+$/.test(id);
