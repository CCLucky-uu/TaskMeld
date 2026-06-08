import type { PipelineRegistry } from "../app/pipeline-registry"
import {
  exportStoredArtifactContents,
  listStoredArtifacts,
  readStoredArtifactContent,
  scanStoredArtifacts,
  type StoredArtifactExportData,
  type StoredArtifactListResult,
} from "../artifacts/storage-service"
import { rebuildArtifactIndex } from "../artifacts/artifact-index"
import {
  planCleanup,
  executeCleanup,
  cleanupEmptyDirs,
  type CleanupPlan,
  type CleanupOptions,
} from "../artifacts/artifact-cleanup"

export type ArtifactListQuery = {
  pipelineIds?: string[]
  nodeIds?: string[]
  dateFrom?: string | null
  dateTo?: string | null
  limit?: number
  cursor?: string
  statuses?: string[]
  kinds?: string[]
  batchRunId?: string
  runId?: string
}

export type ArtifactContentQuery = {
  pipelineId: string
  relativePath: string
}

export type ArtifactService = {
  listArtifacts: (query?: ArtifactListQuery) => Promise<StoredArtifactListResult>
  getArtifactContent: (query: ArtifactContentQuery) => Promise<{
    pipelineId: string
    relativePath: string
    content: Awaited<ReturnType<typeof readStoredArtifactContent>>
  } | null>
  exportArtifactContents: (query?: ArtifactListQuery) => Promise<StoredArtifactExportData>
  rebuildIndex: (pipelineId?: string) => Promise<{ indexed: number; skipped: number; warnings: string[] }>
  planCleanup: (pipelineId: string, options?: CleanupOptions) => Promise<CleanupPlan>
  executeCleanup: (
    pipelineId: string,
    plan: CleanupPlan,
  ) => Promise<{ deleted: number; failed: number; warnings: string[] }>
}

export const createArtifactService = (app: PipelineRegistry): ArtifactService => {
  const listArtifacts = async (query?: ArtifactListQuery): Promise<StoredArtifactListResult> =>
    listStoredArtifacts(app.listPipelines(), {
      pipelineIds: query?.pipelineIds,
      nodeIds: query?.nodeIds,
      dateFrom: query?.dateFrom,
      dateTo: query?.dateTo,
      limit: query?.limit,
      cursor: query?.cursor,
      statuses: query?.statuses,
      kinds: query?.kinds,
      batchRunId: query?.batchRunId,
      runId: query?.runId,
    })

  const getArtifactContent = async (
    query: ArtifactContentQuery,
  ): Promise<{
    pipelineId: string
    relativePath: string
    content: Awaited<ReturnType<typeof readStoredArtifactContent>>
  } | null> => {
    const definition = app.getPipelineDefinition(query.pipelineId)
    if (!definition) return null
    const content = await readStoredArtifactContent(definition, query.relativePath)
    if (!content) return null
    return {
      pipelineId: query.pipelineId,
      relativePath: query.relativePath,
      content,
    }
  }

  const exportArtifactContents = async (query?: ArtifactListQuery): Promise<StoredArtifactExportData> =>
    exportStoredArtifactContents(app.listPipelines(), {
      pipelineIds: query?.pipelineIds,
      nodeIds: query?.nodeIds,
      dateFrom: query?.dateFrom,
      dateTo: query?.dateTo,
      limit: query?.limit,
    })

  const rebuildIndexFn = async (pipelineId?: string) => {
    const definitions = pipelineId
      ? ([app.getPipelineDefinition(pipelineId)].filter(Boolean) as ReturnType<PipelineRegistry["listPipelines"]>)
      : app.listPipelines()
    let indexed = 0
    let skipped = 0
    const warnings: string[] = []
    for (const definition of definitions) {
      const result = await rebuildArtifactIndex(definition, (d) => scanStoredArtifacts([d]))
      indexed += result.indexed
      skipped += result.skipped
      warnings.push(...result.warnings)
    }
    return { indexed, skipped, warnings }
  }

  return {
    listArtifacts,
    getArtifactContent,
    exportArtifactContents,
    rebuildIndex: rebuildIndexFn,
    planCleanup: (pipelineId, options) => {
      const definition = app.getPipelineDefinition(pipelineId)
      if (!definition) throw new Error(`pipeline_not_found:${pipelineId}`)
      return planCleanup(definition, options)
    },
    executeCleanup: (pipelineId, plan) => {
      const definition = app.getPipelineDefinition(pipelineId)
      if (!definition) throw new Error(`pipeline_not_found:${pipelineId}`)
      return executeCleanup(definition, plan)
    },
  }
}
