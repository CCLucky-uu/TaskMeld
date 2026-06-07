import { readdir, stat } from "node:fs/promises"
import { basename, resolve, sep } from "node:path"
import type { PipelineDefinition } from "../app/pipeline-config"
import { readIndexRecords, appendIndexRecord, type StoredArtifactIndexRecord } from "./artifact-index"
import { scanStoredArtifacts } from "./storage-service"

/**
 * Incrementally rebuild artifact index — scan the disk directory, only append records for files missing from the index.
 * Files already present in the index (matched by relativePath) are not re-added.
 */
export const rebuildArtifactIndexIncremental = async (
  rootDir: string,
  pipelineId?: string,
): Promise<{ indexed: number; skipped: number; warnings: string[] }> => {
  const warnings: string[] = []
  let indexed = 0
  let skipped = 0

  // 收集所有目标 pipeline 的 artifact 目录
  const dirs: Array<{ pipelineId: string; artifactDir: string }> = []

  // 扫描 rootDir 下所有 pipeline 目录
  try {
    const entries = await readdir(rootDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const pipelineDir = resolve(rootDir, entry.name)
      const artifactsPath = resolve(pipelineDir, "artifacts")
      try {
        const artStat = await stat(artifactsPath)
        if (artStat.isDirectory()) {
          if (!pipelineId || entry.name === pipelineId) {
            dirs.push({ pipelineId: entry.name, artifactDir: artifactsPath })
          }
        }
      } catch {
        // no artifacts dir
      }
    }
  } catch {
    warnings.push(`Failed to scan artifact root directory: ${rootDir}`)
  }

  for (const dir of dirs) {
    const existingRecords = await readIndexRecords(dir.artifactDir)
    const indexedPaths = new Set(existingRecords.map((r) => r.relativePath))

    // 递归扫描所有 artifact 文件
    const scanDir = async (subPath: string): Promise<void> => {
      let entries
      try {
        entries = await readdir(subPath, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        const fullPath = resolve(subPath, entry.name)
        if (entry.isDirectory()) {
          await scanDir(fullPath)
        } else if (entry.isFile() && entry.name.endsWith(".json") && !entry.name.startsWith(".tmp-")) {
          const relPath = fullPath.slice(dir.artifactDir.length + 1).replace(/\\/g, "/")
          if (indexedPaths.has(relPath)) {
            skipped += 1
            continue
          }
          try {
            const fileStat = await stat(fullPath)
            // 构建基础索引记录
            const record: StoredArtifactIndexRecord = {
              schemaVersion: 1,
              artifactId: `rebuild:${dir.pipelineId}:${relPath}`,
              pipelineId: dir.pipelineId,
              status: "unknown",
              kind: relPath.includes("/envelopes/") ? "envelope" : "artifact",
              dateBucket: "",
              runId: null,
              batchRunId: null,
              nodeId: null,
              groupId: null,
              itemKey: null,
              requestId: null,
              type: "unknown",
              artifactSchemaVersion: 1,
              name: basename(fullPath),
              relativePath: relPath,
              sizeBytes: fileStat.size,
              hash: "",
              createdAt: fileStat.mtime.toISOString(),
              updatedAt: fileStat.mtime.toISOString(),
            }
            const result = await appendIndexRecord(dir.artifactDir, record)
            if (result.ok) {
              indexed += 1
            } else {
              warnings.push(result.warning.message)
              skipped += 1
            }
          } catch {
            skipped += 1
          }
        }
      }
    }

    const statusDirs = ["success", "failed", "rejected"]
    for (const statusDir of statusDirs) {
      const statusPath = resolve(dir.artifactDir, statusDir)
      try {
        const s = await stat(statusPath)
        if (s.isDirectory()) {
          await scanDir(statusPath)
        }
      } catch {
        // dir doesn't exist
      }
    }
  }

  return { indexed, skipped, warnings }
}
