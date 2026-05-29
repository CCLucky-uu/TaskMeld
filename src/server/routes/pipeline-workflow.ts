import type { Router } from "../types.js";
import {
  normalizeWorkflowFallbacksWithStorage,
  readWorkflowDefinitionFromRawDetailed,
  saveWorkflowDefinitionWithStorage,
  validateWorkflowDefinition,
  workflowToTemplateNodes,
  type PipelineTemplateNode,
  type WorkflowDefinitionRuntime,
  type WorkflowPlugins,
} from "../../pipeline/template.js";
import { DEFAULT_REMOTE_BATCH_URL } from "../../app/pipeline-config.js";

// 将未知值安全转换为 Record<string, unknown>，非对象返回 null
const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : null;

/**
 * 注册 Pipeline Workflow / Template / Plugins 路由：
 *   GET    /api/pipelines/:pipelineId/template             — 读取模板节点
 *   GET    /api/pipelines/:pipelineId/workflow             — 读取工作流定义
 *   POST   /api/pipelines/:pipelineId/workflow             — 保存工作流定义
 *   GET    /api/pipelines/:pipelineId/plugins              — 读取插件配置
 *   POST   /api/pipelines/:pipelineId/plugins              — 写入插件配置
 */
export const registerPipelineWorkflowRoutes = (router: Router): void => {
  // GET /api/pipelines/:pipelineId/plugins
  router.register("GET", "/api/pipelines/:pipelineId/plugins", (ctx) => {
    const scope = ctx.getPipelineScope();
    if (!scope) {
      ctx.sendJson(404, { error: "pipeline_not_found", pipelineId: ctx.params.pipelineId });
      return;
    }
    const workflow = scope.getWorkflow();
    if (!workflow) {
      ctx.sendJson(501, { error: "workflow_api_not_enabled" });
      return;
    }
    ctx.sendJson(200, { ok: true, state: workflow.plugins, pipelineId: scope.pipelineId });
  });

  // POST /api/pipelines/:pipelineId/plugins
  router.register("POST", "/api/pipelines/:pipelineId/plugins", async (ctx) => {
    const scope = ctx.getPipelineScope();
    if (!scope) {
      ctx.sendJson(404, { error: "pipeline_not_found", pipelineId: ctx.params.pipelineId });
      return;
    }
    if (!scope.getWorkflow || !scope.setWorkflow) {
      ctx.sendJson(501, { error: "workflow_api_not_enabled" });
      return;
    }
    const body = await ctx.readBody();
    const currentWorkflow = scope.getWorkflow();
    const currentPlugin = currentWorkflow.plugins;
    const remoteBatchBody = asRecord(body.remoteBatch) ?? body;
    const schedulerBody = asRecord(body.scheduler);
    const nextPlugin: WorkflowPlugins = {
      remoteBatch: {
        enabled: remoteBatchBody.enabled === true,
        url:
          typeof remoteBatchBody.url === "string" && remoteBatchBody.url.trim()
            ? remoteBatchBody.url.trim()
            : currentPlugin.remoteBatch.url || DEFAULT_REMOTE_BATCH_URL,
        startBatch:
          typeof remoteBatchBody.startBatch === "number" && Number.isFinite(remoteBatchBody.startBatch)
            ? Math.max(1, Math.trunc(remoteBatchBody.startBatch))
            : currentPlugin.remoteBatch.startBatch,
        batchSize:
          typeof remoteBatchBody.batchSize === "number" && Number.isFinite(remoteBatchBody.batchSize)
            ? Math.max(1, Math.trunc(remoteBatchBody.batchSize))
            : currentPlugin.remoteBatch.batchSize,
        sourceField:
          typeof remoteBatchBody.sourceField === "string" && remoteBatchBody.sourceField.trim()
            ? remoteBatchBody.sourceField.trim()
            : currentPlugin.remoteBatch.sourceField,
      },
      scheduler: {
        enabled:
          schedulerBody?.enabled === undefined ? currentPlugin.scheduler.enabled : schedulerBody.enabled === true,
      },
    };
    const nextWorkflow: WorkflowDefinitionRuntime = {
      ...currentWorkflow,
      plugins: {
        ...currentWorkflow.plugins,
        ...nextPlugin,
      },
      // 调度器插件关闭时同步落盘为 disabled，避免刷新后后台仍按旧 scheduler.enabled 自动运行
      scheduler: nextPlugin.scheduler.enabled
        ? currentWorkflow.scheduler
        : {
            ...currentWorkflow.scheduler,
            enabled: false,
          },
    };
    if (!nextPlugin.remoteBatch.enabled && scope.cancelBatchRun && scope.getBatchRunState?.().status === "running") {
      scope.cancelBatchRun();
    }
    scope.setWorkflow(nextWorkflow);
    saveWorkflowDefinitionWithStorage(nextWorkflow, { workflowFilePath: scope.workflowFilePath });
    ctx.sendJson(200, { ok: true, state: nextPlugin, pipelineId: scope.pipelineId });
  });

  // GET /api/pipelines/:pipelineId/template
  router.register("GET", "/api/pipelines/:pipelineId/template", (ctx) => {
    const scope = ctx.getPipelineScope();
    if (!scope) {
      ctx.sendJson(404, { error: "pipeline_not_found", pipelineId: ctx.params.pipelineId });
      return;
    }
    const workflow = scope.getWorkflow();
    if (!workflow) {
      ctx.sendJson(501, { error: "workflow_api_not_enabled" });
      return;
    }
    ctx.sendJson(200, { nodes: workflowToTemplateNodes(workflow) });
  });

  // GET /api/pipelines/:pipelineId/workflow
  router.register("GET", "/api/pipelines/:pipelineId/workflow", (ctx) => {
    const scope = ctx.getPipelineScope();
    if (!scope) {
      ctx.sendJson(404, { error: "pipeline_not_found", pipelineId: ctx.params.pipelineId });
      return;
    }
    if (!scope.getWorkflow) {
      ctx.sendJson(501, { error: "workflow_api_not_enabled" });
      return;
    }
    ctx.sendJson(200, { workflow: scope.getWorkflow(), pipelineId: scope.pipelineId });
  });

  // POST /api/pipelines/:pipelineId/workflow
  router.register("POST", "/api/pipelines/:pipelineId/workflow", async (ctx) => {
    const scope = ctx.getPipelineScope();
    if (!scope) {
      ctx.sendJson(404, { error: "pipeline_not_found", pipelineId: ctx.params.pipelineId });
      return;
    }
    if (!scope.setWorkflow || !scope.getWorkflow) {
      ctx.sendJson(501, { error: "workflow_api_not_enabled" });
      return;
    }
    const body = await ctx.readBody();
    const parseResult = readWorkflowDefinitionFromRawDetailed(body.workflow ?? body);
    if (!parseResult.ok) {
      ctx.sendJson(400, {
        error: parseResult.error,
        detail: parseResult.detail,
        pipelineId: scope.pipelineId,
      });
      return;
    }
    const next = parseResult.workflow;
    let normalized: WorkflowDefinitionRuntime;
    try {
      normalized = normalizeWorkflowFallbacksWithStorage(next, { workflowFilePath: scope.workflowFilePath });
    } catch (error) {
      // 透传读盘异常，保证「坏盘后修复提交」场景能得到结构化错误响应
      const errorObj = error as Error & { detail?: string };
      ctx.sendJson(400, {
        error: errorObj.message || "invalid_persisted_workflow_definition",
        detail: errorObj.detail ?? errorObj.message,
        pipelineId: scope.pipelineId,
      });
      return;
    }
    const validation = validateWorkflowDefinition(normalized);
    if (!validation.ok) {
      ctx.sendJson(400, {
        error: validation.error,
        detail: validation.detail,
        pipelineId: scope.pipelineId,
      });
      return;
    }
    scope.setWorkflow(normalized);
    try {
      saveWorkflowDefinitionWithStorage(normalized, { workflowFilePath: scope.workflowFilePath });
    } catch (error) {
      const errorObj = error as Error & { detail?: string };
      ctx.sendJson(400, {
        error: errorObj.message || "invalid_workflow_definition",
        detail: errorObj.detail ?? errorObj.message,
        pipelineId: scope.pipelineId,
      });
      return;
    }
    const run = scope.seedRun(scope.getTemplateNodes());
    scope.setRun(run);
    scope.pushTimeline(`[${scope.pipelineId}] 工作流定义已更新，节点数: ${normalized.nodes.length}`);
    scope.emitPipeline();
    ctx.sendJson(200, { ok: true, workflow: normalized, run, pipelineId: scope.pipelineId });
  });
};
