import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import type { RunLogEntry, RunLogPage, RunLogQuery } from "./run-log-types";
import { isRecord } from "../utils/guards";

const MAX_LIMIT = 300;

const isRunLogLevel = (value: unknown): value is RunLogEntry["level"] =>
  value === "info" || value === "warn" || value === "error";

const normalizeLimit = (value: number | undefined) => {
  // 服务端必须兜底分页，避免前端漏传 limit 时把大型日志一次性读入 V8 堆。
  if (value === undefined) return MAX_LIMIT;
  if (!Number.isFinite(value)) return MAX_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.trunc(value)));
};

const normalizeOffset = (value: number | undefined) => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value ?? 0));
};

const parseRunLogLine = (line: string): RunLogEntry | null => {
  try {
    const parsed = JSON.parse(line) as unknown;
    if (!isRecord(parsed)) return null;
    const id = typeof parsed.id === "string" ? parsed.id.trim() : "";
    const ts = typeof parsed.ts === "string" ? parsed.ts.trim() : "";
    const level = parsed.level;
    const runId = typeof parsed.runId === "string" ? parsed.runId.trim() : "";
    const text = typeof parsed.text === "string" ? parsed.text : "";
    if (!id || !ts || !runId || !text || !isRunLogLevel(level)) return null;
    return {
      id,
      ts,
      level,
      runId,
      text,
      ...(parsed.detail === undefined ? {} : { detail: parsed.detail }),
    };
  } catch {
    return null;
  }
};

const stringifyMatchTarget = (entry: RunLogEntry) => {
  if (entry.detail === undefined) return entry.text;
  if (typeof entry.detail === "string") return `${entry.text}\n${entry.detail}`;
  try {
    return `${entry.text}\n${JSON.stringify(entry.detail)}`;
  } catch {
    return entry.text;
  }
};

const matchesQuery = (
  entry: RunLogEntry,
  query: {
    runId: string;
    levels: RunLogEntry["level"][] | null;
    keyword: string | null;
  },
) => {
  if (entry.runId !== query.runId) return false;
  if (query.levels && !query.levels.includes(entry.level)) return false;
  if (query.keyword) {
    const haystack = stringifyMatchTarget(entry).toLowerCase();
    if (!haystack.includes(query.keyword)) return false;
  }
  return true;
};

const scanRunLogLines = async (
  logFile: string,
  onLine: (line: string) => void,
) => {
  const stream = createReadStream(logFile, { encoding: "utf8" });
  const reader = createInterface({
    input: stream,
    crlfDelay: Infinity,
  });

  try {
    for await (const line of reader) {
      if (line.trim().length === 0) continue;
      onLine(line);
    }
  } finally {
    reader.close();
  }
};

export const readRunLogPage = async (
  logFile: string,
  query: RunLogQuery,
): Promise<RunLogPage> => {
  const limit = normalizeLimit(query.limit);
  const offset = normalizeOffset(query.offset);
  const keyword = query.keyword?.trim().toLowerCase() || null;
  const levels = query.levels && query.levels.length > 0 ? [...new Set(query.levels)] : null;
  const order = query.order === "asc" ? "asc" : "desc";
  let parseErrorCount = 0;
  let total = 0;
  const matcher = (entry: RunLogEntry) =>
    matchesQuery(entry, {
      runId: query.runId,
      levels,
      keyword,
    });

  await scanRunLogLines(logFile, (line) => {
    const entry = parseRunLogLine(line);
    if (!entry) {
      parseErrorCount += 1;
      return;
    }
    if (matcher(entry)) total += 1;
  });

  const start =
    order === "asc"
      ? offset
      : Math.max(0, total - offset - limit);
  const end =
    order === "asc"
      ? Math.min(total, offset + limit)
      : Math.max(0, total - offset);
  const items: RunLogEntry[] = [];
  let matchedIndex = 0;

  await scanRunLogLines(logFile, (line) => {
    if (matchedIndex >= end) return;
    const entry = parseRunLogLine(line);
    if (!entry || !matcher(entry)) return;
    if (matchedIndex >= start) items.push(entry);
    matchedIndex += 1;
  });

  if (order === "desc") items.reverse();

  const nextOffset = offset + items.length < total ? offset + items.length : null;

  return {
    items,
    total,
    offset,
    limit,
    nextOffset,
    hasMore: nextOffset !== null,
    parseErrorCount,
  };
};
