import type { Tool } from '../../types'
import type { PipelineService } from '../../../services/pipeline-service'
import type { PipelineRegistry } from '../../../app/pipeline-registry'
import type { PluginRegistry } from '../../../pipeline/plugins/registry'
import { saveWorkflowDefinitionWithStorage } from '../../../pipeline/template'

export function createPipelineTools(pipeline?: PipelineService, app?: PipelineRegistry | null, pluginRegistry?: PluginRegistry | null): Tool[] {
  return [
    {
      name: 'pipeline_list',
      description: 'List all pipelines with their basic info (id, name, description, status). Use this to see what pipelines exist before creating or modifying one.',
      parameters: { type: 'object', properties: {}, required: [] },
      annotations: { readOnly: true, destructive: false, requiresConfirmation: false, idempotent: true },
      permission: 'auto',
      async execute() {
        if (!pipeline) return { output: 'Pipeline service not available.', isError: true }
        const list = pipeline.listPipelines()
        if (list.length === 0) return { output: 'No pipelines found.', isError: false }
        return {
          output: JSON.stringify(list.map(p => ({ id: p.id, title: p.title })), null, 2),
          isError: false,
        }
      },
    },
    {
      name: 'pipeline_get',
      description: 'Get detailed information about a specific pipeline including its nodes and edges. Use the pipeline ID from pipeline_list.',
      parameters: {
        type: 'object',
        properties: {
          pipelineId: { type: 'string', description: 'The pipeline ID' },
        },
        required: ['pipelineId'],
      },
      annotations: { readOnly: true, destructive: false, requiresConfirmation: false, idempotent: true },
      permission: 'auto',
      async execute(args) {
        if (!pipeline) return { output: 'Pipeline service not available.', isError: true }
        const { pipelineId } = args as { pipelineId: string }
        const detail = pipeline.getPipeline(pipelineId)
        if (!detail) return { output: `Pipeline "${pipelineId}" not found.`, isError: true }

        const run = detail.run
        const workflow = detail.workflow
        const nodes = workflow?.nodes ?? []
        const edges = workflow?.edges ?? []

        return {
          output: JSON.stringify({
            id: detail.pipelineId,
            title: detail.title,
            runStatus: run?.status ?? 'unknown',
            scheduler: detail.scheduler,
            nodes: nodes.map((n: any) => ({
              id: n.id,
              title: n.title ?? n.name ?? n.id,
              type: n.type ?? n.executor ?? 'unknown',
              description: n.instruction ?? n.description ?? '',
            })),
            edges: edges.map((e: any) => ({
              from: e.source ?? e.from,
              to: e.target ?? e.to,
            })),
          }, null, 2),
          isError: false,
        }
      },
    },
    {
      name: 'pipeline_create',
      description: 'Create a new pipeline. Provide an ID and optional title. The ID must be alphanumeric with hyphens/underscores.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Pipeline ID (alphanumeric, hyphens, underscores)' },
          title: { type: 'string', description: 'Pipeline title (optional, defaults to ID)' },
        },
        required: ['id'],
      },
      annotations: { readOnly: false, destructive: false, requiresConfirmation: true, idempotent: false },
      permission: 'confirm',
      async execute(args) {
        if (!app) return { output: 'Pipeline registry not available.', isError: true }
        const { id, title } = args as { id: string; title?: string }
        try {
          const def = await app.createPipeline({ id, title })
          return { output: JSON.stringify({ id: def.id, title: def.title, message: 'Pipeline created successfully.' }, null, 2), isError: false }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          return { output: `Failed to create pipeline: ${msg}`, isError: true }
        }
      },
    },
    {
      name: 'pipeline_update',
      description: 'Rename an existing pipeline.',
      parameters: {
        type: 'object',
        properties: {
          pipelineId: { type: 'string', description: 'The pipeline ID to rename' },
          title: { type: 'string', description: 'New title' },
        },
        required: ['pipelineId', 'title'],
      },
      annotations: { readOnly: false, destructive: false, requiresConfirmation: true, idempotent: false },
      permission: 'confirm',
      async execute(args) {
        if (!app) return { output: 'Pipeline registry not available.', isError: true }
        const { pipelineId, title } = args as { pipelineId: string; title: string }
        try {
          app.renamePipeline(pipelineId, title)
          return { output: `Pipeline "${pipelineId}" renamed to "${title}".`, isError: false }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          return { output: `Failed to rename pipeline: ${msg}`, isError: true }
        }
      },
    },
    {
      name: 'pipeline_delete',
      description: 'Delete a pipeline permanently. Cannot delete the last remaining pipeline or a running pipeline.',
      parameters: {
        type: 'object',
        properties: {
          pipelineId: { type: 'string', description: 'The pipeline ID to delete' },
        },
        required: ['pipelineId'],
      },
      annotations: { readOnly: false, destructive: true, requiresConfirmation: true, idempotent: false },
      permission: 'confirm',
      async execute(args) {
        if (!app) return { output: 'Pipeline registry not available.', isError: true }
        const { pipelineId } = args as { pipelineId: string }
        try {
          app.deletePipeline(pipelineId)
          return { output: `Pipeline "${pipelineId}" deleted.`, isError: false }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          return { output: `Failed to delete pipeline: ${msg}`, isError: true }
        }
      },
    },
    {
      name: 'pipeline_status',
      description: 'Check the current run status of a pipeline (idle, running, completed, failed).',
      parameters: {
        type: 'object',
        properties: {
          pipelineId: { type: 'string', description: 'The pipeline ID' },
        },
        required: ['pipelineId'],
      },
      annotations: { readOnly: true, destructive: false, requiresConfirmation: false, idempotent: true },
      permission: 'auto',
      async execute(args) {
        if (!pipeline) return { output: 'Pipeline service not available.', isError: true }
        const { pipelineId } = args as { pipelineId: string }
        const result = pipeline.getPipelineExecutionStatus(pipelineId)
        if (!result.ok) return { output: `Pipeline "${pipelineId}" not found.`, isError: true }
        return { output: JSON.stringify(result, null, 2), isError: false }
      },
    },
    {
      name: 'pipeline_diagnose',
      description: 'Analyze why a pipeline run failed. Examines run logs, error messages, and artifacts to identify the root cause.',
      parameters: {
        type: 'object',
        properties: {
          pipelineId: { type: 'string', description: 'The pipeline ID' },
          runId: { type: 'string', description: 'Optional specific run ID' },
        },
        required: ['pipelineId'],
      },
      annotations: { readOnly: true, destructive: false, requiresConfirmation: false, idempotent: true },
      permission: 'auto',
      async execute(args) {
        if (!pipeline) return { output: 'Pipeline service not available.', isError: true }
        const { pipelineId } = args as { pipelineId: string }
        const detail = pipeline.getPipeline(pipelineId)
        if (!detail) return { output: `Pipeline "${pipelineId}" not found.`, isError: true }

        const run = detail.run
        const nodes = run?.nodes ?? []
        const failedNodes = nodes.filter((n: any) => n.status === 'failed')
        const stoppedNodes = nodes.filter((n: any) => n.status === 'stopped')

        if (failedNodes.length === 0 && stoppedNodes.length === 0) {
          return {
            output: JSON.stringify({
              pipelineId,
              diagnosis: `Pipeline is "${run?.status ?? 'unknown'}". No failed or stopped nodes found.`,
              runStatus: run?.status,
            }, null, 2),
            isError: false,
          }
        }

        const issues = [...failedNodes, ...stoppedNodes].map((n: any) => ({
          nodeId: n.id,
          title: n.title,
          status: n.status,
          lastError: n.lastError ?? null,
          attempt: n.attempt,
          rejectCount: n.rejectCount,
          startedAt: n.startedAt,
          finishedAt: n.finishedAt,
        }))

        return {
          output: JSON.stringify({
            pipelineId,
            runStatus: run?.status,
            runId: run?.id,
            failedNodes: issues.length,
            issues,
          }, null, 2),
          isError: false,
        }
      },
    },
    {
      name: 'pipeline_run',
      description: 'Start running a pipeline. The pipeline must have at least one node.',
      parameters: {
        type: 'object',
        properties: {
          pipelineId: { type: 'string', description: 'The pipeline ID to run' },
        },
        required: ['pipelineId'],
      },
      annotations: { readOnly: false, destructive: false, requiresConfirmation: true, idempotent: false },
      permission: 'confirm',
      async execute(args) {
        if (!pipeline) return { output: 'Pipeline service not available.', isError: true }
        const { pipelineId } = args as { pipelineId: string }
        try {
          const result = await pipeline.runPipeline(pipelineId)
          return { output: JSON.stringify(result, null, 2), isError: false }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          return { output: `Failed to run pipeline: ${msg}`, isError: true }
        }
      },
    },
    {
      name: 'pipeline_stop',
      description: 'Stop a running pipeline.',
      parameters: {
        type: 'object',
        properties: {
          pipelineId: { type: 'string', description: 'The pipeline ID to stop' },
        },
        required: ['pipelineId'],
      },
      annotations: { readOnly: false, destructive: false, requiresConfirmation: true, idempotent: false },
      permission: 'confirm',
      async execute(args) {
        if (!pipeline) return { output: 'Pipeline service not available.', isError: true }
        const { pipelineId } = args as { pipelineId: string }
        try {
          const result = pipeline.stopPipeline(pipelineId)
          return { output: JSON.stringify(result, null, 2), isError: false }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          return { output: `Failed to stop pipeline: ${msg}`, isError: true }
        }
      },
    },
  ]
}

export function createPipelinePluginTool(app?: PipelineRegistry | null, pluginRegistry?: PluginRegistry | null): Tool[] {
  return [
    {
      name: 'pipeline_plugin',
      description: `Manage pipeline plugins (remote-batch, scheduler, etc.).

Actions:
- list: List all plugins for a pipeline with their status and config
- get: Get a specific plugin's current config
- enable: Enable a plugin
- disable: Disable a plugin
- config: Update plugin config (shallow merge with existing)

Available plugins and their config:
- remote-batch (dataSource): url (string), batchSize (number, default 5), startBatch (number, default 1), sourceField (string, default "list30")
- scheduler (scheduler): no extra config, just enable/disable`,
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['list', 'get', 'enable', 'disable', 'config'], description: 'The action to perform' },
          pipelineId: { type: 'string', description: 'The pipeline ID' },
          pluginId: { type: 'string', description: 'The plugin ID (e.g. "remote-batch", "scheduler"). Required for get/enable/disable/config.' },
          config: { type: 'object', description: 'Plugin config to merge. Only for config action.' },
        },
        required: ['action', 'pipelineId'],
      },
      annotations: { readOnly: false, destructive: false, requiresConfirmation: true, idempotent: false },
      permission: 'confirm',
      async execute(args) {
        if (!app) return { output: 'Pipeline registry not available.', isError: true }
        const { action, pipelineId, pluginId, config } = args as {
          action: string; pipelineId: string; pluginId?: string; config?: Record<string, unknown>
        }

        const runtime = app.getPipelineRuntime(pipelineId)
        if (!runtime) return { output: `Pipeline "${pipelineId}" not found.`, isError: true }
        const definition = app.getPipelineDefinition(pipelineId)
        if (!definition) return { output: `Pipeline "${pipelineId}" definition not found.`, isError: true }

        const workflow = runtime.workflow.getWorkflow()
        if (!workflow) return { output: 'Workflow not available.', isError: true }

        const plugins = Array.isArray(workflow.plugins) ? workflow.plugins : []

        switch (action) {
          case 'list': {
            const allRegistered = pluginRegistry?.list() ?? []
            const list = allRegistered.map(meta => {
              const inst = plugins.find(p => p.pluginId === meta.id)
              return {
                pluginId: meta.id,
                name: meta.name,
                type: meta.type,
                enabled: inst?.enabled ?? false,
                configured: !!inst,
                config: inst?.config ?? {},
              }
            })
            // Also show any workflow plugins not in registry (custom/unknown)
            for (const inst of plugins) {
              if (!allRegistered.some(r => r.id === inst.pluginId)) {
                list.push({
                  pluginId: inst.pluginId,
                  name: inst.pluginId,
                  type: 'unknown' as any,
                  enabled: inst.enabled,
                  configured: true,
                  config: inst.config,
                })
              }
            }
            if (list.length === 0) return { output: 'No plugins available.', isError: false }
            return { output: JSON.stringify(list, null, 2), isError: false }
          }

          case 'get': {
            if (!pluginId) return { output: 'pluginId is required for get action.', isError: true }
            const inst = plugins.find(p => p.pluginId === pluginId)
            if (!inst) return { output: `Plugin "${pluginId}" not found in pipeline "${pipelineId}".`, isError: true }
            const meta = pluginRegistry?.get(pluginId)
            return {
              output: JSON.stringify({
                pluginId: inst.pluginId,
                name: meta?.name ?? inst.pluginId,
                type: meta?.type ?? 'unknown',
                enabled: inst.enabled,
                config: inst.config,
              }, null, 2),
              isError: false,
            }
          }

          case 'enable': {
            if (!pluginId) return { output: 'pluginId is required for enable action.', isError: true }
            const idx = plugins.findIndex(p => p.pluginId === pluginId)
            let nextPlugins
            if (idx < 0) {
              // Plugin doesn't exist yet — create it with default config
              const meta = pluginRegistry?.get(pluginId)
              const defaultConfig = meta?.defaultConfig ?? {}
              nextPlugins = [...plugins, { pluginId, enabled: true, config: { ...defaultConfig } }]
            } else {
              nextPlugins = [...plugins]
              nextPlugins[idx] = { ...nextPlugins[idx], enabled: true }
            }
            runtime.workflow.setWorkflow({ ...workflow, plugins: nextPlugins })
            saveWorkflowDefinitionWithStorage({ ...workflow, plugins: nextPlugins }, { workflowFilePath: definition.workflowFilePath })
            return { output: `Plugin "${pluginId}" enabled on pipeline "${pipelineId}".`, isError: false }
          }

          case 'disable': {
            if (!pluginId) return { output: 'pluginId is required for disable action.', isError: true }
            const idx = plugins.findIndex(p => p.pluginId === pluginId)
            if (idx < 0) return { output: `Plugin "${pluginId}" not found.`, isError: true }
            const nextPlugins = [...plugins]
            nextPlugins[idx] = { ...nextPlugins[idx], enabled: false }

            // Side effect: if disabling remote-batch, cancel active batch run
            if (pluginId === 'remote-batch' && runtime.pipeline.getBatchRunState().status === 'running') {
              runtime.pipeline.cancelBatchRun()
            }
            // Side effect: if disabling scheduler, also disable scheduler in workflow
            const nextScheduler = pluginId === 'scheduler'
              ? { ...workflow.scheduler, enabled: false }
              : workflow.scheduler

            runtime.workflow.setWorkflow({ ...workflow, plugins: nextPlugins, scheduler: nextScheduler })
            saveWorkflowDefinitionWithStorage({ ...workflow, plugins: nextPlugins, scheduler: nextScheduler }, { workflowFilePath: definition.workflowFilePath })
            return { output: `Plugin "${pluginId}" disabled on pipeline "${pipelineId}".`, isError: false }
          }

          case 'config': {
            if (!pluginId) return { output: 'pluginId is required for config action.', isError: true }
            if (!config || typeof config !== 'object') return { output: 'config object is required for config action.', isError: true }
            const idx = plugins.findIndex(p => p.pluginId === pluginId)
            let nextPlugins
            if (idx < 0) {
              // Plugin doesn't exist yet — create it with provided config merged with defaults
              const meta = pluginRegistry?.get(pluginId)
              const defaultConfig = meta?.defaultConfig ?? {}
              nextPlugins = [...plugins, { pluginId, enabled: true, config: { ...defaultConfig, ...config } }]
            } else {
              const existing = plugins[idx]
              nextPlugins = [...plugins]
              nextPlugins[idx] = { ...existing, config: { ...existing.config, ...config } }
            }
            runtime.workflow.setWorkflow({ ...workflow, plugins: nextPlugins })
            saveWorkflowDefinitionWithStorage({ ...workflow, plugins: nextPlugins }, { workflowFilePath: definition.workflowFilePath })
            const saved = nextPlugins.find(p => p.pluginId === pluginId)
            return { output: `Plugin "${pluginId}" config updated on pipeline "${pipelineId}". Config: ${JSON.stringify(saved?.config)}`, isError: false }
          }

          default:
            return { output: `Unknown action "${action}". Valid actions: list, get, enable, disable, config.`, isError: true }
        }
      },
    },
  ]
}
