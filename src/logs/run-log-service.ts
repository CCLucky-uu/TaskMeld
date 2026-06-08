import { constants } from "node:fs"
import { access, readdir } from "node:fs/promises"
import { join } from "node:path"
import { readRunLogPage } from "./run-log-reader"
import type { RunLogPage, RunLogQuery } from "./run-log-types"

type RunLogServiceOptions = {
  rootDir: string
}

const TIMELINE_LOG_FILE = "timeline.log"

export const createRunLogService = (options: RunLogServiceOptions) => {
  const getRunLogPath = (runId: string) => join(options.rootDir, runId, TIMELINE_LOG_FILE)

  const assertRunLogExists = async (runId: string) => {
    await access(getRunLogPath(runId), constants.F_OK)
  }

  const queryTimeline = async (query: RunLogQuery): Promise<RunLogPage> => {
    const runId = query.runId.trim()
    await assertRunLogExists(runId)
    return readRunLogPage(getRunLogPath(runId), { ...query, runId })
  }

  const readRawTimeline = async (runId: string) => {
    const normalizedRunId = runId.trim()
    await assertRunLogExists(normalizedRunId)
    return getRunLogPath(normalizedRunId)
  }

  const listRuns = async () => {
    try {
      const entries = await readdir(options.rootDir, { withFileTypes: true })
      return entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort((a, b) => b.localeCompare(a))
    } catch {
      return []
    }
  }

  return {
    queryTimeline,
    readRawTimeline,
    listRuns,
  }
}
