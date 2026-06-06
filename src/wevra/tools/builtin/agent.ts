import type { Tool } from '../../types'
import type { AgentService } from '../../../services/agent-service'

export function createAgentTools(agent?: AgentService): Tool[] {
  return [
    {
      name: 'agent_list',
      description: 'List all registered agents with their basic info.',
      parameters: { type: 'object', properties: {}, required: [] },
      annotations: { readOnly: true, destructive: false, requiresConfirmation: false, idempotent: true },
      permission: 'auto',
      async execute() {
        if (!agent) return { output: 'Agent service not available.', isError: true }
        try {
          const list = await agent.listAgents()
          if (list.length === 0) return { output: 'No agents registered.', isError: false }
          return {
            output: JSON.stringify(list.map(a => ({
              id: a.id,
              lastActiveAt: a.lastActiveAt,
            })), null, 2),
            isError: false,
          }
        } catch (err) {
          return { output: `Failed to list agents: ${err instanceof Error ? err.message : String(err)}`, isError: true }
        }
      },
    },
    {
      name: 'agent_get',
      description: 'Get detailed information about a specific agent.',
      parameters: {
        type: 'object',
        properties: { agentId: { type: 'string', description: 'The agent ID' } },
        required: ['agentId'],
      },
      annotations: { readOnly: true, destructive: false, requiresConfirmation: false, idempotent: true },
      permission: 'auto',
      async execute(args) {
        if (!agent) return { output: 'Agent service not available.', isError: true }
        const { agentId } = args as { agentId: string }
        try {
          const list = await agent.listAgents()
          const found = list.find(a => a.id === agentId)
          if (!found) return { output: `Agent "${agentId}" not found.`, isError: true }
          return {
            output: JSON.stringify({ id: found.id, lastActiveAt: found.lastActiveAt, raw: found.raw }, null, 2),
            isError: false,
          }
        } catch (err) {
          return { output: `Failed to get agent: ${err instanceof Error ? err.message : String(err)}`, isError: true }
        }
      },
    },
    {
      name: 'agent_create',
      description: 'Create a new agent with a name, role, and workspace path.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Agent name' },
          role: { type: 'string', description: 'Agent role (coder, reviewer, planner, tester, operator)', enum: ['coder', 'reviewer', 'planner', 'tester', 'operator'] },
          workspace: { type: 'string', description: 'Workspace directory path' },
        },
        required: ['name', 'role', 'workspace'],
      },
      annotations: { readOnly: false, destructive: false, requiresConfirmation: true, idempotent: false },
      permission: 'confirm',
      async execute(_args) {
        return { output: 'Agent creation is not yet wired to the service layer. Use the TaskMeld UI to create agents.', isError: true }
      },
    },
    {
      name: 'agent_update',
      description: 'Update an existing agent configuration.',
      parameters: {
        type: 'object',
        properties: {
          agentId: { type: 'string', description: 'The agent ID' },
          name: { type: 'string', description: 'New name' },
          workspace: { type: 'string', description: 'New workspace path' },
        },
        required: ['agentId'],
      },
      annotations: { readOnly: false, destructive: false, requiresConfirmation: true, idempotent: false },
      permission: 'confirm',
      async execute(_args) {
        return { output: 'Agent update is not yet wired to the service layer. Use the TaskMeld UI to update agents.', isError: true }
      },
    },
    {
      name: 'agent_delete',
      description: 'Delete an agent permanently.',
      parameters: {
        type: 'object',
        properties: { agentId: { type: 'string', description: 'The agent ID to delete' } },
        required: ['agentId'],
      },
      annotations: { readOnly: false, destructive: true, requiresConfirmation: true, idempotent: false },
      permission: 'confirm',
      async execute(_args) {
        return { output: 'Agent deletion is not yet wired to the service layer. Use the TaskMeld UI to delete agents.', isError: true }
      },
    },
    {
      name: 'agent_send',
      description: 'Send a message to an agent session. The agent will process and respond asynchronously.',
      parameters: {
        type: 'object',
        properties: {
          agentId: { type: 'string', description: 'The agent ID' },
          message: { type: 'string', description: 'Message to send' },
        },
        required: ['agentId', 'message'],
      },
      annotations: { readOnly: false, destructive: false, requiresConfirmation: false, idempotent: true },
      permission: 'auto',
      async execute(_args) {
        return { output: 'Agent send is not yet wired to the service layer.', isError: true }
      },
    },
  ]
}
