import { randomUUID } from "node:crypto"
import type { Run } from "../runtime-model"
import type { PipelineRunIdentity } from "./types"

export { randomUUID }

export const buildRunId = (): string => `run-${Date.now()}`

export const buildBatchRunId = (pipelineId: string): string => `batch-${pipelineId}-${Date.now()}`

export const buildBatchItemKey = (batchIndex: number): string => `batch-${batchIndex}`

export const buildDerivedRouteItemKey = (itemKey: string, nodeId: string, route: string): string =>
  `${itemKey}::${nodeId}:${route}`

export const buildRequestId = (nodeId: string): string => `node-${nodeId}-${randomUUID()}`

export const buildItemKeyFromKeywords = (keywords: string[]): string[] => [
  ...new Set(keywords.map((item) => item.trim()).filter(Boolean)),
]

/** Build an identity snapshot from a Run and pipelineId */
export const toRunIdentity = (pipelineId: string, run: Run): PipelineRunIdentity => ({
  pipelineId,
  runId: run.id,
  batchRunId: null,
})

/** Format an identity into a human-readable string */
export const formatIdentity = (id: PipelineRunIdentity): string =>
  `pipeline=${id.pipelineId} run=${id.runId}${id.batchRunId ? ` batch=${id.batchRunId}` : ""}`

/** Verify identity match: pipelineId must be equal, runId must be equal, allow when either batchRunId is null */
export const matchIdentity = (target: PipelineRunIdentity, candidate: PipelineRunIdentity): boolean =>
  target.pipelineId === candidate.pipelineId &&
  target.runId === candidate.runId &&
  (target.batchRunId === null || candidate.batchRunId === null || target.batchRunId === candidate.batchRunId)

export type { PipelineRunIdentity, PipelineItemIdentity, NodeExecutionIdentity } from "./types"
