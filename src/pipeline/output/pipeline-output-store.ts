import { appendFile, mkdir, readFile } from "node:fs/promises"
import type { PipelineOutput } from "../types/pipeline-output"
import { resolveTaskMeldDataPath } from "../../app/data-dir"

const getIndexPath = (pipelineId: string): string =>
  resolveTaskMeldDataPath("pipelines", pipelineId, "outputs", "index.jsonl")

const ensureDir = async (pipelineId: string): Promise<void> => {
  await mkdir(resolveTaskMeldDataPath("pipelines", pipelineId, "outputs"), { recursive: true })
}

export type PipelineOutputStore = {
  append: (output: PipelineOutput) => Promise<boolean>
  list: () => Promise<PipelineOutput[]>
  getByRunId: (runId: string) => Promise<PipelineOutput | null>
  getById: (outputId: string) => Promise<PipelineOutput | null>
  has: (outputId: string) => Promise<boolean>
}

export const createPipelineOutputStore = (pipelineId: string): PipelineOutputStore => {
  const indexPath = getIndexPath(pipelineId)

  const loadAll = async (): Promise<PipelineOutput[]> => {
    try {
      const raw = await readFile(indexPath, "utf8")
      const lines = raw.trim().split("\n").filter(Boolean)
      return lines
        .map((line) => {
          try {
            return JSON.parse(line) as PipelineOutput
          } catch {
            return null
          }
        })
        .filter((o): o is PipelineOutput => o !== null && o.schemaVersion === 1)
    } catch {
      return []
    }
  }

  const store: PipelineOutputStore = {
    append: async (output: PipelineOutput): Promise<boolean> => {
      // Dedup: check if output already exists
      const existing = await store.has(output.outputId)
      if (existing) return false

      await ensureDir(pipelineId)
      const line = JSON.stringify(output) + "\n"
      await appendFile(indexPath, line, "utf8")
      return true
    },

    list: async (): Promise<PipelineOutput[]> => {
      return loadAll()
    },

    getByRunId: async (runId: string): Promise<PipelineOutput | null> => {
      const all = await loadAll()
      return all.find((o) => o.runId === runId) ?? null
    },

    getById: async (outputId: string): Promise<PipelineOutput | null> => {
      const all = await loadAll()
      return all.find((o) => o.outputId === outputId) ?? null
    },

    has: async (outputId: string): Promise<boolean> => {
      const all = await loadAll()
      return all.some((o) => o.outputId === outputId)
    },
  }

  return store
}
