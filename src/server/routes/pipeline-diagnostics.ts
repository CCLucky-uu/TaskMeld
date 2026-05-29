import type { Router } from "../types.js";
import { diagnoseNodeDependency } from "../../pipeline/diagnostics/index.js";

/**
 * 注册 Pipeline 节点诊断路由：
 *   GET /api/pipelines/:pipelineId/nodes/:nodeId/diagnostics?itemKey=xxx
 */
export const registerPipelineDiagnosticsRoutes = (router: Router): void => {
  router.register("GET", "/api/pipelines/:pipelineId/nodes/:nodeId/diagnostics", (ctx) => {
    const scope = ctx.getPipelineScope();
    if (!scope) {
      ctx.sendJson(404, { error: "pipeline_not_found", pipelineId: ctx.params.pipelineId });
      return;
    }

    const nodeId = ctx.params.nodeId;
    const itemKey = ctx.url.searchParams.get("itemKey") ?? undefined;

    const runtime = ctx.options.app.getPipelineRuntime(scope.pipelineId);
    if (!runtime) {
      ctx.sendJson(404, { error: "pipeline_not_found", pipelineId: scope.pipelineId });
      return;
    }

    const run = scope.getRun();
    const workflowNode = runtime.workflow.getWorkflowNodeById(nodeId);
    if (!workflowNode) {
      ctx.sendJson(404, { error: "node_not_found", pipelineId: scope.pipelineId, nodeId });
      return;
    }

    const diagnostics = diagnoseNodeDependency(run, runtime.workflow, nodeId, itemKey);
    ctx.sendJson(200, { nodeId, itemKey: itemKey ?? null, diagnostics });
  });
};
