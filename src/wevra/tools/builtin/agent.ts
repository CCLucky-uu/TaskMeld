import type { Tool } from '../../types'

const MOCK_AGENTS = [
  { id: 'agent-001', name: 'coder-1', role: 'coder', workspace: '/projects/main', status: 'idle' },
  { id: 'agent-002', name: 'reviewer-1', role: 'reviewer', workspace: '/projects/main', status: 'idle' },
]

export const agentTools: Tool[] = [
  {
    name: 'agent_list',
    description: 'List all registered agents with their basic info.',
    parameters: { type: 'object', properties: {}, required: [] },
    annotations: { readOnly: true, destructive: false, requiresConfirmation: false, idempotent: true },
    permission: 'auto',
    async execute() {
      return { output: JSON.stringify(MOCK_AGENTS, null, 2), isError: false }
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
      const { agentId } = args as { agentId: string }
      const agent = MOCK_AGENTS.find(a => a.id === agentId)
      if (!agent) return { output: `Agent "${agentId}" not found.`, isError: true }
      return { output: JSON.stringify(agent, null, 2), isError: false }
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
    async execute(args) {
      const { name, role, workspace } = args as { name: string; role: string; workspace: string }
      const id = `agent-${Date.now().toString(36)}`
      return { output: JSON.stringify({ id, name, role, workspace, status: 'idle', message: 'Agent created.' }, null, 2), isError: false }
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
    async execute(args) {
      const { agentId } = args as { agentId: string }
      return { output: `Agent "${agentId}" updated.`, isError: false }
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
    async execute(args) {
      const { agentId } = args as { agentId: string }
      return { output: `Agent "${agentId}" deleted.`, isError: false }
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
    async execute(args) {
      const { agentId, message } = args as { agentId: string; message: string }
      return { output: `Message sent to agent "${agentId}". Response will arrive asynchronously.`, isError: false }
    },
  },
]
