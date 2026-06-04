import type { Tool } from '../../types'

export const artifactTools: Tool[] = [
  {
    name: 'artifact_list',
    description: 'List artifacts produced by a pipeline run. Artifacts are structured outputs from each node.',
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
    async execute() {
      return { output: 'No artifacts found.', isError: false }
    },
  },
  {
    name: 'artifact_get',
    description: 'Read the content of a specific artifact by its ID.',
    parameters: {
      type: 'object',
      properties: {
        artifactId: { type: 'string', description: 'The artifact ID' },
      },
      required: ['artifactId'],
    },
    annotations: { readOnly: true, destructive: false, requiresConfirmation: false, idempotent: true },
    permission: 'auto',
    async execute(args) {
      const { artifactId } = args as { artifactId: string }
      return { output: `Artifact "${artifactId}" not found.`, isError: true }
    },
  },
]
