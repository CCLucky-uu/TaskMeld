import type { Tool } from '../../types'
import type { PipelineService } from '../../../services/pipeline-service'

export function createPipelineTools(pipeline?: PipelineService): Tool[] {
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
  ]
}
