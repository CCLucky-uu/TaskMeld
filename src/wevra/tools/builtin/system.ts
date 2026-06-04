import type { Tool } from '../../types'

export const systemTools: Tool[] = [
  {
    name: 'system_status',
    description: 'Get TaskMeld server status including uptime, version, and resource usage.',
    parameters: { type: 'object', properties: {}, required: [] },
    annotations: { readOnly: true, destructive: false, requiresConfirmation: false, idempotent: true },
    permission: 'auto',
    async execute() {
      return {
        output: JSON.stringify({
          status: 'running',
          version: '0.1.50',
          uptime: process.uptime(),
          memory: process.memoryUsage(),
        }, null, 2),
        isError: false,
      }
    },
  },
  {
    name: 'system_gateway',
    description: 'Get OpenClaw Gateway connection status.',
    parameters: { type: 'object', properties: {}, required: [] },
    annotations: { readOnly: true, destructive: false, requiresConfirmation: false, idempotent: true },
    permission: 'auto',
    async execute() {
      return {
        output: JSON.stringify({
          connected: false,
          message: 'Gateway status will be populated from real service data.',
        }, null, 2),
        isError: false,
      }
    },
  },
]
