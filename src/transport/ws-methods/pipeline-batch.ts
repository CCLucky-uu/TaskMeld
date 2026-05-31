import type { WsMethodRegistry } from "./types";
import { normalizePoolItems } from "../../pipeline/item-batch-controller";
import { readPipelineIdentitySnapshot } from "../../services/pipeline-service";
import { mergeIdentityTargets, readIdentityTargetFromBody, formatError } from "./utils";

export const registerPipelineBatchWsMethods = (registry: WsMethodRegistry): void => {
  // pipeline.batchRun.status
  registry.register("pipeline.batchRun.status", (params, ctx) => {
    const pipelineId = typeof params.pipelineId === "string" ? params.pipelineId : "";
    const runtime = ctx.app.getPipelineRuntime(pipelineId);
    if (!runtime) return { ok: false, error: "pipeline_not_found" };
    const batchRunState = runtime.pipeline.getBatchRunState();
    const identity = readPipelineIdentitySnapshot(pipelineId, runtime.runtime.getRun(), batchRunState);
    return { ok: true, payload: { ok: true, state: batchRunState, ...identity } };
  });

  // pipeline.batchRun.start
  registry.register("pipeline.batchRun.start", async (params, ctx) => {
    const pipelineId = typeof params.pipelineId === "string" ? params.pipelineId : "";
    const runtime = ctx.app.getPipelineRuntime(pipelineId);
    if (!runtime) return { ok: false, error: "pipeline_not_found" };
    const items = normalizePoolItems(params.items ?? params.keywords ?? params.pool ?? params);
    const batchSize = typeof params.batchSize === "number" ? params.batchSize
      : typeof params.size === "number" ? params.size
      : typeof params.chunkSize === "number" ? params.chunkSize : undefined;
    const startIndex = typeof params.startIndex === "number" ? params.startIndex : undefined;
    const startBatch = typeof params.startBatch === "number" ? params.startBatch : undefined;
    const started = ctx.services.pipelineService.startBatchRun({ pipelineId, items, batchSize, startIndex, startBatch });
    if (started.ok === false) {
      return { ok: false, error: started.error, payload: { ...started } };
    }
    return { ok: true, payload: { ok: true, state: started.state, pipelineId } };
  });

  // pipeline.batchRun.startRemote
  registry.register("pipeline.batchRun.startRemote", async (params, ctx) => {
    const pipelineId = typeof params.pipelineId === "string" ? params.pipelineId : "";
    const runtime = ctx.app.getPipelineRuntime(pipelineId);
    if (!runtime) return { ok: false, error: "pipeline_not_found" };
    const remoteUrl = typeof params.url === "string" ? params.url : undefined;
    const batchSize = typeof params.batchSize === "number" ? params.batchSize
      : typeof params.size === "number" ? params.size
      : typeof params.chunkSize === "number" ? params.chunkSize : undefined;
    const startIndex = typeof params.startIndex === "number" ? params.startIndex : undefined;
    const startBatch = typeof params.startBatch === "number" ? params.startBatch : undefined;
    const started = await ctx.services.pipelineService.startRemoteBatchRun({ pipelineId, url: remoteUrl, batchSize, startIndex, startBatch });
    if (started.ok === false) {
      return { ok: false, error: started.error, payload: { ...started } };
    }
    return { ok: true, payload: { ok: true, state: started.state, remoteUrl: started.remoteUrl, totalFetched: started.totalFetched, pipelineId } };
  });

  // pipeline.batchRun.stop
  registry.register("pipeline.batchRun.stop", async (params, ctx) => {
    const pipelineId = typeof params.pipelineId === "string" ? params.pipelineId : "";
    const runtime = ctx.app.getPipelineRuntime(pipelineId);
    if (!runtime) return { ok: false, error: "pipeline_not_found" };
    const target = mergeIdentityTargets(
      readIdentityTargetFromBody(params as Record<string, unknown>),
      { runId: typeof params.runId === "string" ? params.runId : undefined, batchRunId: typeof params.batchRunId === "string" ? params.batchRunId : undefined },
    );
    const stopped = ctx.services.pipelineService.stopPipeline(pipelineId, target);
    if (stopped.ok === false) {
      return { ok: false, error: stopped.error, payload: { ...stopped } };
    }
    return { ok: true, payload: stopped };
  });
};
