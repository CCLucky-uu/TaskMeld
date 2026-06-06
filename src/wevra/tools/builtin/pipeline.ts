import type { Tool } from '../../types'
import type { PipelineService } from '../../../services/pipeline-service'
import type { PipelineRegistry } from '../../../app/pipeline-registry'

export function createPipelineTools(pipeline?: PipelineService, app?: PipelineRegistry | null): Tool[] {
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
