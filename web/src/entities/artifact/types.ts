export type ArtifactStatusBucket = "success" | "failed" | "rejected" | "unknown";

export type StoredArtifactItem = {
  pipelineId: string;
  pipelineTitle: string;
  status: ArtifactStatusBucket;
  dateBucket: string;
  runId: string | null;
  nodeId: string | null;
  relativePath: string;
  fileName: string;
  sizeBytes: number;
  updatedAt: string;
  artifactId?: string;
};

export type StoredArtifactContent = {
  rawText: string;
  parsed: unknown | null;
  content: unknown;
  meta: Record<string, unknown> | null;
};

// Export shape: date -> pipeline -> node -> artifact content array
export type StoredArtifactExportData = Record<string, Record<string, Record<string, unknown[]>>>;
