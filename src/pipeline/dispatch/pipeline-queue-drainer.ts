import type { PipelineLink } from "../types/pipeline-link"
import type { PipelineInboundQueue } from "./pipeline-inbound-queue"
import type { PipelineLinkStore } from "./pipeline-link-store"

export type PipelineQueueDrainer = {
  requestDrainInboundQueue: (toPipelineId: string) => void
  onPipelineRunCompleted: (pipelineId: string) => void
}

type DrainerDeps = {
  inboundQueue: PipelineInboundQueue
  linkStore: PipelineLinkStore
  isPipelineBusy: (pipelineId: string) => boolean
  executeInboundJob: (job: {
    jobId: string
    linkId: string
    upstreamOutput: NonNullable<ReturnType<PipelineInboundQueue["getJobById"]>>["upstreamOutput"]
  }) => Promise<{ ok: boolean; runId: string | null; error?: string }>
}

export const createPipelineQueueDrainer = (deps: DrainerDeps): PipelineQueueDrainer => {
  const drainInFlightByPipelineId = new Map<string, Promise<void>>()
  const { inboundQueue, linkStore, isPipelineBusy, executeInboundJob } = deps

  const drainOne = async (toPipelineId: string): Promise<void> => {
    if (isPipelineBusy(toPipelineId)) return

    const pendingJobs = inboundQueue.getPendingJobs(toPipelineId)
    if (pendingJobs.length === 0) return

    const job = pendingJobs[0]
    const now = new Date().toISOString()

    // Check if there's already a running job for this pipeline
    const runningJob = inboundQueue.getRunningJob(toPipelineId)
    if (runningJob) return

    const result = await executeInboundJob({
      jobId: job.jobId,
      linkId: job.linkId,
      upstreamOutput: job.upstreamOutput,
    })

    if (result.ok && result.runId) {
      await inboundQueue.appendEvent({
        type: "job.success",
        at: new Date().toISOString(),
        jobId: job.jobId,
        targetRunId: result.runId,
      })
    } else {
      const link = await linkStore.getById(job.linkId)
      const onJobFailed: "continue" | "pause" = link?.onJobFailed ?? "continue"
      await inboundQueue.appendEvent({
        type: "job.failed",
        at: new Date().toISOString(),
        jobId: job.jobId,
        targetRunId: result.runId,
        error: result.error ?? "unknown_error",
      })

      if (onJobFailed === "pause") {
        return // Stop draining this queue
      }
    }

    // Continue draining if more pending jobs
    if (inboundQueue.getPendingJobs(toPipelineId).length > 0) {
      setImmediate(() => drainer.requestDrainInboundQueue(toPipelineId))
    }
  }

  const drainer: PipelineQueueDrainer = {
    requestDrainInboundQueue: (toPipelineId: string) => {
      // If already draining, reuse existing promise
      if (drainInFlightByPipelineId.has(toPipelineId)) return

      const drainPromise = drainOne(toPipelineId).finally(() => {
        drainInFlightByPipelineId.delete(toPipelineId)
      })

      drainInFlightByPipelineId.set(toPipelineId, drainPromise)
    },

    onPipelineRunCompleted: (pipelineId: string) => {
      // When a pipeline run completes, check if there are pending jobs to drain
      const pendingJobs = inboundQueue.getPendingJobs(pipelineId)
      if (pendingJobs.length > 0) {
        setImmediate(() => drainer.requestDrainInboundQueue(pipelineId))
      }
    },
  }

  return drainer
}
