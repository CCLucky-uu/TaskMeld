import type { StoredArtifactItem } from "../../../entities/artifact";

export type ArtifactRangePreset = "today" | "7d" | "30d" | "custom";

export type ArtifactPipelineOption = {
  id: string;
  title: string;
};

export type ArtifactNodeOption = {
  id: string;
};

export type ArtifactFilterState = {
  preset: ArtifactRangePreset;
  pipelineId: string;
  nodeIds: string[];
  statuses: string[];
  batchRunId?: string;
  kinds: string[];
  customFrom: string;
  customTo: string;
};

export type ArtifactQuery = {
  dateFrom: string;
  dateTo: string;
  pipelineId?: string;
  nodeId?: string;
};

export type ArtifactRunGroup = {
  runId: string;
  items: StoredArtifactItem[];
  latestUpdatedAtMs: number;
};

export type ArtifactPipelineGroup = {
  pipelineId: string;
  pipelineTitle: string;
  runs: ArtifactRunGroup[];
  total: number;
  latestUpdatedAtMs: number;
};

export type ArtifactDateGroup = {
  dateKey: string;
  pipelines: ArtifactPipelineGroup[];
  total: number;
  latestUpdatedAtMs: number;
};
