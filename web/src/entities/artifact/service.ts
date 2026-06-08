import { wsRequest } from "../../shared/ws-client";
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

const buildWsParams = (params?: ArtifactListParams): Record<string, unknown> => {
  const wsParams: Record<string, unknown> = {};
  if (params?.pipelineId) wsParams.pipelineId = params.pipelineId;
  if (params?.nodeId) wsParams.nodeId = params.nodeId;
  if (params?.dateFrom) wsParams.dateFrom = params.dateFrom;
  if (params?.dateTo) wsParams.dateTo = params.dateTo;
  if (typeof params?.limit === "number") wsParams.limit = params.limit;
  if (params?.status) wsParams.status = params.status;
  if (params?.kind) wsParams.kind = params.kind;
  if (params?.cursor) wsParams.cursor = params.cursor;
  if (params?.batchRunId) wsParams.batchRunId = params.batchRunId;
  if (params?.runId) wsParams.runId = params.runId;
  return wsParams;
};

export async function fetchStoredArtifacts(params?: ArtifactListParams): Promise<StoredArtifactItem[]> {
  const data = await wsRequest<ArtifactListResponse>("artifact.list", buildWsParams(params));
  return Array.isArray(data.items) ? data.items : [];
}

export async function fetchStoredArtifactContent(params: {
  pipelineId: string;
  relativePath: string;
}): Promise<StoredArtifactContent | null> {
  const data = await wsRequest<ArtifactContentResponse>("artifact.content.get", {
    pipelineId: params.pipelineId,
    relativePath: params.relativePath,
  });
  return data.content ?? null;
}

export async function fetchStoredArtifactsExport(params?: ArtifactListParams): Promise<StoredArtifactExportData> {
  const data = await wsRequest<ArtifactExportResponse>("artifact.export", buildWsParams(params));
  return data.data ?? {};
}
