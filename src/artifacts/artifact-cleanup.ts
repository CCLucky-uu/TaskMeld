import { readdir, rm, rmdir, stat } from "node:fs/promises";
import { resolve, sep } from "node:path";
import type { PipelineDefinition } from "../app/pipeline-config";
import { scanStoredArtifacts } from "./storage-service";
import { readIndexRecords, getIndexPath } from "./artifact-index";

export type CleanupPlan = {
  pipelineId: string;
  files: Array<{ relativePath: string; sizeBytes: number; hash: string }>;
  totalSizeBytes: number;
  oldestDate: string | null;
  newestDate: string | null;
};

export type CleanupOptions = {
  olderThanDays?: number;
  statuses?: string[];
  kinds?: string[];
  maxSizeBytes?: number;
};

const DEFAULT_RETENTION_DAYS: Record<string, number> = {
  success: 30,
  failed: 90,
  rejected: 90,
};

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Generate a cleanup plan without deleting any files.
 * Defaults to only cleaning "success" status; other statuses can be specified via options.
 */
export const planCleanup = async (
  definition: PipelineDefinition,
  options: CleanupOptions = {},
): Promise<CleanupPlan> => {
  const statuses = options.statuses?.length ? options.statuses : ["success"];
  const safeStatuses = statuses.filter((s) => s !== "unknown");
  const statusFilter = new Set(safeStatuses);
  const kindFilter = options.kinds?.length ? new Set(options.kinds) : null;
  const olderThanDays = options.olderThanDays ?? Math.max(
    ...safeStatuses.map((s) => DEFAULT_RETENTION_DAYS[s] ?? 90),
  );
  const cutoffMs = Date.now() - olderThanDays * ONE_DAY_MS;

  // Prefer index for file list; fall back to scan when index is missing
  let items = await readIndexRecords(definition.artifactDir);
  if (items.length === 0) {
    const scanned = await scanStoredArtifacts([definition]);
    items = scanned.map((item) => ({
      schemaVersion: 1 as const,
      artifactId: "",
      pipelineId: item.pipelineId,
      status: item.status,
      kind: "artifact",
      dateBucket: item.dateBucket,
      runId: item.runId,
      batchRunId: null,
      nodeId: item.nodeId,
      groupId: null,
      itemKey: null,
      requestId: null,
      type: "unknown",
      artifactSchemaVersion: 1,
      name: "",
      relativePath: item.relativePath,
      sizeBytes: item.sizeBytes,
      hash: "",
      createdAt: item.updatedAt,
      updatedAt: item.updatedAt,
    }));
  }

  const files: CleanupPlan["files"] = [];
  let totalSizeBytes = 0;
  let oldestDate: string | null = null;
  let newestDate: string | null = null;

  for (const item of items) {
    if (!statusFilter.has(item.status)) continue;
    if (kindFilter && !kindFilter.has(item.kind)) continue;
    const itemMs = Date.parse(item.updatedAt);
    if (!Number.isFinite(itemMs) || itemMs > cutoffMs) continue;
    if (options.maxSizeBytes != null && totalSizeBytes + item.sizeBytes > options.maxSizeBytes) break;

    files.push({
      relativePath: item.relativePath,
      sizeBytes: item.sizeBytes,
      hash: item.hash,
    });
    totalSizeBytes += item.sizeBytes;

    const dateBucket = item.dateBucket;
    if (dateBucket && (oldestDate === null || dateBucket < oldestDate)) oldestDate = dateBucket;
    if (dateBucket && (newestDate === null || dateBucket > newestDate)) newestDate = dateBucket;
  }

  return {
    pipelineId: definition.id,
    files,
    totalSizeBytes,
    oldestDate,
    newestDate,
  };
};

/**
 * Execute cleanup: delete files + clean empty directories + clean temp files + rebuild index.
 */
export const executeCleanup = async (
  definition: PipelineDefinition,
  plan: CleanupPlan,
): Promise<{ deleted: number; failed: number; warnings: string[] }> => {
  const warnings: string[] = [];
  let deleted = 0;
  let failed = 0;

  for (const file of plan.files) {
    const rootAbs = resolve(definition.artifactDir);
    const absPath = resolve(rootAbs, file.relativePath);
    // Path traversal protection: target must be within the current pipeline's artifactDir
    if (absPath !== rootAbs && !absPath.startsWith(`${rootAbs}${sep}`)) {
      failed += 1;
      warnings.push(`Refused to delete out-of-bounds file (${definition.id}:${file.relativePath})`);
      continue;
    }
    try {
      await rm(absPath);
      deleted += 1;
    } catch (error) {
      failed += 1;
      warnings.push(
        `Delete failed (${definition.id}:${file.relativePath}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // Clean empty directories
  await cleanupEmptyDirs(definition.artifactDir);

  // Clean temp files
  const tmpResult = await cleanupTempFiles(definition.artifactDir);
  warnings.push(...tmpResult.warnings);

  // Rebuild index to remove deleted file entries
  try {
    const { rebuildArtifactIndex } = await import("./artifact-index.js");
    await rebuildArtifactIndex(definition, (d: PipelineDefinition) => scanStoredArtifacts([d]));
  } catch {
    warnings.push(`Auto-rebuild index after delete failed (${definition.id}), please run rebuild-index manually`);
  }

  return { deleted, failed, warnings };
};

/**
 * Recursively clean empty directories. Preserves the artifactDir root directory itself.
 */
export const cleanupEmptyDirs = async (
  artifactDir: string,
): Promise<{ removed: number; warnings: string[] }> => {
  const warnings: string[] = [];
  let removed = 0;

  const walkAndRemove = async (dirPath: string): Promise<void> => {
    try {
      const entries = await readdir(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          await walkAndRemove(`${dirPath}${sep}${entry.name}`);
        }
      }
      // Don't delete the artifacts root directory itself
      const isRoot = dirPath === artifactDir || dirPath.endsWith(`${sep}artifacts`) && dirPath.replace(/\\/g, "/").endsWith("/artifacts");
      if (isRoot) return;
      const after = await readdir(dirPath);
      if (after.length === 0) {
        await rmdir(dirPath);
        removed += 1;
      }
    } catch {
      // Directory doesn't exist or cannot be accessed
    }
  };

  await walkAndRemove(artifactDir);
  return { removed, warnings };
};

/**
 * Clean up .tmp-*.json temp files left behind by persistArtifactFile (atomic write failure residue).
 */
export const cleanupTempFiles = async (
  artifactDir: string,
): Promise<{ cleaned: number; warnings: string[] }> => {
  const warnings: string[] = [];
  let cleaned = 0;

  const walkAndClean = async (dirPath: string): Promise<void> => {
    try {
      const entries = await readdir(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const subPath = `${dirPath}${sep}${entry.name}`;
        if (entry.isDirectory()) {
          await walkAndClean(subPath);
        } else if (entry.isFile() && entry.name.startsWith(".tmp-") && entry.name.endsWith(".json")) {
          try {
            await rm(subPath);
            cleaned += 1;
          } catch (error) {
            warnings.push(
              `Failed to clean temp files: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
      }
    } catch {
      // Directory doesn't exist
    }
  };

  await walkAndClean(artifactDir);
  return { cleaned, warnings };
};
