import type { Tool } from '../../types'

export const sessionTools: Tool[] = [
  {
    name: 'session_list',
    description: 'List active agent sessions.',
    parameters: { type: 'object', properties: {}, required: [] },
    annotations: { readOnly: true, destructive: false, requiresConfirmation: false, idempotent: true },
    permission: 'auto',
    async execute() {
      return { output: 'No active sessions.', isError: false }
    },
  },
  {
    name: 'session_get',
    description: 'Get details of a specific session.',
    parameters: {
      type: 'object',
      properties: { sessionId: { type: 'string', description: 'The session ID' } },
      required: ['sessionId'],
    },
    annotations: { readOnly: true, destructive: false, requiresConfirmation: false, idempotent: true },
    permission: 'auto',
    async execute(args) {
      const { sessionId } = args as { sessionId: string }
      return { output: `Session "${sessionId}" not found.`, isError: true }
    },
  },
  {
    name: 'session_history',
    description: 'Get the conversation history of a session.',
    parameters: {
      type: 'object',
      properties: { sessionId: { type: 'string', description: 'The session ID' } },
      required: ['sessionId'],
    },
    annotations: { readOnly: true, destructive: false, requiresConfirmation: false, idempotent: true },
    permission: 'auto',
    async execute(args) {
      const { sessionId } = args as { sessionId: string }
      return { output: `No history found for session "${sessionId}".`, isError: false }
    },
  },
]
