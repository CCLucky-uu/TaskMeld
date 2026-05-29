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

// 导出结构固定为: 日期 -> 流水线 -> 节点 -> 产物内容数组
export type StoredArtifactExportData = Record<string, Record<string, Record<string, unknown[]>>>;
