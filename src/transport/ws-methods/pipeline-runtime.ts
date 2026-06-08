import type { WsMethodRegistry } from "./types"
import type { PipelineRunIdentityTarget } from "../../services/pipeline-service"
import { readPipelineIdentitySnapshot } from "../../services/pipeline-service"
import { diagnoseNodeDependency } from "../../pipeline/diagnostics/index"
import { mergeIdentityTargets, readIdentityTargetFromBody, formatError } from "./utils"

export const registerPipelineRuntimeWsMethods = (registry: WsMethodRegistry): void => {
  // pipeline.current
  registry.register("pipeline.current", (params, ctx) => {
    const pipelineId = typeof params.pipelineId === "string" ? params.pipelineId : ""
    const runtime = ctx.app.getPipelineRuntime(pipelineId)
    const definition = ctx.app.getPipelineDefinition(pipelineId)
    if (!runtime || !definition) {
      return { ok: false, error: "pipeline_not_found" }
    }
    const run = runtime.runtime.getRun()
    const workflow = runtime.workflow.getWorkflow()
    const nodes =
      workflow?.nodes && workflow.nodes.length > 0
        ? run.nodes.map((node: { id: string }) => {
            const matched = workflow.nodes.find((wNode: { id: string }) => wNode.id === node.id)
            return {
              ...node,
              isMainline: matched?.isMainline ?? true,
              lane: matched?.lane ?? "main",
              parallelGroupId: matched?.parallelGroupId ?? null,
            }
          })
        : run.nodes
    return {
      ok: true,
      payload: {
        run: { ...run, nodes },
        runId: run.id,
        nodes,
        scheduler: runtime.pipeline.getSchedulerState(),
        pipelineId,
      },
    }
  })

  // pipeline.status
  registry.register("pipeline.status", (params, ctx) => {
    const pipelineId = typeof params.pipelineId === "string" ? params.pipelineId : ""
    const runtime = ctx.app.getPipelineRuntime(pipelineId)
    if (!runtime) {
      return { ok: false, error: "pipeline_not_found" }
    }
    const target: PipelineRunIdentityTarget | undefined =
      typeof params.runId === "string" || typeof params.batchRunId === "string"
        ? {
            runId: typeof params.runId === "string" ? params.runId : undefined,
            batchRunId: typeof params.batchRunId === "string" ? params.batchRunId : undefined,
          }
        : undefined
    const result = ctx.services.pipelineService.getPipelineExecutionStatus(pipelineId, target)
    return { ok: true, payload: result }
  })

  // pipeline.run
  registry.register("pipeline.run", async (params, ctx) => {
    const pipelineId = typeof params.pipelineId === "string" ? params.pipelineId : ""
    const runtime = ctx.app.getPipelineRuntime(pipelineId)
    if (!runtime) {
      return { ok: false, error: "pipeline_not_found" }
    }
    const started = await ctx.services.pipelineService.startPipeline(pipelineId)
    if (started.ok === false) {
      return { ok: false, error: started.error, payload: { ...started } }
    }
    return { ok: true, payload: started }
  })

  // pipeline.stop
  registry.register("pipeline.stop", async (params, ctx) => {
    const pipelineId = typeof params.pipelineId === "string" ? params.pipelineId : ""
    const runtime = ctx.app.getPipelineRuntime(pipelineId)
    if (!runtime) {
      return { ok: false, error: "pipeline_not_found" }
    }
    const target = mergeIdentityTargets(readIdentityTargetFromBody(params as Record<string, unknown>), {
      runId: typeof params.runId === "string" ? params.runId : undefined,
      batchRunId: typeof params.batchRunId === "string" ? params.batchRunId : undefined,
    })
    const stopped = ctx.services.pipelineService.stopPipeline(pipelineId, target)
    if (stopped.ok === false) {
      return { ok: false, error: stopped.error, payload: { ...stopped } }
    }
    return { ok: true, payload: stopped }
  })

  // pipeline.executorBindings
  registry.register("pipeline.executorBindings", (params, ctx) => {
    const pipelineId = typeof params.pipelineId === "string" ? params.pipelineId : ""
    const runtime = ctx.app.getPipelineRuntime(pipelineId)
    if (!runtime) {
      return { ok: false, error: "pipeline_not_found" }
    }
    const executorSessionByAgentId = runtime.gateway.getExecutorSessionByAgentId()
    const sessionCache = runtime.gateway.getSessionCache()
    return {
      ok: true,
      payload: {
        bindings: Object.fromEntries(executorSessionByAgentId.entries()),
        sessions: sessionCache.map((s: { id: string; title: string }) => ({ id: s.id, title: s.title })),
        pipelineId,
      },
    }
  })

  // pipeline.node.retry
  registry.register("pipeline.node.retry", async (params, ctx) => {
    const pipelineId = typeof params.pipelineId === "string" ? params.pipelineId : ""
    const nodeId = typeof params.nodeId === "string" ? params.nodeId : ""
    const itemKey = typeof params.itemKey === "string" && params.itemKey.trim() ? params.itemKey.trim() : undefined
    const runtime = ctx.app.getPipelineRuntime(pipelineId)
    if (!runtime) {
      return { ok: false, error: "pipeline_not_found" }
    }
    if (!nodeId) {
      return { ok: false, error: "node_id_required" }
    }
    const result = await ctx.services.pipelineService.retryNode({ pipelineId, nodeId, itemKey })
    if (!result.ok) {
      return { ok: false, error: (result as { error?: string }).error ?? "retry_failed", payload: result }
    }
    return { ok: true, payload: result }
  })

  // pipeline.node.diagnostics
  registry.register("pipeline.node.diagnostics", (params, ctx) => {
    const pipelineId = typeof params.pipelineId === "string" ? params.pipelineId : ""
    const nodeId = typeof params.nodeId === "string" ? params.nodeId : ""
    const itemKey = typeof params.itemKey === "string" && params.itemKey.trim() ? params.itemKey.trim() : undefined
    const runtime = ctx.app.getPipelineRuntime(pipelineId)
    if (!runtime) {
      return { ok: false, error: "pipeline_not_found" }
    }
    if (!nodeId) {
      return { ok: false, error: "node_id_required" }
    }
    const workflowNode = runtime.workflow.getWorkflowNodeById(nodeId)
    if (!workflowNode) {
      return { ok: false, error: "node_not_found" }
    }
    const diagnostics = diagnoseNodeDependency(runtime.runtime.getRun(), runtime.workflow, nodeId, itemKey)
    return { ok: true, payload: { nodeId, itemKey: itemKey ?? null, diagnostics } }
  })

  // pipeline.items
  registry.register("pipeline.items", (params, ctx) => {
    const pipelineId = typeof params.pipelineId === "string" ? params.pipelineId : ""
    const runtime = ctx.app.getPipelineRuntime(pipelineId)
    if (!runtime) {
      return { ok: false, error: "pipeline_not_found" }
    }
    return { ok: true, payload: { items: runtime.pipeline.getItemRuns(), pipelineId } }
  })

  // pipeline.output.list
  registry.register("pipeline.output.list", async (params, ctx) => {
    const pipelineId = typeof params.pipelineId === "string" ? params.pipelineId : ""
    const runtime = ctx.app.getPipelineRuntime(pipelineId)
    if (!runtime) {
      return { ok: false, error: "pipeline_not_found" }
    }
    const runId = typeof params.runId === "string" && params.runId.trim() ? params.runId.trim() : undefined
    const batchRunId =
      typeof params.batchRunId === "string" && params.batchRunId.trim() ? params.batchRunId.trim() : undefined
    const outputs = await runtime.output.list()
    let filtered = outputs
    if (runId) filtered = filtered.filter((o) => o.runId === runId)
    if (batchRunId) filtered = filtered.filter((o) => o.batchRunId === batchRunId)
    filtered.sort((a, b) => b.producedAt.localeCompare(a.producedAt))
    return { ok: true, payload: { ok: true, pipelineId, items: filtered } }
  })
}
