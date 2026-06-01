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
  // Run artifacts are archived by "result status / date / runId" so flat directories don't become hard to troubleshoot by date or batch-clean.
  // Envelopes and artifacts are bucketed separately to keep node receipts apart from actual artifact content, reducing misread/misdelete risk.
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

/** Artifact write context — all callers provide metadata through this structure. */
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
 * Unified artifact file write entry point.
 * Responsibilities: directory creation, atomic write (temp file + rename), real SHA-256 hash computation, index append, ArtifactManifest construction.
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

  // Unified file serialization format; the kind field is used by readers to dispatch
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

  // Atomic write: write to temp file first, compute hash, then rename to final path
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

  // Append index record (best-effort; a failure here must not block the artifact write)
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
  // Append index record: the file is already atomically written (tmp+rename); index append failure does not lose the artifact file
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

/** After moving an artifact (e.g. rejected archiving), append an index record so queries can use artifactId deduplication to get the latest location. */
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

/** Save envelope receipt file to the envelopes sub-directory and append index, so kind=envelope is queryable in the list. */
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
  // Append index record: the file is already atomically written (tmp+rename); index append failure does not lose the artifact file
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
