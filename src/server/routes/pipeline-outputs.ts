import type { Router, RequestContext } from "../types.js";
import type { PipelineRegistry } from "../../app/pipeline-registry.js";

type OutputServices = {
  app: PipelineRegistry;
};

export const registerPipelineOutputsRoutes = (router: Router): void => {
  // GET /api/pipelines/:pipelineId/outputs
  router.register("GET", "/api/pipelines/:pipelineId/outputs", async (ctx: RequestContext) => {
    const { app } = ctx.options as unknown as OutputServices;
    const { pipelineId } = ctx.params;
    const runtime = app.getPipelineRuntime(pipelineId);
    if (!runtime) {
      ctx.sendJson(404, { ok: false, error: "pipeline_not_found", pipelineId });
      return;
    }

    const runId = ctx.url.searchParams.get("runId")?.trim() || undefined;
    const batchRunId = ctx.url.searchParams.get("batchRunId")?.trim() || undefined;

    const outputs = await runtime.output.list();
    let filtered = outputs;
    if (runId) filtered = filtered.filter((o) => o.runId === runId);
    if (batchRunId) filtered = filtered.filter((o) => o.batchRunId === batchRunId);

    // Sort newest first
    filtered.sort((a, b) => b.producedAt.localeCompare(a.producedAt));

    ctx.sendJson(200, { ok: true, pipelineId, items: filtered });
  });
};
