import type { PipelineRunIdentityTarget } from "../../services/pipeline-service.js";

// 从 URL 查询参数提取 runId / batchRunId
export const readIdentityTargetFromUrl = (url: URL): PipelineRunIdentityTarget => ({
  runId: String(url.searchParams.get("runId") ?? "").trim() || undefined,
  batchRunId: String(url.searchParams.get("batchRunId") ?? "").trim() || undefined,
});

// 从请求体提取 runId / batchRunId
export const readIdentityTargetFromBody = (body: Record<string, unknown>): PipelineRunIdentityTarget => ({
  runId: typeof body.runId === "string" && body.runId.trim() ? body.runId.trim() : undefined,
  batchRunId: typeof body.batchRunId === "string" && body.batchRunId.trim() ? body.batchRunId.trim() : undefined,
});

// 合并两组 IdentityTarget，primary 优先
export const mergeIdentityTargets = (
  primary?: PipelineRunIdentityTarget,
  fallback?: PipelineRunIdentityTarget,
): PipelineRunIdentityTarget | undefined => {
  const runId = primary?.runId ?? fallback?.runId;
  const batchRunId = primary?.batchRunId ?? fallback?.batchRunId;
  if (!runId && !batchRunId) return undefined;
  return { runId, batchRunId };
};
