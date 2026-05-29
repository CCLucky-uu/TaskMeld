import { API_BASE, requestJson } from "../../shared/api/client";
import type { RunLogPage, RunLogQuery } from "./types";

const buildQueryString = (query: RunLogQuery) => {
  const params = new URLSearchParams();
  if (typeof query.offset === "number") params.set("offset", String(query.offset));
  if (typeof query.limit === "number") params.set("limit", String(query.limit));
  if (query.levels && query.levels.length > 0) params.set("level", query.levels.join(","));
  if (query.keyword?.trim()) params.set("keyword", query.keyword.trim());
  if (query.order) params.set("order", query.order);
  const serialized = params.toString();
  return serialized ? `?${serialized}` : "";
};

export async function fetchRunTimelineLogs(query: RunLogQuery): Promise<RunLogPage> {
  const runId = encodeURIComponent(query.runId);
  return requestJson<RunLogPage>(`/api/logs/runs/${runId}/timeline${buildQueryString(query)}`);
}

export async function fetchRunLogRuns(): Promise<string[]> {
  const data = await requestJson<{ items?: string[] }>("/api/logs/runs");
  return Array.isArray(data.items) ? data.items : [];
}

export const getRunTimelineRawUrl = (runId: string) =>
  `${API_BASE}/api/logs/runs/${encodeURIComponent(runId)}/timeline/raw`;
