import type { WsMethodRegistry } from "./types";
import {
  normalizeWorkflowFallbacksWithStorage,
  readWorkflowDefinitionFromRawDetailed,
  saveWorkflowDefinitionWithStorage,
  validateWorkflowDefinition,
  workflowToTemplateNodes,
  type WorkflowPlugins,
  type WorkflowDefinitionRuntime,
} from "../../pipeline/template";
import { DEFAULT_REMOTE_BATCH_URL } from "../../app/pipeline-config";
import { asRecord, formatError } from "./utils";

export const registerPipelineWorkflowWsMethods = (registry: WsMethodRegistry): void => {
  // pipeline.plugins.get
  registry.register("pipeline.plugins.get", (params, ctx) => {
    const pipelineId = typeof params.pipelineId === "string" ? params.pipelineId : "";
    const runtime = ctx.app.getPipelineRuntime(pipelineId);
    if (!runtime) return { ok: false, error: "pipeline_not_found" };
    const workflow = runtime.workflow.getWorkflow();
    if (!workflow) return { ok: false, error: "workflow_api_not_enabled" };
    return { ok: true, payload: { ok: true, state: workflow.plugins, pipelineId } };
  });

  // pipeline.plugins.save
  registry.register("pipeline.plugins.save", async (params, ctx) => {
    const pipelineId = typeof params.pipelineId === "string" ? params.pipelineId : "";
    const runtime = ctx.app.getPipelineRuntime(pipelineId);
    const definition = ctx.app.getPipelineDefinition(pipelineId);
    if (!runtime || !definition) return { ok: false, error: "pipeline_not_found" };

    const currentWorkflow = runtime.workflow.getWorkflow();
    if (!currentWorkflow) return { ok: false, error: "workflow_api_not_enabled" };
    const currentPlugin = currentWorkflow.plugins;
    const remoteBatchBody = asRecord(params.remoteBatch) ?? params;
    const schedulerBody = asRecord(params.scheduler);

    const nextPlugin: WorkflowPlugins = {
      remoteBatch: {
        enabled: remoteBatchBody.enabled === true,
        url: typeof remoteBatchBody.url === "string" && remoteBatchBody.url.trim()
          ? remoteBatchBody.url.trim()
          : currentPlugin.remoteBatch.url || DEFAULT_REMOTE_BATCH_URL,
        startBatch: typeof remoteBatchBody.startBatch === "number" && Number.isFinite(remoteBatchBody.startBatch)
          ? Math.max(1, Math.trunc(remoteBatchBody.startBatch))
          : currentPlugin.remoteBatch.startBatch,
        batchSize: typeof remoteBatchBody.batchSize === "number" && Number.isFinite(remoteBatchBody.batchSize)
          ? Math.max(1, Math.trunc(remoteBatchBody.batchSize))
          : currentPlugin.remoteBatch.batchSize,
        sourceField: typeof remoteBatchBody.sourceField === "string" && remoteBatchBody.sourceField.trim()
          ? remoteBatchBody.sourceField.trim()
          : currentPlugin.remoteBatch.sourceField,
      },
      scheduler: {
        enabled: schedulerBody?.enabled === undefined ? currentPlugin.scheduler.enabled : schedulerBody.enabled === true,
      },
    };

    const nextWorkflow: WorkflowDefinitionRuntime = {
      ...currentWorkflow,
      plugins: { ...currentWorkflow.plugins, ...nextPlugin },
      scheduler: nextPlugin.scheduler.enabled
        ? currentWorkflow.scheduler
        : { ...currentWorkflow.scheduler, enabled: false },
    };

    if (!nextPlugin.remoteBatch.enabled && runtime.pipeline.getBatchRunState().status === "running") {
      runtime.pipeline.cancelBatchRun();
    }
    runtime.workflow.setWorkflow(nextWorkflow);
    saveWorkflowDefinitionWithStorage(nextWorkflow, { workflowFilePath: definition.workflowFilePath });
    return { ok: true, payload: { ok: true, state: nextPlugin, pipelineId } };
  });

  // pipeline.template
  registry.register("pipeline.template", (params, ctx) => {
    const pipelineId = typeof params.pipelineId === "string" ? params.pipelineId : "";
    const runtime = ctx.app.getPipelineRuntime(pipelineId);
    if (!runtime) return { ok: false, error: "pipeline_not_found" };
    const workflow = runtime.workflow.getWorkflow();
    if (!workflow) return { ok: false, error: "workflow_api_not_enabled" };
    return { ok: true, payload: { nodes: workflowToTemplateNodes(workflow) } };
  });

  // pipeline.workflow.get
  registry.register("pipeline.workflow.get", (params, ctx) => {
    const pipelineId = typeof params.pipelineId === "string" ? params.pipelineId : "";
    const runtime = ctx.app.getPipelineRuntime(pipelineId);
    if (!runtime) return { ok: false, error: "pipeline_not_found" };
    const workflow = runtime.workflow.getWorkflow();
    if (!workflow) return { ok: false, error: "workflow_api_not_enabled" };
    return { ok: true, payload: { workflow, pipelineId } };
  });

  // pipeline.workflow.save
  registry.register("pipeline.workflow.save", async (params, ctx) => {
    const pipelineId = typeof params.pipelineId === "string" ? params.pipelineId : "";
    const runtime = ctx.app.getPipelineRuntime(pipelineId);
    const definition = ctx.app.getPipelineDefinition(pipelineId);
    if (!runtime || !definition) return { ok: false, error: "pipeline_not_found" };

    const parseResult = readWorkflowDefinitionFromRawDetailed(params.workflow ?? params);
    if (!parseResult.ok) {
      return { ok: false, error: { error: parseResult.error, detail: parseResult.detail } };
    }
    const next = parseResult.workflow;
    let normalized: WorkflowDefinitionRuntime;
    try {
      normalized = normalizeWorkflowFallbacksWithStorage(next, { workflowFilePath: definition.workflowFilePath });
    } catch (error) {
      const err = error as Error & { detail?: string };
      return {
        ok: false,
        error: {
          error: err.message || "invalid_persisted_workflow_definition",
          detail: err.detail,
        },
      };
    }
    const validation = validateWorkflowDefinition(normalized);
    if (!validation.ok) {
      return { ok: false, error: { error: validation.error, detail: validation.detail } };
    }
    runtime.workflow.setWorkflow(normalized);
    try {
      saveWorkflowDefinitionWithStorage(normalized, { workflowFilePath: definition.workflowFilePath });
    } catch (error) {
      const err = error as Error & { detail?: string };
      return {
        ok: false,
        error: {
          error: err.message || "invalid_workflow_definition",
          detail: err.detail,
        },
      };
    }
    const run = runtime.runtime.seedRun(runtime.workflow.getTemplateNodes());
    runtime.runtime.setRun(run);
    runtime.runtime.pushTimeline(`[${pipelineId}] Workflow definition updated, node count: ${normalized.nodes.length}`);
    runtime.runtime.emitPipeline();
    return { ok: true, payload: { ok: true, workflow: normalized, run, pipelineId } };
  });
};
