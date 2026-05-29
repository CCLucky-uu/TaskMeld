import type { PipelineOutput } from "../types/pipeline-output";
import { buildJobId, type PipelineInboundJob } from "../types/pipeline-link";
import type { PipelineLinkStore } from "./pipeline-link-store";
import type { PipelineInboundQueue } from "./pipeline-inbound-queue";

export type PipelineLinkDispatcher = {
  dispatch: (output: PipelineOutput) => Promise<{ dispatched: number; errors: string[] }>;
};

type DispatcherDeps = {
  linkStore: PipelineLinkStore;
  inboundQueue: PipelineInboundQueue;
  pipelineExists: (pipelineId: string) => boolean;
};

export const createPipelineLinkDispatcher = (deps: DispatcherDeps): PipelineLinkDispatcher => {
  const { linkStore, inboundQueue, pipelineExists } = deps;

  const validateContract = (
    link: { inputContract: { requireType?: string; requireSchemaVersion?: number } | null },
    output: PipelineOutput,
  ): boolean => {
    if (!link.inputContract) return true;
    const { requireType, requireSchemaVersion } = link.inputContract;
    if (requireType && output.artifactRef.type !== requireType) return false;
    if (requireSchemaVersion !== undefined && output.artifactRef.schemaVersion !== requireSchemaVersion) return false;
    return true;
  };

  return {
    dispatch: async (output: PipelineOutput) => {
      const links = await linkStore.list();
      const matchingLinks = links.filter(
        (l) => l.enabled && l.fromPipelineId === output.pipelineId,
      );

      let dispatched = 0;
      const errors: string[] = [];

      for (const link of matchingLinks) {
        if (!pipelineExists(link.toPipelineId)) {
          errors.push(`link ${link.id}: downstream pipeline ${link.toPipelineId} not found`);
          continue;
        }

        if (!validateContract(link, output)) {
          errors.push(`link ${link.id}: input contract mismatch`);
          continue;
        }

        const pendingCount = inboundQueue.getPendingCount(link.toPipelineId);
        if (pendingCount >= link.maxPendingJobs) {
          errors.push(`link ${link.id}: queue full (${pendingCount}/${link.maxPendingJobs})`);
          continue;
        }

        // Dedup: check if job already exists for this link+output
        const jobId = buildJobId(link.id, output.outputId);
        const existing = inboundQueue.getJobById(jobId);
        if (existing) {
          continue; // Already dispatched, skip
        }

        const now = new Date().toISOString();
        const job: PipelineInboundJob = {
          schemaVersion: 1,
          jobId,
          linkId: link.id,
          fromPipelineId: output.pipelineId,
          toPipelineId: link.toPipelineId,
          status: "pending",
          upstreamOutput: output,
          targetRunId: null,
          attempts: 0,
          createdAt: now,
          startedAt: null,
          finishedAt: null,
          error: null,
        };

        await inboundQueue.appendEvent({ type: "job.created", at: now, job });
        dispatched += 1;
      }

      return { dispatched, errors };
    },
  };
};
