import { URL } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readJsonBody, sendJson as writeJson } from "./http-utils";
import { serveStatic } from "./serve-static";
import type { ApiHandlerContext, RequestContext } from "./types.js";
import type { PipelineScopedContext as ApiPipelineScopedContext } from "./types.js";
import { createRouter } from "./router.js";
import { composeMiddleware, errorMiddleware, corsMiddleware } from "./middleware.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerGatewayRoutes } from "./routes/gateway.js";
import { registerTimelineRoutes } from "./routes/timeline.js";
import { registerLogRoutes } from "./routes/logs.js";
import { registerArtifactsRoutes } from "./routes/artifacts.js";
import { registerAgentsRoutes } from "./routes/agents.js";
import { registerSessionsRoutes } from "./routes/sessions.js";
import { registerPipelinesRoutes } from "./routes/pipelines.js";
import { registerPipelineWorkflowRoutes } from "./routes/pipeline-workflow.js";
import { registerPipelineRuntimeRoutes } from "./routes/pipeline-runtime.js";
import { registerPipelineBatchRoutes } from "./routes/pipeline-batch.js";
import { registerPipelineSchedulerRoutes } from "./routes/pipeline-scheduler.js";
import { registerPipelineDiagnosticsRoutes } from "./routes/pipeline-diagnostics.js";
import { registerPipelineOutputsRoutes } from "./routes/pipeline-outputs.js";
import { registerPipelineLinksRoutes } from "./routes/pipeline-links.js";
import { registerPipelineQueueRoutes } from "./routes/pipeline-queue.js";
import type { PipelineRegistry } from "../app/pipeline-registry";
import { createRunLogService } from "../logs/run-log-service";
import { createPipelineService } from "../services/pipeline-service.js";
import { createSchedulerService } from "../services/scheduler-service.js";
import { resolveTaskMeldDataPath } from "../app/data-dir";

export const createApiHandler = (options: ApiHandlerContext) => {
  const runLogService = createRunLogService({
    rootDir: resolveTaskMeldDataPath("logs", "runs"),
  });

  // Phase 1-5: 基于 Router 的路由迁移（全部路由模块）
  const router = createRouter();
  registerHealthRoutes(router);
  registerGatewayRoutes(router);
  registerTimelineRoutes(router);
  registerLogRoutes(router);
  registerArtifactsRoutes(router);
  registerAgentsRoutes(router);
  registerSessionsRoutes(router);
  registerPipelinesRoutes(router);
  registerPipelineWorkflowRoutes(router);
  registerPipelineRuntimeRoutes(router);
  registerPipelineBatchRoutes(router);
  registerPipelineSchedulerRoutes(router);
  registerPipelineDiagnosticsRoutes(router);
  registerPipelineOutputsRoutes(router);
  registerPipelineLinksRoutes(router);
  registerPipelineQueueRoutes(router);

  const pipeline = composeMiddleware(
    errorMiddleware,
    corsMiddleware(options.webOrigin),
  );

  // 已迁移路由共享的 services
  const pipelineService = createPipelineService(options.app);
  const schedulerService = createSchedulerService(options.app);

  const migratedServices = {
    client: options.app.gateway.client,
    getLatestStatus: options.app.gateway.getLatestStatus,
    getLatestHello: options.app.gateway.getLatestHello,
    getLastFrame: options.app.gateway.getLastFrame,
    getTimeline: options.app.runtime.getCombinedTimeline,
    runLogService,
    pickArray: options.app.gateway.pickArray,
    refreshSessionsFromGateway: options.app.gateway.refreshSessionsFromGateway,
    getSessionCache: options.app.gateway.getSessionCache,
    pushTimeline: (
      ...args: Parameters<
        ReturnType<PipelineRegistry["getPrimaryRuntime"]>["runtime"]["pushTimeline"]
      >
    ) => {
      const primary = options.app.getPrimaryRuntime();
      primary?.runtime.pushTimeline(...args);
    },
    listPipelines: options.app.listPipelines.bind(options.app),
    getPipelineDefinition: options.app.getPipelineDefinition.bind(options.app),
    pipelineService,
    schedulerService,
  };

  return async (req: IncomingMessage, res: ServerResponse) => {
    const method = req.method ?? "GET";
    const reqUrl = req.url ?? "/";
    const url = new URL(reqUrl, `http://127.0.0.1:${options.apiPort}`);

    // 全局 OPTIONS 处理：所有非 router 匹配的 OPTIONS 请求统一在此返回 204
    // （router 匹配的 OPTIONS 由 corsMiddleware 在 pipeline 内处理）
    if (method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": options.webOrigin,
        "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      });
      res.end();
      return;
    }

    const match = router.match(method, url.pathname);
    if (match) {
      let _bodyPromise: Promise<Record<string, unknown>> | null = null;

      const migratedCtx: RequestContext = {
        req,
        res,
        method,
        url,
        params: match.params,
        options,
        services: migratedServices,
        sendJson: (code: number, data: unknown) => writeJson(res, code, data, options.webOrigin),
        sendRaw: (code: number, headers: Record<string, string>, body: NodeJS.ReadableStream) => {
          res.writeHead(code, {
            ...headers,
            "Access-Control-Allow-Origin": options.webOrigin,
            "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          });
          body.pipe(res);
        },
        readBody: () => {
          if (!_bodyPromise) _bodyPromise = readJsonBody(req);
          return _bodyPromise;
        },
        getPipelineScope: (): ApiPipelineScopedContext | null => {
          const pipelineId = match.params.pipelineId;
          if (!pipelineId) return null;
          const runtime = options.app.getPipelineRuntime(pipelineId);
          const definition = options.app.getPipelineDefinition(pipelineId);
          if (!runtime || !definition) return null;
          return {
            pipelineId: definition.id,
            workflowFilePath: definition.workflowFilePath,
            pushTimeline: runtime.runtime.pushTimeline,
            touchRun: runtime.runtime.touchRun,
            seedRun: runtime.runtime.seedRun,
            emitPipeline: runtime.runtime.emitPipeline,
            getRun: runtime.runtime.getRun,
            setRun: runtime.runtime.setRun,
            getTemplateNodes: runtime.workflow.getTemplateNodes,
            setTemplateNodes: runtime.workflow.setTemplateNodes,
            getWorkflow: runtime.workflow.getWorkflow,
            setWorkflow: runtime.workflow.setWorkflow,
            getItemRuns: runtime.pipeline.getItemRuns,
            drainPipeline: runtime.pipeline.drainPipeline,
            setSchedulerEnabled: runtime.pipeline.setSchedulerEnabled,
            setSchedulerMode: runtime.pipeline.setSchedulerMode,
            getSchedulerState: runtime.pipeline.getSchedulerState,
            getBatchRunState: runtime.pipeline.getBatchRunState,
            cancelBatchRun: runtime.pipeline.cancelBatchRun,
            executorSessionByAgentId: runtime.gateway.getExecutorSessionByAgentId(),
            getSessionCache: runtime.gateway.getSessionCache,
          } as ApiPipelineScopedContext;
        },
      };

      await pipeline(migratedCtx, async () => {
        await match.handler(migratedCtx);
      });
      return;
    }

    if (url.pathname.startsWith("/api/") || url.pathname === "/api") {
      writeJson(res, 404, { error: "not_found" }, options.webOrigin);
      return;
    }

    // SPA static file serving — falls back to index.html for client-side routing
    if (serveStatic(req, res)) return;

    writeJson(res, 404, { error: "not_found" }, options.webOrigin);
  };
};
