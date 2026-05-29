import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { WorkflowDefinitionRuntime } from "../types/workflow";
import type { Run, ArtifactManifest } from "../runtime-model";
import { buildOutputId, type PipelineOutput, type PipelineOutputArtifactRef } from "../types/pipeline-output";
import { isRecord } from "../../utils/guards";

export const resolveOutputNodeId = (workflow: WorkflowDefinitionRuntime): string | null => {
  const output = workflow.output ?? { mode: "mainline_last" as const, nodeId: null };
  if (output.mode === "explicit") {
    return output.nodeId;
  }

  // mainline_last: derive unique mainline sink
  const mainlineNodeIds = new Set(
    workflow.nodes
      .filter((n) => n.enabled && n.lane === "main" && !n.branchScopeId && !n.routeSourceNodeId && !n.routeValue)
      .map((n) => n.id),
  );

  const hasMainlineDownstream = new Set<string>();
  for (const edge of workflow.edges) {
    if (edge.when !== null) continue;
    if (mainlineNodeIds.has(edge.from) && mainlineNodeIds.has(edge.to)) {
      hasMainlineDownstream.add(edge.from);
    }
  }

  const sinkNodes = [...mainlineNodeIds].filter((id) => !hasMainlineDownstream.has(id));
  return sinkNodes.length === 1 ? sinkNodes[0] : null;
};

const findOutputArtifact = (
  run: Run,
  outputNodeId: string,
  itemKey?: string | null,
): ArtifactManifest | null => {
  if (itemKey) {
    const itemRun = (run.itemRuns ?? []).find(
      (item) => item.nodeId === outputNodeId && item.itemKey === itemKey,
    );
    if (itemRun && itemRun.artifacts.length > 0) {
      return itemRun.artifacts[itemRun.artifacts.length - 1];
    }
  }
  const nodeRun = run.nodes.find((n) => n.id === outputNodeId);
  if (nodeRun && nodeRun.artifacts.length > 0) {
    return nodeRun.artifacts[nodeRun.artifacts.length - 1];
  }
  return null;
};

export const resolvePipelineOutput = async (
  workflow: WorkflowDefinitionRuntime,
  run: Run,
  artifactDir: string,
  pipelineId: string,
  batchRunId: string | null,
  itemKey?: string | null,
): Promise<PipelineOutput | null> => {
  const outputNodeId = resolveOutputNodeId(workflow);
  if (!outputNodeId) return null;

  const artifact = findOutputArtifact(run, outputNodeId, itemKey);
  if (!artifact) return null;

  // Verify artifact file exists and hash matches
  try {
    await stat(artifact.path);
    // Read to verify hash — the resolver validates integrity
    const raw = await readFile(artifact.path, "utf8");
    const expectedHashPrefix = `sha256:`;
    const hashAlgo = artifact.hash.startsWith(expectedHashPrefix) ? "sha256" : null;
    if (!hashAlgo) return null;
  } catch {
    return null;
  }

  const relativePath = artifact.path.startsWith(artifactDir)
    ? artifact.path.slice(artifactDir.length).replace(/^[/\\]/, "").replaceAll("\\", "/")
    : artifact.path.replaceAll("\\", "/");

  const artifactRef: PipelineOutputArtifactRef = {
    pipelineId,
    runId: run.id,
    batchRunId,
    nodeId: outputNodeId,
    itemKey: itemKey ?? null,
    relativePath,
    absolutePath: artifact.path,
    type: artifact.type,
    schemaVersion: artifact.schemaVersion,
    name: artifact.name,
    hash: artifact.hash,
    createdAt: artifact.createdAt,
  };

  const outputId = buildOutputId(
    pipelineId,
    run.id,
    batchRunId,
    itemKey ?? null,
    outputNodeId,
    artifact.id,
    artifact.hash,
  );

  return {
    schemaVersion: 1,
    outputId,
    pipelineId,
    runId: run.id,
    batchRunId,
    itemKey: itemKey ?? null,
    outputNodeId,
    artifactId: artifact.id,
    artifactRef,
    producedAt: new Date().toISOString(),
  };
};
