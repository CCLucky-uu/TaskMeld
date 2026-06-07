import { mkdir, rename } from "node:fs/promises"
import { join, relative } from "node:path"
import { buildArtifactStorageDirs, appendMovedArtifactIndexRecord } from "../artifact-storage"
import type { NodeRun } from "../runtime-model"

const sanitizeArtifactFileSegment = (value: string) => {
  const normalized = value
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/\.+$/g, "_")
  return normalized || "unnamed"
}

const buildArtifactFileName = (...parts: string[]) => parts.map(sanitizeArtifactFileSegment).join("-")

export const archiveRejectedArtifacts = async (params: {
  node: NodeRun
  runId: string
  artifactDir: string
  pipelineId: string
  rejectedByNodeId: string
  getBatchRunId?: () => string | null
  pushTimeline: (text: string, level: "info" | "warn" | "error", detail?: unknown) => void
}): Promise<number> => {
  const { node, runId, artifactDir, pipelineId, rejectedByNodeId, getBatchRunId, pushTimeline } = params
  if (!node.artifacts.length) return 0
  const persistDirs = buildArtifactStorageDirs(artifactDir, runId, "rejected", new Date(), getBatchRunId?.())
  await mkdir(persistDirs.artifactsDir, { recursive: true })
  let moved = 0
  for (const artifact of node.artifacts) {
    const sourcePath = artifact.path
    const fileName = sourcePath.replace(/^.*[\\/]/, "")
    const targetPath = join(
      persistDirs.artifactsDir,
      buildArtifactFileName(runId, node.id, "rejected-by", rejectedByNodeId, String(Date.now()), fileName),
    )
    try {
      await rename(sourcePath, targetPath)
      await appendMovedArtifactIndexRecord(artifactDir, {
        manifest: artifact,
        pipelineId,
        status: "rejected",
        relativePath: relative(artifactDir, targetPath).replaceAll("\\", "/"),
        movedAt: new Date(),
        rejectedByNodeId,
      }).catch(() => {
        /* Index append failure must not block node execution */
      })
      moved += 1
    } catch (error) {
      pushTimeline(
        `Failed to archive rejected artifact (node ${node.id}): ${error instanceof Error ? error.message : String(error)}`,
        "warn",
      )
    }
  }
  return moved
}
