import { createHash } from "node:crypto";

export type WorkflowOutputConfig = {
  mode: "mainline_last" | "explicit";
  nodeId: string | null;
};

export type PipelineOutputArtifactRef = {
  pipelineId: string;
  runId: string;
  batchRunId: string | null;
  nodeId: string;
  itemKey: string | null;
  relativePath: string;
  absolutePath: string;
  type: string;
  schemaVersion: number;
  name: string;
  hash: string;
  createdAt: string;
};

export type PipelineOutput = {
  schemaVersion: 1;
  outputId: string;
  pipelineId: string;
  runId: string;
  batchRunId: string | null;
  itemKey: string | null;
  outputNodeId: string;
  artifactId: string;
  artifactRef: PipelineOutputArtifactRef;
  producedAt: string;
};

/** 用去重键计算短哈希，稳定去重且长度可控。 */
export const buildOutputId = (
  pipelineId: string,
  runId: string,
  batchRunId: string | null,
  itemKey: string | null,
  outputNodeId: string,
  artifactId: string,
  hash: string,
): string => {
  const key = `${pipelineId}|${runId}|${batchRunId ?? ""}|${itemKey ?? ""}|${outputNodeId}|${artifactId}|${hash}`;
  const digest = createHash("sha256").update(key).digest("hex").slice(0, 16);
  return `output:${digest}`;
};
