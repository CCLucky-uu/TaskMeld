import { requestJson } from "../../shared/api/client";
import type { StoredArtifactContent, StoredArtifactExportData, StoredArtifactItem } from "./types";

type ArtifactListResponse = {
  items?: StoredArtifactItem[];
  nextCursor?: string | null;
  source?: string;
};

type ArtifactContentResponse = {
  content?: StoredArtifactContent;
};

type ArtifactExportResponse = {
  data?: StoredArtifactExportData;
};

const buildQuery = (params: Record<string, string | number | null | undefined>) => {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === "") continue;
    query.set(key, String(value));
  }
  const raw = query.toString();
  return raw ? `?${raw}` : "";
};

export type ArtifactListParams = {
  pipelineId?: string;
  nodeId?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  status?: string;
  kind?: string;
  cursor?: string;
  batchRunId?: string;
  runId?: string;
};

export async function fetchStoredArtifacts(params?: ArtifactListParams): Promise<StoredArtifactItem[]> {
  const query = buildQuery({
    pipelineId: params?.pipelineId,
    nodeId: params?.nodeId,
    dateFrom: params?.dateFrom,
    dateTo: params?.dateTo,
    limit: params?.limit,
    status: params?.status,
    kind: params?.kind,
    cursor: params?.cursor,
    batchRunId: params?.batchRunId,
    runId: params?.runId,
  });
  const data = await requestJson<ArtifactListResponse>(`/api/artifacts${query}`);
  return Array.isArray(data.items) ? data.items : [];
}

export async function fetchStoredArtifactContent(params: {
  pipelineId: string;
  relativePath: string;
}): Promise<StoredArtifactContent | null> {
  const query = buildQuery({
    pipelineId: params.pipelineId,
    relativePath: params.relativePath,
  });
  const data = await requestJson<ArtifactContentResponse>(`/api/artifacts/content${query}`);
  return data.content ?? null;
}

export async function fetchStoredArtifactsExport(params?: ArtifactListParams): Promise<StoredArtifactExportData> {
  const query = buildQuery({
    pipelineId: params?.pipelineId,
    nodeId: params?.nodeId,
    dateFrom: params?.dateFrom,
    dateTo: params?.dateTo,
    limit: params?.limit,
    status: params?.status,
    kind: params?.kind,
    batchRunId: params?.batchRunId,
    runId: params?.runId,
  });
  const data = await requestJson<ArtifactExportResponse>(`/api/artifacts/export${query}`);
  return data.data ?? {};
}
