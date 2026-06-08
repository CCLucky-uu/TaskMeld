import type { PipelineRegistry } from "../../app/pipeline-registry"
import type { PipelineRunIdentityTarget } from "../../services/pipeline-service"

export const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null

export const readIdentityTargetFromBody = (body: Record<string, unknown>): PipelineRunIdentityTarget => ({
  runId: typeof body.runId === "string" && body.runId.trim() ? body.runId.trim() : undefined,
  batchRunId: typeof body.batchRunId === "string" && body.batchRunId.trim() ? body.batchRunId.trim() : undefined,
})

export const mergeIdentityTargets = (
  primary?: PipelineRunIdentityTarget,
  fallback?: PipelineRunIdentityTarget,
): PipelineRunIdentityTarget | undefined => {
  const runId = primary?.runId ?? fallback?.runId
  const batchRunId = primary?.batchRunId ?? fallback?.batchRunId
  if (!runId && !batchRunId) return undefined
  return { runId, batchRunId }
}

export const formatError = (error: unknown): string => (error instanceof Error ? error.message : String(error))

export const requireRuntime = <T>(
  app: PipelineRegistry,
  pipelineId: string,
  onFound: (runtime: NonNullable<ReturnType<PipelineRegistry["getPipelineRuntime"]>>) => T,
): T | { ok: false; error: string } => {
  const runtime = app.getPipelineRuntime(pipelineId)
  if (!runtime) return { ok: false, error: "pipeline_not_found" }
  return onFound(runtime)
}
