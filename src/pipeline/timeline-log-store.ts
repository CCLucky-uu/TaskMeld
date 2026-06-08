import { appendFile, mkdir } from "node:fs/promises"
import { dirname, join } from "node:path"
import type { TimelineItem } from "./runtime-model"

type TimelineLogEntry = {
  id: string
  ts: string
  level: TimelineItem["level"]
  runId: string
  text: string
  detail?: unknown
}

type TimelineLogStoreOptions = {
  rootDir: string
}

const LOG_FILE_NAME = "timeline.log"

const stringifyTimelineEntry = (entry: TimelineLogEntry) => {
  const seen = new WeakSet<object>()
  return JSON.stringify(entry, (_key, value: unknown) => {
    // Allow keeping the full detail content, but cyclic-referencing objects themselves can't be directly JSON-serialized;
    // this is purely a safety net to prevent log persistence from being interrupted by an anomalous object in the main flow.
    if (typeof value !== "object" || value === null) return value
    if (seen.has(value)) return "[Circular]"
    seen.add(value)
    return value
  })
}

export const createTimelineLogStore = (options: TimelineLogStoreOptions) => {
  let writeChain = Promise.resolve()

  const getRunLogFile = (runId: string) => join(options.rootDir, runId, LOG_FILE_NAME)

  const appendTimeline = (runId: string, item: TimelineItem) => {
    const logFile = getRunLogFile(runId)
    let line = `${stringifyTimelineEntry({
      id: item.id,
      ts: item.createdAt,
      level: item.level,
      runId,
      text: item.text,
      ...(item.detail === undefined ? {} : { detail: item.detail }),
    })}\n`

    // Per-line size safety net to prevent oversized details from blowing up the log file
    const MAX_LOG_LINE_BYTES = 512 * 1024
    if (Buffer.byteLength(line, "utf8") > MAX_LOG_LINE_BYTES) {
      const truncated = line.slice(0, MAX_LOG_LINE_BYTES)
      const suffix = "[TRUNCATED_LOG_LINE]\n"
      const suffixBytes = Buffer.byteLength(suffix, "utf8")
      line = truncated.slice(0, MAX_LOG_LINE_BYTES - suffixBytes) + suffix
    }

    writeChain = writeChain
      .catch(() => {
        // Continue subsequent writes after a previous flush failure to avoid permanently deadlocking the entire queue.
      })
      .then(async () => {
        await mkdir(dirname(logFile), { recursive: true })
        await appendFile(logFile, line, "utf8")
      })

    return writeChain.catch(() => {
      // Log persistence failure must not affect pipeline execution; swallow the exception here and let the caller record it as needed.
    })
  }

  return {
    appendTimeline,
  }
}
