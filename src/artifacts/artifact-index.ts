import { appendFile, readFile, rename, stat, writeFile } from "node:fs/promises"
import { createReadStream } from "node:fs"
import { createInterface } from "node:readline"
import { basename, resolve } from "node:path"
import type { PipelineDefinition } from "../app/pipeline-config"
import type { StoredArtifactItem } from "./storage-service"

export type StoredArtifactIndexRecord = {
  schemaVersion: 1
  artifactId: string
  pipelineId: string
  status: string
  kind: string
  dateBucket: string
  runId: string | null
  batchRunId: string | null
  nodeId: string | null
  groupId: string | null
  itemKey: string | null
  requestId: string | null
  type: string
  artifactSchemaVersion: number
  name: string
  relativePath: string
  sizeBytes: number
  hash: string
  createdAt: string
  updatedAt: string
}

export type IndexListFilter = {
  pipelineId?: string
  statuses?: string[]
  kinds?: string[]
  nodeIds?: string[]
  dateFrom?: string | null
  dateTo?: string | null
  batchRunId?: string
  runId?: string
  cursor?: string
  limit?: number
}

export type IndexListResult = {
  items: StoredArtifactIndexRecord[]
  nextCursor: string | null
  total: number
}

const INDEX_FILE_NAME = "index.jsonl"

export const getIndexPath = (artifactDir: string): string => resolve(artifactDir, INDEX_FILE_NAME)

type IndexCursorV2 = { v: 2; updatedAt: string; artifactId: string; indexUpdatedAt: string }

const encodeCursorV2 = (cursor: IndexCursorV2): string =>
  `v2:${Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url")}`

/** Compatible decoding for v2 and legacy cursors. Returns null for invalid input. */
const decodeAnyCursor = (cursor: string): { updatedAt: string; artifactId: string; indexUpdatedAt?: string } | null => {
  if (cursor.startsWith("v2:")) {
    try {
      const parsed = JSON.parse(Buffer.from(cursor.slice(3), "base64url").toString("utf8")) as Partial<IndexCursorV2>
      if (parsed.v === 2 && parsed.updatedAt && parsed.artifactId) {
        return { updatedAt: parsed.updatedAt, artifactId: parsed.artifactId, indexUpdatedAt: parsed.indexUpdatedAt }
      }
      return null
    } catch {
      return null
    }
  }
  // Legacy v1 cursor format: base64url(updatedAt|artifactId)
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8")
    const idx = raw.lastIndexOf("|")
    if (idx < 0) return null
    return { updatedAt: raw.slice(0, idx), artifactId: raw.slice(idx + 1) }
  } catch {
    return null
  }
}

const getIndexUpdatedAt = async (artifactDir: string): Promise<string> => {
  try {
    const s = await stat(getIndexPath(artifactDir))
    return s.mtime.toISOString()
  } catch {
    return ""
  }
}

export type ArtifactIndexWarning = {
  code: "ARTIFACT_INDEX_APPEND_FAILED"
  artifactDir: string
  indexPath: string
  relativePath: string
  message: string
}

export type AppendIndexRecordResult = { ok: true } | { ok: false; warning: ArtifactIndexWarning }

/** Append one index record to index.jsonl. Does not throw on failure; returns failure info for caller observation. */
export const appendIndexRecord = async (
  artifactDir: string,
  record: StoredArtifactIndexRecord,
): Promise<AppendIndexRecordResult> => {
  const indexPath = getIndexPath(artifactDir)
  try {
    await appendFile(indexPath, `${JSON.stringify(record)}\n`, "utf8")
    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      warning: {
        code: "ARTIFACT_INDEX_APPEND_FAILED",
        artifactDir,
        indexPath,
        relativePath: record.relativePath,
        message: error instanceof Error ? error.message : String(error),
      },
    }
  }
}

/** Read all lines from the index file, skipping corrupt lines. Uses streaming reads to avoid loading a large index entirely into memory. */
export const readIndexRecords = async (artifactDir: string): Promise<StoredArtifactIndexRecord[]> => {
  const indexPath = getIndexPath(artifactDir)
  const records: StoredArtifactIndexRecord[] = []
  try {
    const reader = createInterface({
      input: createReadStream(indexPath, { encoding: "utf8" }),
      crlfDelay: Infinity,
    })
    for await (const line of reader) {
      if (!line.trim()) continue
      try {
        records.push(JSON.parse(line) as StoredArtifactIndexRecord)
      } catch {
        // Skip corrupt lines
      }
    }
  } catch {
    return []
  }
  return records
}

const dedupeLatestByArtifactId = (records: StoredArtifactIndexRecord[]): StoredArtifactIndexRecord[] => {
  const latest = new Map<string, StoredArtifactIndexRecord>()
  for (const record of records) {
    const previous = latest.get(record.artifactId)
    if (!previous || Date.parse(record.updatedAt) >= Date.parse(previous.updatedAt)) {
      latest.set(record.artifactId, record)
    }
  }
  return [...latest.values()]
}

/** Read from index, filter, sort, paginate. Builds on top of readIndexRecords to provide query capabilities. */
export const listIndexRecords = async (artifactDir: string, filter: IndexListFilter): Promise<IndexListResult> => {
  const records = dedupeLatestByArtifactId(await readIndexRecords(artifactDir))
  const limitRaw = filter.limit ?? 100
  const limit =
    limitRaw <= 0
      ? Number.MAX_SAFE_INTEGER
      : Number.isFinite(limitRaw)
        ? Math.max(1, Math.min(5000, Math.trunc(limitRaw)))
        : 100
  const statusSet = filter.statuses?.length ? new Set(filter.statuses) : null
  const kindSet = filter.kinds?.length ? new Set(filter.kinds) : null
  const nodeIdSet = filter.nodeIds?.length ? new Set(filter.nodeIds) : null
  const dateFrom = filter.dateFrom ?? null
  const dateTo = filter.dateTo ?? null

  const matched: StoredArtifactIndexRecord[] = []
  for (const record of records) {
    if (filter.pipelineId && record.pipelineId !== filter.pipelineId) continue
    if (statusSet && !statusSet.has(record.status)) continue
    if (kindSet && !kindSet.has(record.kind)) continue
    if (nodeIdSet && (!record.nodeId || !nodeIdSet.has(record.nodeId))) continue
    if (filter.batchRunId && record.batchRunId !== filter.batchRunId) continue
    if (filter.runId && record.runId !== filter.runId) continue
    if (dateFrom && record.dateBucket < dateFrom) continue
    if (dateTo && record.dateBucket > dateTo) continue
    matched.push(record)
  }

  // Sort by updatedAt DESC, artifactId ASC
  matched.sort((a, b) => {
    const dateDiff = Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
    if (dateDiff !== 0) return dateDiff
    return a.artifactId.localeCompare(b.artifactId)
  })

  const total = matched.length

  // cursor pagination: v2 cursor includes indexUpdatedAt; after index rebuild, old cursors automatically restart from the beginning
  let startIndex = 0
  const currentIndexUpdatedAt = await getIndexUpdatedAt(artifactDir)
  if (filter.cursor) {
    const decoded = decodeAnyCursor(filter.cursor)
    if (decoded) {
      // Index generation changed → cursor expired, restart from the beginning
      if (decoded.indexUpdatedAt && decoded.indexUpdatedAt !== currentIndexUpdatedAt) {
        startIndex = 0
      } else {
        const cursorPos = matched.findIndex(
          (rec) => rec.updatedAt === decoded.updatedAt && rec.artifactId === decoded.artifactId,
        )
        if (cursorPos >= 0) startIndex = cursorPos + 1
      }
    }
  }

  const page = matched.slice(startIndex, startIndex + limit)
  const nextCursor =
    page.length === limit && startIndex + limit < total
      ? encodeCursorV2({
          v: 2,
          updatedAt: page[page.length - 1].updatedAt,
          artifactId: page[page.length - 1].artifactId,
          indexUpdatedAt: currentIndexUpdatedAt,
        })
      : null

  return { items: page, nextCursor, total }
}

/** Convert from StoredArtifactIndexRecord to StoredArtifactItem. */
export const toStoredArtifactItem = (
  record: StoredArtifactIndexRecord,
  pipelineId: string,
  pipelineTitle: string,
): StoredArtifactItem => ({
  pipelineId,
  pipelineTitle,
  status: record.status as StoredArtifactItem["status"],
  dateBucket: record.dateBucket,
  runId: record.runId,
  nodeId: record.nodeId,
  relativePath: record.relativePath,
  fileName: basename(record.relativePath),
  sizeBytes: record.sizeBytes,
  updatedAt: record.updatedAt,
  artifactId: record.artifactId,
})

/**
 * Scan a single pipeline's artifact directory and rebuild its index.jsonl.
 */
export const rebuildArtifactIndex = async (
  definition: PipelineDefinition,
  scan: (definition: PipelineDefinition) => Promise<StoredArtifactItem[]>,
): Promise<{ indexed: number; skipped: number; warnings: string[] }> => {
  const warnings: string[] = []
  let indexed = 0
  let skipped = 0
  const indexPath = getIndexPath(definition.artifactDir)

  try {
    const items = await scan(definition)
    items.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))

    const tmpPath = `${indexPath}.tmp-${Date.now()}`
    const stream: string[] = []
    for (const item of items) {
      const record = await enrichItemToIndexRecord(item, definition)
      if (record) {
        stream.push(JSON.stringify(record))
        indexed += 1
      } else {
        skipped += 1
      }
    }
    await writeFile(tmpPath, `${stream.join("\n")}\n`, "utf8")
    await rename(tmpPath, indexPath)
  } catch (error) {
    warnings.push(
      `Failed to rebuild index (pipeline ${definition.id}): ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  return { indexed, skipped, warnings }
}

/** Enrich a StoredArtifactItem with its file content to produce a complete IndexRecord. */
const enrichItemToIndexRecord = async (
  item: StoredArtifactItem,
  definition: PipelineDefinition,
): Promise<StoredArtifactIndexRecord | null> => {
  const filePath = resolve(definition.artifactDir, item.relativePath)
  let parsed: Record<string, unknown> | null = null
  try {
    const raw = await readFile(filePath, "utf8")
    parsed = JSON.parse(raw) as Record<string, unknown>
  } catch {
    // When unreadable, use path-based heuristics
  }

  const artifactObj =
    parsed && typeof parsed.artifact === "object" && parsed.artifact !== null
      ? (parsed.artifact as Record<string, unknown>)
      : null
  const kind =
    typeof parsed?.kind === "string"
      ? parsed.kind
      : parsed && "envelope" in parsed
        ? "envelope"
        : item.relativePath.includes("/envelopes/")
          ? "envelope"
          : item.fileName.includes("-adapter-output")
            ? "adapter"
            : item.fileName.includes("-group-output")
              ? "group"
              : "artifact"

  return {
    schemaVersion: 1,
    artifactId:
      typeof parsed?.artifactId === "string" ? parsed.artifactId : `legacy:${item.pipelineId}:${item.relativePath}`,
    pipelineId: item.pipelineId,
    status: item.status,
    kind,
    dateBucket: item.dateBucket,
    runId: item.runId,
    batchRunId: null,
    nodeId: item.nodeId ?? (typeof parsed?.nodeId === "string" ? parsed.nodeId : null),
    groupId: typeof parsed?.groupId === "string" ? parsed.groupId : null,
    itemKey: typeof parsed?.itemKey === "string" ? parsed.itemKey : null,
    requestId: typeof parsed?.requestId === "string" ? parsed.requestId : null,
    type: typeof artifactObj?.type === "string" ? artifactObj.type : "unknown",
    artifactSchemaVersion: typeof artifactObj?.schemaVersion === "number" ? artifactObj.schemaVersion : 1,
    name: typeof artifactObj?.name === "string" ? artifactObj.name : item.fileName,
    relativePath: item.relativePath,
    sizeBytes: item.sizeBytes,
    hash: "",
    createdAt: item.updatedAt,
    updatedAt: item.updatedAt,
  }
}
