import { API_BASE, wsRequest } from "../../shared/ws-client";
import type { RunLogPage, RunLogQuery } from "./types";

export async function fetchRunTimelineLogs(query: RunLogQuery): Promise<RunLogPage> {
  const params: Record<string, unknown> = { runId: query.runId };
  if (typeof query.offset === "number") params.offset = query.offset;
  if (typeof query.limit === "number") params.limit = query.limit;
  if (query.levels && query.levels.length > 0) params.levels = query.levels;
  if (query.keyword?.trim()) params.keyword = query.keyword.trim();
  if (query.order) params.order = query.order;
  return wsRequest<RunLogPage>("log.timeline", params);
}

export async function fetchRunLogRuns(): Promise<string[]> {
  const data = await wsRequest<{ items?: string[] }>("log.runs.list");
  return Array.isArray(data.items) ? data.items : [];
}

export const getRunTimelineRawUrl = (runId: string) =>
  `${API_BASE}/api/logs/runs/${encodeURIComponent(runId)}/timeline/raw`;
