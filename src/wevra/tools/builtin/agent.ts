import type { Tool } from "../../types"
import type { AgentService } from "../../../services/agent-service"
import type { SessionService } from "../../../services/session-service"

export function createAgentTools(agent?: AgentService, session?: SessionService): Tool[] {
  return [
    // ============================================
    // agent_list - List all agents
    // ============================================
    {
      name: "agent_list",
      description: "List all registered agents with their basic info and activity status.",
      parameters: {
        type: "object",
        properties: {
          includeInactive: {
            type: "boolean",
            description: "Include agents inactive for more than 24 hours (default: true)",
          },
        },
        required: [],
      },
      annotations: { readOnly: true, destructive: false, requiresConfirmation: false, idempotent: true },
      permission: "auto",
      async execute(args) {
        if (!agent) return { output: "Agent service not available.", isError: true }
        const { includeInactive = true } = args as { includeInactive?: boolean }

        try {
          const list = await agent.listAgents()
          if (list.length === 0) {
            return { output: "No agents registered.", isError: false }
          }

          let filteredList = list
          if (!includeInactive) {
            const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000
            filteredList = list.filter((a) => {
              if (!a.lastActiveAtMs) return true // Keep agents with no activity record
              return a.lastActiveAtMs > oneDayAgo
            })
          }

          if (filteredList.length === 0) {
            return { output: "No active agents found.", isError: false }
          }

          const summary = {
            total: list.length,
            showing: filteredList.length,
            agents: filteredList.map((a) => ({
              id: a.id,
              lastActiveAt: a.lastActiveAt || "Never",
            })),
          }

          return {
            output: JSON.stringify(summary, null, 2),
            isError: false,
          }
        } catch (err) {
          return {
            output: `Failed to list agents: ${err instanceof Error ? err.message : String(err)}`,
            isError: true,
          }
        }
      },
    },

    // ============================================
    // agent_get - Get agent details
    // ============================================
    {
      name: "agent_get",
      description: "Get detailed information about a specific agent.",
      parameters: {
        type: "object",
        properties: {
          agentId: { type: "string", description: "The agent ID" },
          includeSessions: {
            type: "boolean",
            description: "Whether to include active sessions (default: false)",
          },
        },
        required: ["agentId"],
      },
      annotations: { readOnly: true, destructive: false, requiresConfirmation: false, idempotent: true },
      permission: "auto",
      async execute(args) {
        if (!agent) return { output: "Agent service not available.", isError: true }
        const { agentId, includeSessions = false } = args as {
          agentId: string
          includeSessions?: boolean
        }

        try {
          const list = await agent.listAgents()
          const found = list.find((a) => a.id === agentId)
          if (!found) {
            return { output: `Agent "${agentId}" not found.`, isError: true }
          }

          const output: Record<string, unknown> = {
            id: found.id,
            lastActiveAt: found.lastActiveAt || "Never",
            raw: found.raw,
          }

          // Optionally include sessions info
          if (includeSessions && session) {
            try {
              const sessions = await session.listSessions()
              const agentSessions = sessions.filter((s) => {
                const id = s.id || ""
                return id.startsWith("agent:") && id.includes(`:${agentId}`)
              })
              output.activeSessions = agentSessions.length
              output.sessions = agentSessions.map((s) => ({
                id: s.id,
                title: s.title,
              }))
            } catch {
              output.sessionsError = "Failed to fetch sessions"
            }
          }

          return {
            output: JSON.stringify(output, null, 2),
            isError: false,
          }
        } catch (err) {
          return {
            output: `Failed to get agent: ${err instanceof Error ? err.message : String(err)}`,
            isError: true,
          }
        }
      },
    },

    // ============================================
    // agent_create - Create agent
    // ============================================
    {
      name: "agent_create",
      description: "Create a new agent with a name and optional workspace path.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Agent name" },
          workspace: {
            type: "string",
            description: "Workspace directory path (optional, auto-generated if not provided)",
          },
        },
        required: ["name"],
      },
      annotations: { readOnly: false, destructive: false, requiresConfirmation: true, idempotent: false },
      permission: "confirm",
      async execute(args) {
        if (!agent) return { output: "Agent service not available.", isError: true }
        const { name, workspace } = args as { name: string; workspace?: string }

        if (!name || !name.trim()) {
          return { output: "Agent name is required.", isError: true }
        }

        try {
          const result = await agent.createAgent({ name: name.trim(), workspace })
          return {
            output: `Agent created successfully:\n${JSON.stringify(result, null, 2)}`,
            isError: false,
          }
        } catch (err) {
          return {
            output: `Failed to create agent: ${err instanceof Error ? err.message : String(err)}`,
            isError: true,
          }
        }
      },
    },

    // ============================================
    // agent_update - Update agent
    // ============================================
    {
      name: "agent_update",
      description: "Update an existing agent configuration.",
      parameters: {
        type: "object",
        properties: {
          agentId: { type: "string", description: "The agent ID" },
          name: { type: "string", description: "New name" },
          workspace: { type: "string", description: "New workspace path" },
        },
        required: ["agentId"],
      },
      annotations: { readOnly: false, destructive: false, requiresConfirmation: true, idempotent: false },
      permission: "confirm",
      async execute(args) {
        if (!agent) return { output: "Agent service not available.", isError: true }
        const { agentId, name, workspace } = args as {
          agentId: string
          name?: string
          workspace?: string
        }

        if (!name?.trim() && !workspace?.trim()) {
          return {
            output: "At least one of 'name' or 'workspace' must be provided.",
            isError: true,
          }
        }

        try {
          const result = await agent.updateAgent({
            agentId,
            name: name?.trim(),
            workspace: workspace?.trim(),
          })
          return {
            output: `Agent updated successfully:\n${JSON.stringify(result, null, 2)}`,
            isError: false,
          }
        } catch (err) {
          return {
            output: `Failed to update agent: ${err instanceof Error ? err.message : String(err)}`,
            isError: true,
          }
        }
      },
    },

    // ============================================
    // agent_delete - Delete agent
    // ============================================
    {
      name: "agent_delete",
      description: "Delete an agent permanently.",
      parameters: {
        type: "object",
        properties: {
          agentId: { type: "string", description: "The agent ID to delete" },
          deleteFiles: {
            type: "boolean",
            description: "Whether to delete agent workspace files (default: false)",
          },
        },
        required: ["agentId"],
      },
      annotations: { readOnly: false, destructive: true, requiresConfirmation: true, idempotent: false },
      permission: "confirm",
      async execute(args) {
        if (!agent) return { output: "Agent service not available.", isError: true }
        const { agentId, deleteFiles } = args as {
          agentId: string
          deleteFiles?: boolean
        }

        try {
          const result = await agent.deleteAgent({ agentId, deleteFiles })
          return {
            output: `Agent deleted successfully:\n${JSON.stringify(result, null, 2)}`,
            isError: false,
          }
        } catch (err) {
          return {
            output: `Failed to delete agent: ${err instanceof Error ? err.message : String(err)}`,
            isError: true,
          }
        }
      },
    },

    // ============================================
    // agent_send - Send message to agent
    // ============================================
    {
      name: "agent_send",
      description:
        "Send a message to an agent and wait for its reply.",
      parameters: {
        type: "object",
        properties: {
          agentId: { type: "string", description: "The agent ID" },
          message: { type: "string", description: "Message to send" },
          sessionId: {
            type: "string",
            description: "Session ID (default: 'main'). Use different session IDs for separate conversation threads.",
          },
          timeoutMs: {
            type: "number",
            description: "Timeout in milliseconds (default: 120000, max: 300000)",
          },
        },
        required: ["agentId", "message"],
      },
      annotations: { readOnly: false, destructive: false, requiresConfirmation: false, idempotent: true },
      permission: "auto",
      async execute(args) {
        if (!session) return { output: "Session service not available.", isError: true }

        const {
          agentId,
          message,
          sessionId = "main",
          timeoutMs = 120_000,
        } = args as {
          agentId: string
          message: string
          sessionId?: string
          timeoutMs?: number
        }

        // Construct agent session ID
        const fullSessionId = `agent:${sessionId}:${agentId}`

        // Clamp timeout to reasonable range (10s - 5min)
        const clampedTimeout = Math.min(Math.max(timeoutMs, 10_000), 300_000)

        try {
          const result = await session.sendMessageAndWaitForReply(
            { sessionId: fullSessionId, message },
            { timeoutMs: clampedTimeout },
          )

          // Extract reply content
          const reply = (result as { reply?: { content?: string } })?.reply
          const replyContent = reply?.content || "No reply received"

          return {
            output: `Message sent to agent ${agentId} (session: ${sessionId})\n\nReply:\n${replyContent}`,
            isError: false,
          }
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err)

          // Distinguish timeout errors from other errors
          if (errorMsg.includes("timeout")) {
            return {
              output: `Timeout waiting for agent ${agentId} reply (waited ${clampedTimeout / 1000}s). The agent may still be processing.`,
              isError: true,
            }
          }

          return {
            output: `Failed to send message to agent: ${errorMsg}`,
            isError: true,
          }
        }
      },
    },
  ]
}
