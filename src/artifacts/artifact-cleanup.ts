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
 * 生成清理计划，不删除任何文件。
 * 默认只清理 success 状态，可通过 options 指定其他状态。
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

  // 优先从索引获取文件列表，索引缺失时回退扫描
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
 * 执行清理：删除文件 + 清理空目录 + 清理临时文件 + 重建索引。
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
    // 路径穿越保护：目标必须位于当前 pipeline 的 artifactDir 内
    if (absPath !== rootAbs && !absPath.startsWith(`${rootAbs}${sep}`)) {
      failed += 1;
      warnings.push(`拒绝删除越界文件 (${definition.id}:${file.relativePath})`);
      continue;
    }
    try {
      await rm(absPath);
      deleted += 1;
    } catch (error) {
      failed += 1;
      warnings.push(
        `删除失败 (${definition.id}:${file.relativePath}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // 清理空目录
  await cleanupEmptyDirs(definition.artifactDir);

  // 清理临时文件
  const tmpResult = await cleanupTempFiles(definition.artifactDir);
  warnings.push(...tmpResult.warnings);

  // 重建索引以移除已删文件
  try {
    const { rebuildArtifactIndex } = await import("./artifact-index.js");
    await rebuildArtifactIndex(definition, (d: PipelineDefinition) => scanStoredArtifacts([d]));
  } catch {
    warnings.push(`删除后自动重建索引失败 (${definition.id})，请手动执行 rebuild-index`);
  }

  return { deleted, failed, warnings };
};

/**
 * 递归清理空目录。保留 artifactDir 根目录本身。
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
      // 不删除 artifacts 根目录本身
      const isRoot = dirPath === artifactDir || dirPath.endsWith(`${sep}artifacts`) && dirPath.replace(/\\/g, "/").endsWith("/artifacts");
      if (isRoot) return;
      const after = await readdir(dirPath);
      if (after.length === 0) {
        await rmdir(dirPath);
        removed += 1;
      }
    } catch {
      // 目录不存在或无权访问
    }
  };

  await walkAndRemove(artifactDir);
  return { removed, warnings };
};

/**
 * 清理 persistArtifactFile 遗留的 .tmp-*.json 临时文件（原子写入失败残留）。
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
              `清理临时文件失败: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
      }
    } catch {
      // 目录不存在
    }
  };

  await walkAndClean(artifactDir);
  return { cleaned, warnings };
};
