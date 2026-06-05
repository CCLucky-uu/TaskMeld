import type { Tool } from '../../types'

const MOCK_PIPELINES = [
  { id: 'pipe-001', name: 'Daily Data Report', description: 'Fetch data and generate report daily at midnight', status: 'idle', nodeCount: 3 },
  { id: 'pipe-002', name: 'Code Review Pipeline', description: 'Automated code review and quality checks', status: 'running', nodeCount: 4 },
]

export const pipelineTools: Tool[] = [
  {
    name: 'pipeline_list',
    description: 'List all pipelines with their basic info (id, name, description, status). Use this to see what pipelines exist before creating or modifying one.',
    parameters: { type: 'object', properties: {}, required: [] },
    annotations: { readOnly: true, destructive: false, requiresConfirmation: false, idempotent: true },
    permission: 'auto',
    async execute() {
      return { output: JSON.stringify(MOCK_PIPELINES, null, 2), isError: false }
    },
  },
  {
    name: 'pipeline_get',
    description: 'Get detailed information about a specific pipeline including its nodes and edges. Use the pipeline ID from pipeline.list.',
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
      const { pipelineId } = args as { pipelineId: string }
      const pipeline = MOCK_PIPELINES.find(p => p.id === pipelineId)
      if (!pipeline) return { output: `Pipeline "${pipelineId}" not found.`, isError: true }
      return {
        output: JSON.stringify({
          ...pipeline,
          nodes: [
            { id: 'node-1', name: 'Data Fetch', description: 'Fetch raw data from API' },
            { id: 'node-2', name: 'Data Cleaning', description: 'Deduplicate and format' },
            { id: 'node-3', name: 'Report Generation', description: 'Aggregate and output report' },
          ],
          edges: [
            { from: 'node-1', to: 'node-2' },
            { from: 'node-2', to: 'node-3' },
          ],
        }, null, 2),
        isError: false,
      }
    },
  },
  {
    name: 'pipeline_create',
    description: 'Create a new pipeline. Provide a name and optional description. Returns the created pipeline with its assigned ID.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Pipeline name' },
        description: { type: 'string', description: 'What this pipeline does' },
      },
      required: ['name'],
    },
    annotations: { readOnly: false, destructive: false, requiresConfirmation: true, idempotent: false },
    permission: 'confirm',
    async execute(args) {
      const { name, description } = args as { name: string; description?: string }
      const id = `pipe-${Date.now().toString(36)}`
      return {
        output: JSON.stringify({ id, name, description: description ?? '', status: 'idle', nodeCount: 0, message: 'Pipeline created successfully.' }, null, 2),
        isError: false,
      }
    },
  },
  {
    name: 'pipeline_update',
    description: 'Update an existing pipeline definition (name, description, nodes, edges).',
    parameters: {
      type: 'object',
      properties: {
        pipelineId: { type: 'string', description: 'The pipeline ID to update' },
        name: { type: 'string', description: 'New name' },
        description: { type: 'string', description: 'New description' },
      },
      required: ['pipelineId'],
    },
    annotations: { readOnly: false, destructive: false, requiresConfirmation: true, idempotent: false },
    permission: 'confirm',
    async execute(args) {
      const { pipelineId } = args as { pipelineId: string }
      return { output: `Pipeline "${pipelineId}" updated successfully.`, isError: false }
    },
  },
  {
    name: 'pipeline_delete',
    description: 'Delete a pipeline permanently. This is a destructive operation.',
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
      const { pipelineId } = args as { pipelineId: string }
      return { output: `Pipeline "${pipelineId}" deleted.`, isError: false }
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
      const { pipelineId } = args as { pipelineId: string }
      return { output: `Pipeline "${pipelineId}" started. Run ID: run-${Date.now().toString(36)}`, isError: false }
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
      const { pipelineId } = args as { pipelineId: string }
      return { output: `Pipeline "${pipelineId}" stopped.`, isError: false }
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
      const { pipelineId } = args as { pipelineId: string }
      const pipeline = MOCK_PIPELINES.find(p => p.id === pipelineId)
      if (!pipeline) return { output: `Pipeline "${pipelineId}" not found.`, isError: true }
      return { output: JSON.stringify({ id: pipeline.id, name: pipeline.name, status: pipeline.status, lastRun: null }, null, 2), isError: false }
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
      const { pipelineId } = args as { pipelineId: string }
      return {
        output: JSON.stringify({
          pipelineId,
          diagnosis: 'No failed runs found. Pipeline is currently idle.',
          failures: [],
        }, null, 2),
        isError: false,
      }
    },
  },
]
