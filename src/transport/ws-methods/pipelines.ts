import type { WsMethodRegistry } from "./types"

const PIPELINE_ID_RE = /^[A-Za-z0-9_-]+$/

export const registerPipelineWsMethods = (registry: WsMethodRegistry): void => {
  registry.register("pipeline.list", (_params, ctx) => {
    const items = ctx.app.listPipelines().map((def) => ({ id: def.id, title: def.title }))
    return { ok: true, payload: { items } }
  })

  registry.register("pipeline.create", async (params, ctx) => {
    const pipelineId = typeof params.id === "string" ? params.id.trim() : ""
    if (!PIPELINE_ID_RE.test(pipelineId)) {
      return { ok: false, error: "pipeline_id_invalid" }
    }
    const cloneFrom =
      typeof params.cloneFrom === "string" && params.cloneFrom.trim() ? params.cloneFrom.trim() : undefined
    const title =
      typeof params.title === "string" && params.title.trim() ? params.title.trim() : `Pipeline ${pipelineId}`
    try {
      const item = await ctx.app.createPipeline({ id: pipelineId, title, cloneFrom })
      return { ok: true, payload: { ok: true, item: { id: item.id, title: item.title } } }
    } catch (error) {
      const detail = error instanceof Error ? error.message : "pipeline_create_failed"
      return { ok: false, error: detail }
    }
  })

  registry.register("pipeline.rename", async (params, ctx) => {
    const pipelineId = typeof params.pipelineId === "string" ? params.pipelineId : ""
    const title = typeof params.title === "string" ? params.title.trim() : ""
    if (!pipelineId || !title) {
      return { ok: false, error: "pipeline_title_invalid" }
    }
    try {
      const item = ctx.app.renamePipeline(pipelineId, title)
      return { ok: true, payload: { ok: true, item: { id: item.id, title: item.title } } }
    } catch (error) {
      const detail = error instanceof Error ? error.message : "pipeline_rename_failed"
      return { ok: false, error: detail }
    }
  })

  registry.register("pipeline.delete", async (params, ctx) => {
    const pipelineId = typeof params.pipelineId === "string" ? params.pipelineId : ""
    if (!pipelineId) {
      return { ok: false, error: "pipeline_id_required" }
    }
    try {
      const deleted = ctx.app.deletePipeline(pipelineId)
      return { ok: true, payload: { ok: true, pipelineId: deleted.pipelineId } }
    } catch (error) {
      const detail = error instanceof Error ? error.message : "pipeline_delete_failed"
      return { ok: false, error: detail }
    }
  })
}
