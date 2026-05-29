import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, stat, writeFile } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { appendIndexRecord, type StoredArtifactIndexRecord } from "../artifacts/artifact-index";

export type ArtifactStorageStatus = "success" | "failed" | "rejected";

const pad2 = (value: number) => String(value).padStart(2, "0");

const formatLocalDateBucket = (at: Date): string =>
  `${at.getFullYear()}-${pad2(at.getMonth() + 1)}-${pad2(at.getDate())}`;

export const buildArtifactStorageDirs = (
  rootDir: string,
  runId: string,
  status: ArtifactStorageStatus,
  savedAt = new Date(),
  batchRunId?: string | null,
) => {
  // 运行产物需要按"结果状态/日期/runId"归档，避免目录长期平铺后难以按日排障或批量清理。
  // envelopes 与 artifacts 分桶存放，是为了把节点回执和实际产物内容分开，减少误读与误删风险。
  const dateBucket = formatLocalDateBucket(savedAt);
  const runDir = batchRunId
    ? join(rootDir, status, dateBucket, batchRunId, runId)
    : join(rootDir, status, dateBucket, runId);
  return {
    dateBucket,
    runDir,
    envelopesDir: join(runDir, "envelopes"),
    artifactsDir: join(runDir, "artifacts"),
  };
};

export type StoredArtifactKind = "artifact" | "envelope" | "adapter" | "group";

/** 产物写入上下文，所有调用方通过此结构提供元数据。 */
export type ArtifactWriteContext = {
  pipelineId: string;
  runId: string;
  batchRunId?: string | null;
  nodeId?: string | null;
  groupId?: string | null;
  itemKey?: string | null;
  requestId?: string | null;
  kind: StoredArtifactKind;
};

const sanitizeFileSegment = (value: string): string => {
  const normalized = value
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/\.+$/g, "_");
  return normalized || "unnamed";
};

/**
 * 产物文件统一写入入口。
 * 负责：目录创建、原子写入（临时文件 + rename）、真实 SHA-256 哈希计算、索引追加、ArtifactManifest 构造。
 */
export const persistArtifactFile = async (
  rootDir: string,
  status: ArtifactStorageStatus,
  ctx: ArtifactWriteContext,
  artifact: { type: string; schemaVersion: number; name: string; content: unknown; meta?: Record<string, unknown> },
  opts?: { savedAt?: Date; fileNameSuffix?: string },
): Promise<import("./runtime-model").ArtifactManifest> => {
  const savedAt = opts?.savedAt ?? new Date();
  const persistDirs = buildArtifactStorageDirs(rootDir, ctx.runId, status, savedAt, ctx.batchRunId);
  await mkdir(persistDirs.artifactsDir, { recursive: true });

  // 统一的文件序列化格式，kind 字段供读取端分发
  const fileContent = {
    schemaVersion: 1,
    runId: ctx.runId,
    batchRunId: ctx.batchRunId ?? null,
    nodeId: ctx.nodeId ?? null,
    groupId: ctx.groupId ?? null,
    itemKey: ctx.itemKey ?? null,
    requestId: ctx.requestId ?? null,
    kind: ctx.kind,
    savedAt: savedAt.toISOString(),
    artifact,
  };

  const fileNameSegments = [sanitizeFileSegment(ctx.runId), sanitizeFileSegment(ctx.nodeId ?? ctx.groupId ?? "unknown")];
  if (opts?.fileNameSuffix) fileNameSegments.push(sanitizeFileSegment(opts.fileNameSuffix));
  const fileName = `${fileNameSegments.join("-")}.json`;

  // 原子写入: 先写临时文件，计算 hash，再 rename 到最终路径
  const tmpFileName = `.tmp-${randomUUID()}.json`;
  const tmpPath = join(persistDirs.artifactsDir, tmpFileName);
  const json = JSON.stringify(fileContent, null, 2);
  await writeFile(tmpPath, json, "utf8");

  const hash = `sha256:${createHash("sha256").update(json).digest("hex")}`;
  const finalPath = join(persistDirs.artifactsDir, fileName);
  await rename(tmpPath, finalPath);

  const fileStat = await stat(finalPath);
  const manifestId = randomUUID();
  const createdAt = new Date().toISOString();
  const updatedAt = fileStat.mtime.toISOString();
  const relativePath = relative(rootDir, finalPath).replaceAll("\\", "/");

  // 追加索引记录（best-effort，失败不阻断产物写入）
  const pipelineId = ctx.pipelineId;
  const indexRecord: StoredArtifactIndexRecord = {
    schemaVersion: 1,
    artifactId: manifestId,
    pipelineId,
    status,
    kind: ctx.kind,
    dateBucket: persistDirs.dateBucket,
    runId: ctx.runId,
    batchRunId: ctx.batchRunId ?? null,
    nodeId: ctx.nodeId ?? null,
    groupId: ctx.groupId ?? null,
    itemKey: ctx.itemKey ?? null,
    requestId: ctx.requestId ?? null,
    type: artifact.type,
    artifactSchemaVersion: artifact.schemaVersion,
    name: artifact.name,
    relativePath,
    sizeBytes: fileStat.size,
    hash,
    createdAt,
    updatedAt,
  };
  // 追加索引记录：文件已通过 tmp+rename 原子写入磁盘，索引追加失败不丢失产物文件
  const _ir = await appendIndexRecord(rootDir, indexRecord); void _ir;

  return {
    id: manifestId,
    type: artifact.type,
    schemaVersion: artifact.schemaVersion,
    name: artifact.name,
    path: finalPath,
    hash,
    sourceNodeId: ctx.nodeId ?? ctx.groupId ?? "unknown",
    createdAt,
  };
};

export type MovedArtifactIndexInput = {
  manifest: import("./runtime-model").ArtifactManifest;
  status: ArtifactStorageStatus;
  relativePath: string;
  movedAt: Date;
  rejectedByNodeId?: string;
  pipelineId: string;
};

/** 产物移动（如 rejected 归档）后补记索引，使查询端通过 artifactId 去重拿到最新位置。 */
export const appendMovedArtifactIndexRecord = async (
  rootDir: string,
  input: MovedArtifactIndexInput,
): Promise<void> => {
  const targetPath = resolve(rootDir, input.relativePath);
  const fileStat = await stat(targetPath);
  const segments = input.relativePath.split("/").filter(Boolean);
  const dateBucket = segments[1] ?? formatLocalDateBucket(input.movedAt);
  const batchRunId = segments[2]?.startsWith("batch-") ? segments[2] : null;
  const runId = batchRunId ? segments[3] ?? null : segments[2] ?? null;
  const pipelineId = input.pipelineId;

  const _ir2 = await appendIndexRecord(rootDir, {
    schemaVersion: 1,
    artifactId: input.manifest.id,
    pipelineId,
    status: input.status,
    kind: "artifact",
    dateBucket,
    runId,
    batchRunId,
    nodeId: input.manifest.sourceNodeId,
    groupId: null,
    itemKey: null,
    requestId: null,
    type: input.manifest.type,
    artifactSchemaVersion: input.manifest.schemaVersion,
    name: input.manifest.name,
    relativePath: input.relativePath,
    sizeBytes: fileStat.size,
    hash: input.manifest.hash,
    createdAt: input.manifest.createdAt,
    updatedAt: input.movedAt.toISOString(),
  });
};

/** 保存 envelope 回执文件到 envelopes 子目录并追加索引，使 kind=envelope 可在列表中查询。 */
export const persistEnvelopeFile = async (
  rootDir: string,
  status: ArtifactStorageStatus,
  ctx: Omit<ArtifactWriteContext, "kind"> & { kind?: "envelope" },
  envelope: unknown,
  opts?: { savedAt?: Date },
): Promise<import("./runtime-model").ArtifactManifest> => {
  const savedAt = opts?.savedAt ?? new Date();
  const persistDirs = buildArtifactStorageDirs(rootDir, ctx.runId, status, savedAt, ctx.batchRunId);
  await mkdir(persistDirs.envelopesDir, { recursive: true });

  const fileName = `${sanitizeFileSegment(ctx.runId)}-${sanitizeFileSegment(ctx.nodeId ?? "unknown")}-${sanitizeFileSegment(ctx.requestId ?? "envelope")}-envelope.json`;

  const fileContent = {
    schemaVersion: 1,
    runId: ctx.runId,
    batchRunId: ctx.batchRunId ?? null,
    nodeId: ctx.nodeId ?? null,
    requestId: ctx.requestId ?? null,
    kind: "envelope",
    savedAt: savedAt.toISOString(),
    envelope,
  };

  const tmpFileName = `.tmp-${randomUUID()}.json`;
  const tmpPath = join(persistDirs.envelopesDir, tmpFileName);
  const json = JSON.stringify(fileContent, null, 2);
  await writeFile(tmpPath, json, "utf8");

  const hash = `sha256:${createHash("sha256").update(json).digest("hex")}`;
  const finalPath = join(persistDirs.envelopesDir, fileName);
  await rename(tmpPath, finalPath);

  const fileStat = await stat(finalPath);
  const manifestId = randomUUID();
  const createdAt = new Date().toISOString();
  const updatedAt = fileStat.mtime.toISOString();
  const relativePathStr = relative(rootDir, finalPath).replaceAll("\\", "/");

  const pipelineId = ctx.pipelineId;
  const indexRecord: StoredArtifactIndexRecord = {
    schemaVersion: 1,
    artifactId: manifestId,
    pipelineId,
    status,
    kind: "envelope",
    dateBucket: persistDirs.dateBucket,
    runId: ctx.runId,
    batchRunId: ctx.batchRunId ?? null,
    nodeId: ctx.nodeId ?? null,
    groupId: null,
    itemKey: null,
    requestId: ctx.requestId ?? null,
    type: "structured-output-envelope",
    artifactSchemaVersion: 1,
    name: "envelope",
    relativePath: relativePathStr,
    sizeBytes: fileStat.size,
    hash,
    createdAt,
    updatedAt,
  };
  // 追加索引记录：文件已通过 tmp+rename 原子写入磁盘，索引追加失败不丢失产物文件
  const _ir = await appendIndexRecord(rootDir, indexRecord); void _ir;

  return {
    id: manifestId,
    type: "structured-output-envelope",
    schemaVersion: 1,
    name: "envelope",
    path: finalPath,
    hash,
    sourceNodeId: ctx.nodeId ?? "unknown",
    createdAt,
  };
};
