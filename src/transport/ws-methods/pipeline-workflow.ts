import type { WsMethodRegistry } from "./types";
import {
  normalizeWorkflowFallbacksWithStorage,
  readWorkflowDefinitionFromRawDetailed,
  saveWorkflowDefinitionWithStorage,
  validateWorkflowDefinition,
  workflowToTemplateNodes,
  type WorkflowDefinitionRuntime,
} from "../../pipeline/template";
import type { PluginInstance } from "../../pipeline/plugins/types";
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

  // pipeline.plugins.save — accepts { plugins: PluginInstance[] } or { pluginId, enabled, config } for single plugin update
  registry.register("pipeline.plugins.save", async (params, ctx) => {
    const pipelineId = typeof params.pipelineId === "string" ? params.pipelineId : "";
    const runtime = ctx.app.getPipelineRuntime(pipelineId);
    const definition = ctx.app.getPipelineDefinition(pipelineId);
    if (!runtime || !definition) return { ok: false, error: "pipeline_not_found" };

    const currentWorkflow = runtime.workflow.getWorkflow();
    if (!currentWorkflow) return { ok: false, error: "workflow_api_not_enabled" };

    let nextPlugins: PluginInstance[];

    if (Array.isArray(params.plugins)) {
      // Full replace: { plugins: [...] }
      nextPlugins = (params.plugins as unknown[]).map((item: unknown) => {
        const r = asRecord(item);
        if (!r || typeof r.pluginId !== "string") return null;
        return {
          pluginId: r.pluginId.trim(),
          enabled: r.enabled !== false,
          config: asRecord(r.config) ?? {},
        };
      }).filter((x): x is PluginInstance => x !== null);
    } else if (typeof params.pluginId === "string" && params.pluginId.trim()) {
      // Single plugin update: { pluginId, enabled?, config? }
      const pluginId = params.pluginId.trim();
      const existing = [...currentWorkflow.plugins];
      const idx = existing.findIndex(p => p.pluginId === pluginId);
      const updated: PluginInstance = {
        pluginId,
        enabled: params.enabled !== false,
        config: asRecord(params.config) ?? (idx >= 0 ? existing[idx].config : {}),
      };
      if (idx >= 0) {
        existing[idx] = updated;
      } else {
        existing.push(updated);
      }
      nextPlugins = existing;
    } else {
      return { ok: false, error: "invalid_params" };
    }

    // If remote-batch is being disabled, cancel any active batch run
    const remoteBatchInst = nextPlugins.find(p => p.pluginId === 'remote-batch');
    if (remoteBatchInst && !remoteBatchInst.enabled && runtime.pipeline.getBatchRunState().status === "running") {
      runtime.pipeline.cancelBatchRun();
    }

    // If scheduler is being disabled, also disable scheduler in workflow config
    const schedulerInst = nextPlugins.find(p => p.pluginId === 'scheduler');
    const nextScheduler = schedulerInst && !schedulerInst.enabled
      ? { ...currentWorkflow.scheduler, enabled: false }
      : currentWorkflow.scheduler;

    const nextWorkflow: WorkflowDefinitionRuntime = {
      ...currentWorkflow,
      plugins: nextPlugins,
      scheduler: nextScheduler,
    };

    runtime.workflow.setWorkflow(nextWorkflow);
    saveWorkflowDefinitionWithStorage(nextWorkflow, { workflowFilePath: definition.workflowFilePath });
    return { ok: true, payload: { ok: true, state: nextPlugins, pipelineId } };
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
