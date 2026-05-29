import { readdir, readFile, stat } from "node:fs/promises";
import { basename, resolve, sep } from "node:path";
import type { PipelineDefinition } from "../app/pipeline-config";
import { listIndexRecords, toStoredArtifactItem, type IndexListFilter } from "./artifact-index";

type ArtifactStatusBucket = "success" | "failed" | "rejected" | "unknown";

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
  missing?: boolean;
};

export type StoredArtifactListResult = {
  items: StoredArtifactItem[];
  nextCursor: string | null;
  source: "index" | "scan";
};

export type StoredArtifactContent = {
  rawText: string;
  parsed: unknown | null;
  content: unknown;
  meta: Record<string, unknown> | null;
};

// 导出结构固定为: 日期 -> 流水线 -> 节点 -> content[]
export type StoredArtifactExportData = Record<string, Record<string, Record<string, unknown[]>>>;

const DATE_BUCKET_RE = /^\d{4}-\d{2}-\d{2}$/;
const NUMERIC_TOKEN_RE = /^\d+$/;

const toUnixPath = (value: string) => value.replaceAll("\\", "/");

const formatDateBucketFromIso = (iso: string): string => {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "unknown";
  const d = new Date(ms);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
};

const normalizeDateBucketParam = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const normalized = value.trim();
  return DATE_BUCKET_RE.test(normalized) ? normalized : null;
};

const toRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const parseNodeIdFromFileName = (fileName: string, runId: string | null, relativePath: string): string | null => {
  if (!runId?.trim()) return null;
  const normalizedName = fileName.trim();
  if (!normalizedName.toLowerCase().endsWith(".json")) return null;
  const nameWithoutExt = normalizedName.slice(0, -".json".length);
  const runPrefix = `${runId}-`;
  if (!nameWithoutExt.startsWith(runPrefix)) return null;
  const tail = nameWithoutExt.slice(runPrefix.length);
  if (!tail) return null;
  const normalizedPath = toUnixPath(relativePath).toLowerCase();
  if (normalizedPath.includes("/envelopes/")) {
    // envelope 文件名格式: <runId>-<nodeId>-node-<nodeId>-<uuid>-envelope.json
    const marker = "-node-";
    const markerIndex = tail.indexOf(marker);
    if (markerIndex > 0) {
      const nodeId = tail.slice(0, markerIndex).trim();
      return nodeId || null;
    }
    return null;
  }
  // group/adpater 聚合文件格式不稳定（含 itemKey），这里不参与节点筛选，避免误判。
  if (tail.endsWith("-adapter-output") || tail.endsWith("-group-output")) return null;
  const tokens = tail.split("-").filter(Boolean);
  if (tokens.length < 3) return null;
  // 结构化节点产物命名格式: <runId>-<nodeId>-<artifactIndex>-<safeType>.json
  let artifactIndexPos = -1;
  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    if (NUMERIC_TOKEN_RE.test(tokens[i])) {
      artifactIndexPos = i;
      break;
    }
  }
  if (artifactIndexPos <= 0 || artifactIndexPos >= tokens.length - 1) return null;
  const nodeId = tokens.slice(0, artifactIndexPos).join("-").trim();
  return nodeId || null;
};

const walkFiles = async (rootDir: string): Promise<string[]> => {
  const out: string[] = [];
  const queue = [rootDir];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }>;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const nextPath = `${current}${sep}${entry.name}`;
      if (entry.isDirectory()) {
        queue.push(nextPath);
        continue;
      }
      if (entry.isFile()) out.push(nextPath);
    }
  }
  return out;
};

const parseArtifactPathMeta = (
  artifactRootAbs: string,
  filePathAbs: string,
  updatedAtIso: string,
): { status: ArtifactStatusBucket; dateBucket: string; runId: string | null; relativePath: string } => {
  const rawRelative = toUnixPath(filePathAbs.slice(artifactRootAbs.length).replace(/^[/\\]+/, ""));
  const segments = rawRelative.split("/").filter(Boolean);
  const statusRaw = segments[0] ?? "unknown";
  const status: ArtifactStatusBucket =
    statusRaw === "success" || statusRaw === "failed" || statusRaw === "rejected" ? statusRaw : "unknown";
  const dateRaw = segments[1] ?? "";
  const dateBucket = DATE_BUCKET_RE.test(dateRaw) ? dateRaw : formatDateBucketFromIso(updatedAtIso);
  let runId: string | null = null;
  if (segments[2]?.startsWith("batch-")) {
    // 批跑产物路径: status/date/batchRunId/runId/...
    runId = segments[3]?.startsWith("run-") ? segments[3] : null;
  } else {
    runId = segments[2]?.startsWith("run-") ? segments[2] : null;
  }
  return { status, dateBucket, runId, relativePath: rawRelative };
};

const shouldIncludeArtifactFile = (relativePath: string): boolean => {
  const normalized = toUnixPath(relativePath).toLowerCase();
  if (!normalized.endsWith(".json")) return false;
  return true;
};

/** 文件系统扫描（降级路径 / 索引重建用）。 */
export const scanStoredArtifacts = async (
  definitions: PipelineDefinition[],
  options?: {
    pipelineIds?: string[];
    nodeIds?: string[];
    dateFrom?: string | null;
    dateTo?: string | null;
    statuses?: string[];
    kinds?: string[];
    batchRunId?: string;
    runId?: string;
  },
): Promise<StoredArtifactItem[]> => {
  const pipelineIdFilter = options?.pipelineIds?.length ? new Set(options.pipelineIds) : null;
  const nodeIdFilter = options?.nodeIds?.length ? new Set(options.nodeIds) : null;
  const statusFilter = options?.statuses?.length ? new Set(options.statuses) : null;
  const kindFilter = options?.kinds?.length ? new Set(options.kinds) : null;
  const batchRunIdFilter = options?.batchRunId ?? null;
  const runIdFilter = options?.runId ?? null;
  const dateFrom = normalizeDateBucketParam(options?.dateFrom ?? null);
  const dateTo = normalizeDateBucketParam(options?.dateTo ?? null);

  const out: StoredArtifactItem[] = [];
  for (const definition of definitions) {
    if (pipelineIdFilter && !pipelineIdFilter.has(definition.id)) continue;
    const artifactRootAbs = resolve(definition.artifactDir);
    const files = await walkFiles(artifactRootAbs);
    for (const filePath of files) {
      const fileStat = await stat(filePath).catch(() => null);
      if (!fileStat || !fileStat.isFile()) continue;
      const updatedAt = fileStat.mtime.toISOString();
      const meta = parseArtifactPathMeta(artifactRootAbs, resolve(filePath), updatedAt);
      if (!shouldIncludeArtifactFile(meta.relativePath)) continue;
      const fileName = basename(filePath);
      const effectiveRunId = meta.runId ?? (meta.status === "rejected"
        ? (() => { const m = fileName.match(/^(run-.+?)(?:-n\d|-rejected-by)/); return m ? m[1] : null; })()
        : null);
      if (!effectiveRunId && meta.status !== "rejected") continue;

      if (statusFilter && !statusFilter.has(meta.status)) continue;
      if (runIdFilter && effectiveRunId !== runIdFilter) continue;
      // batchRunId 扫描过滤：路径含 batch-xxx 段
      if (batchRunIdFilter && !meta.relativePath.includes(`/${batchRunIdFilter}/`)) continue;

      const nodeId = parseNodeIdFromFileName(fileName, effectiveRunId, meta.relativePath);

      // kind 扫描过滤：通过文件名后缀和路径判断
      if (kindFilter) {
        const scanKind =
          meta.relativePath.includes("/envelopes/") ? "envelope"
          : fileName.includes("-adapter-output") ? "adapter"
          : fileName.includes("-group-output") ? "group"
          : "artifact";
        if (!kindFilter.has(scanKind)) continue;
      }

      if (nodeIdFilter && (!nodeId || !nodeIdFilter.has(nodeId))) continue;
      if (dateFrom !== null || dateTo !== null) {
        const rowDateBucket = DATE_BUCKET_RE.test(meta.dateBucket) ? meta.dateBucket : formatDateBucketFromIso(updatedAt);
        if (dateFrom !== null && rowDateBucket < dateFrom) continue;
        if (dateTo !== null && rowDateBucket > dateTo) continue;
      }
      out.push({
        pipelineId: definition.id,
        pipelineTitle: definition.title,
        status: meta.status,
        dateBucket: meta.dateBucket,
        runId: effectiveRunId,
        nodeId,
        relativePath: meta.relativePath,
        fileName,
        sizeBytes: fileStat.size,
        updatedAt,
      });
    }
  }

  return out.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
};

const encodeListCursor = (updatedAt: string, runId: string | null, fileName: string): string =>
  Buffer.from(`${updatedAt}|${runId ?? "unknown"}|${fileName}`).toString("base64url");

const decodeListCursor = (cursor: string): { updatedAt: string; runId: string; fileName: string } | null => {
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    const idx1 = raw.indexOf("|");
    const idx2 = raw.lastIndexOf("|");
    if (idx1 < 0 || idx2 <= idx1) return null;
    return { updatedAt: raw.slice(0, idx1), runId: raw.slice(idx1 + 1, idx2), fileName: raw.slice(idx2 + 1) };
  } catch {
    return null;
  }
};

/** 优先读索引，索引缺失时降级为文件系统扫描。支持 cursor 分页。 */
export const listStoredArtifacts = async (
  definitions: PipelineDefinition[],
  options?: {
    pipelineIds?: string[];
    nodeIds?: string[];
    dateFrom?: string | null;
    dateTo?: string | null;
    limit?: number;
    cursor?: string;
    statuses?: string[];
    kinds?: string[];
    batchRunId?: string;
    runId?: string;
  },
): Promise<StoredArtifactListResult> => {
  const pipelineIdFilter = options?.pipelineIds?.length ? new Set(options.pipelineIds) : null;
  const limit = Number.isFinite(options?.limit) ? Math.max(1, Math.min(5000, Math.trunc(options?.limit as number))) : 100;

  // 尝试从索引读取（不传 cursor，由外层统一分页）
  const indexItems: StoredArtifactItem[] = [];
  let indexAvailable = false;

  for (const definition of definitions) {
    if (pipelineIdFilter && !pipelineIdFilter.has(definition.id)) continue;
    const filter: IndexListFilter = {
      pipelineId: definition.id,
      statuses: options?.statuses,
      kinds: options?.kinds,
      nodeIds: options?.nodeIds,
      dateFrom: options?.dateFrom,
      dateTo: options?.dateTo,
      batchRunId: options?.batchRunId,
      runId: options?.runId,
      limit: 0, // 0 = 无限制，全量读出后统一排序分页
    };
    const result = await listIndexRecords(definition.artifactDir, filter);
    if (result.total > 0 || result.items.length > 0) {
      indexAvailable = true;
      for (const record of result.items) {
        indexItems.push(toStoredArtifactItem(record, definition.id, definition.title));
      }
    }
  }

  // 统一的排序与 cursor 分页（index 和 scan 使用相同编码）
  const sortItems = (items: StoredArtifactItem[]) =>
    items.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));

  const paginateWithCursor = (items: StoredArtifactItem[], source: "index" | "scan"): StoredArtifactListResult => {
    let startIndex = 0;
    if (options?.cursor) {
      const decoded = decodeListCursor(options.cursor);
      if (decoded) {
        const pos = items.findIndex(
          (item) =>
            item.updatedAt === decoded.updatedAt &&
            (item.runId ?? "unknown") === decoded.runId &&
            item.fileName === decoded.fileName,
        );
        if (pos >= 0) startIndex = pos + 1;
      }
    }
    const page = items.slice(startIndex, startIndex + limit);
    const nextCursor =
      page.length === limit && startIndex + limit < items.length
        ? encodeListCursor(page[page.length - 1].updatedAt, page[page.length - 1].runId, page[page.length - 1].fileName)
        : null;
    return { items: page, nextCursor, source };
  };

  if (indexAvailable) {
    return paginateWithCursor(sortItems(indexItems), "index");
  }

  // 降级：文件系统扫描
  const scanItems = await scanStoredArtifacts(definitions, {
    pipelineIds: options?.pipelineIds,
    nodeIds: options?.nodeIds,
    dateFrom: options?.dateFrom,
    dateTo: options?.dateTo,
    statuses: options?.statuses,
    kinds: options?.kinds,
    batchRunId: options?.batchRunId,
    runId: options?.runId,
  });
  return paginateWithCursor(sortItems(scanItems), "scan");
};

const resolveArtifactFilePath = (definition: PipelineDefinition, relativePath: string): string | null => {
  const rootAbs = resolve(definition.artifactDir);
  const targetAbs = resolve(rootAbs, relativePath);
  // 防止路径穿越，只允许读取当前流水线产物目录下文件。
  if (targetAbs !== rootAbs && !targetAbs.startsWith(`${rootAbs}${sep}`)) return null;
  return targetAbs;
};

export const readStoredArtifactContent = async (
  definition: PipelineDefinition,
  relativePath: string,
): Promise<StoredArtifactContent | null> => {
  const targetAbs = resolveArtifactFilePath(definition, relativePath);
  if (!targetAbs) return null;
  const fileStat = await stat(targetAbs).catch(() => null);
  if (!fileStat || !fileStat.isFile()) return null;
  const rawText = await readFile(targetAbs, "utf8");

  let parsed: unknown | null = null;
  try {
    parsed = JSON.parse(rawText) as unknown;
  } catch {
    parsed = null;
  }

  const parsedObj = toRecord(parsed);
  // 优先按 kind 字段分发，无 kind 时回退到旧启发式判断（向后兼容）
  const kind = typeof parsedObj?.kind === "string" ? parsedObj.kind : null;
  const isEnvelope = kind === "envelope" || (!kind && parsedObj && "envelope" in parsedObj);
  const envelopeObj = isEnvelope ? toRecord(parsedObj?.envelope) : null;
  const artifactObj = !isEnvelope && parsedObj && "artifact" in parsedObj ? toRecord(parsedObj.artifact) : null;
  const content = (() => {
    if (artifactObj) return artifactObj.content ?? parsed ?? rawText;
    if (envelopeObj) {
      const artifacts = Array.isArray(envelopeObj.artifacts) ? envelopeObj.artifacts : [];
      const contents = artifacts
        .map((item) => toRecord(item)?.content)
        .filter((item) => item !== undefined);
      const logs = Array.isArray(envelopeObj.logs) ? envelopeObj.logs : [];
      // envelope 预览返回 contents + logs，便于排错。
      return {
        contents,
        logs,
      };
    }
    return parsed ?? rawText;
  })();
  const meta = artifactObj ? toRecord(artifactObj.meta) : null;
  return {
    rawText,
    parsed,
    content,
    meta,
  };
};

export const exportStoredArtifactContents = async (
  definitions: PipelineDefinition[],
  options?: {
    pipelineIds?: string[];
    nodeIds?: string[];
    dateFrom?: string | null;
    dateTo?: string | null;
    limit?: number;
    statuses?: string[];
    kinds?: string[];
    batchRunId?: string;
    runId?: string;
  },
): Promise<StoredArtifactExportData> => {
  // 优先从索引选候选文件，减少全量 scan；索引缺失时 listStoredArtifacts 自动降级 scan
  const limit = Number.isFinite(options?.limit) ? Math.max(1, Math.trunc(options?.limit as number)) : 20000;
  const listResult = await listStoredArtifacts(definitions, {
    pipelineIds: options?.pipelineIds,
    nodeIds: options?.nodeIds,
    dateFrom: options?.dateFrom,
    dateTo: options?.dateTo,
    statuses: options?.statuses,
    kinds: options?.kinds,
    batchRunId: options?.batchRunId,
    runId: options?.runId,
    limit,
  });
  const items = listResult.items;
  const definitionById = new Map(definitions.map((definition) => [definition.id, definition]));
  const out: StoredArtifactExportData = {};

  for (const item of items.slice(0, limit)) {
    const definition = definitionById.get(item.pipelineId);
    if (!definition) continue;
    const content = await readStoredArtifactContent(definition, item.relativePath);
    if (!content) continue;

    const dateKey = item.dateBucket || "unknown";
    const pipelineKey = item.pipelineId || "unknown";
    const nodeKey = item.nodeId?.trim() || "unknown";

    if (!out[dateKey]) out[dateKey] = {};
    if (!out[dateKey][pipelineKey]) out[dateKey][pipelineKey] = {};
    if (!out[dateKey][pipelineKey][nodeKey]) out[dateKey][pipelineKey][nodeKey] = [];
    // 导出只保留产物内容，不包含 runId、文件名等元信息。
    // 若 content 本身是数组，则展开写入，避免导出结果出现“数组套数组”。
    if (Array.isArray(content.content)) {
      out[dateKey][pipelineKey][nodeKey].push(...content.content);
    } else {
      out[dateKey][pipelineKey][nodeKey].push(content.content);
    }
  }

  return out;
};
