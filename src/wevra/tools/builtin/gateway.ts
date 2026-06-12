import type { Tool } from "../../types"
import type { AgentService } from "../../../services/agent-service"
import type { GatewaySkillService } from "../../../services/gateway-skill-service"
import type { SessionService } from "../../../services/session-service"

export function createGatewayTools(
  agent?: AgentService,
  session?: SessionService,
  gatewaySkill?: GatewaySkillService,
): Tool[] {
  return [
    // ============================================
    // gateway_agent_list - List all OpenClaw agents
    // ============================================
    {
      name: "gateway_agent_list",
      description: "List all registered OpenClaw agents with their basic info and activity status.",
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
    // gateway_agent_get — Get OpenClaw agent details
    // ============================================
    {
      name: "gateway_agent_get",
      description: "Get detailed information about a specific OpenClaw agent.",
      parameters: {
        type: "object",
        properties: {
          agentId: { type: "string", description: "The OpenClaw agent ID" },
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
    // gateway_agent_create - Create agent
    // ============================================
    {
      name: "gateway_agent_create",
      description: "Create a new OpenClaw agent with a name and optional workspace path.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "OpenClaw agent name" },
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
    // gateway_agent_update - Update agent
    // ============================================
    {
      name: "gateway_agent_update",
      description: "Update an existing OpenClaw agent configuration.",
      parameters: {
        type: "object",
        properties: {
          agentId: { type: "string", description: "The OpenClaw agent ID" },
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
    // gateway_agent_delete - Delete agent
    // ============================================
    {
      name: "gateway_agent_delete",
      description: "Delete an OpenClaw agent permanently.",
      parameters: {
        type: "object",
        properties: {
          agentId: { type: "string", description: "The OpenClaw agent ID to delete" },
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
    // gateway_agent_send - Send message to agent
    // ============================================
    {
      name: "gateway_agent_send",
      description: "Send a message to an OpenClaw agent and wait for its reply.",
      parameters: {
        type: "object",
        properties: {
          agentId: { type: "string", description: "The OpenClaw agent ID" },
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

    // ============================================
    // gateway_skill_install — Install OpenClaw Gateway skill
    // ============================================
    {
      name: "gateway_skill_install",
      description:
        "Install a skill into the OpenClaw Gateway runtime. This is for OpenClaw's skill system, NOT Wevra's internal skills (use skill_load for Wevra skills). Three mutually exclusive modes:\n" +
        "- clawhub: from ClawHub registry (source='clawhub', slug required, version/force optional)\n" +
        "- upload: from uploaded archive (source='upload', slug+uploadId required, version/force optional)\n" +
        "- installer: declarative installer (name+installId required, dangerouslyForceUnsafeInstall optional, NO source field)",
      parameters: {
        type: "object",
        properties: {
          source: {
            type: "string",
            enum: ["clawhub", "upload"],
            description: "Install source: 'clawhub' or 'upload'. Do NOT include for installer mode.",
          },
          slug: {
            type: "string",
            description: "ClawHub skill slug (clawhub mode) or upload target slug (upload mode)",
          },
          version: {
            type: "string",
            description: "Optional version constraint (clawhub/upload modes)",
          },
          force: {
            type: "boolean",
            description: "Force reinstall even if already installed (clawhub/upload modes)",
          },
          uploadId: {
            type: "string",
            description: "Upload archive ID (upload mode, required)",
          },
          name: {
            type: "string",
            description:
              "Installer name (installer mode, required). Only use in installer mode — do NOT include 'source'.",
          },
          installId: {
            type: "string",
            description:
              "Installer identifier (installer mode, required). Only use in installer mode — do NOT include 'source'.",
          },
          dangerouslyForceUnsafeInstall: {
            type: "boolean",
            description: "Force unsafe install (installer mode, optional)",
          },
        },
        required: [],
      },
      annotations: {
        readOnly: false,
        destructive: false,
        requiresConfirmation: true,
        idempotent: true,
      },
      permission: "confirm",
      async execute(args) {
        if (!gatewaySkill) return { output: "Gateway skill service not available.", isError: true }

        const params = args as Record<string, unknown>
        const source = typeof params.source === "string" ? params.source.trim() : undefined
        const slug = typeof params.slug === "string" ? params.slug.trim() : undefined
        const name = typeof params.name === "string" ? params.name.trim() : undefined
        const installId = typeof params.installId === "string" ? params.installId.trim() : undefined
        const uploadId = typeof params.uploadId === "string" ? params.uploadId.trim() : undefined

        // Determine mode
        if (source === "clawhub" || source === "upload") {
          if (!slug) return { output: `"slug" is required for source "${source}"`, isError: true }
          if (source === "upload" && !uploadId)
            return { output: '"uploadId" is required for source "upload"', isError: true }

          try {
            const result = await gatewaySkill.installSkill({
              source,
              slug,
              uploadId: source === "upload" ? uploadId : undefined,
              version: typeof params.version === "string" ? params.version : undefined,
              force: params.force !== undefined ? Boolean(params.force) : undefined,
            } as any)
            return { output: JSON.stringify(result, null, 2), isError: false }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            return { output: `Skill install failed: ${msg}`, isError: true }
          }
        }

        if (name && installId) {
          // installer mode — no source field
          try {
            const result = await gatewaySkill.installSkill({
              name,
              installId,
              dangerouslyForceUnsafeInstall:
                params.dangerouslyForceUnsafeInstall !== undefined
                  ? Boolean(params.dangerouslyForceUnsafeInstall)
                  : undefined,
            } as any)
            return { output: JSON.stringify(result, null, 2), isError: false }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            return { output: `Skill install failed: ${msg}`, isError: true }
          }
        }

        return {
          output:
            "Invalid parameters. Use one of: (1) clawhub mode: source='clawhub'+slug; (2) upload mode: source='upload'+slug+uploadId; (3) installer mode: name+installId (no source).",
          isError: true,
        }
      },
    },

    // ============================================
    // gateway_skill_update — Update installed OpenClaw Gateway skill
    // ============================================
    {
      name: "gateway_skill_update",
      description:
        "Update an installed skill in the OpenClaw Gateway runtime. This is for OpenClaw's skill system, NOT Wevra's internal skills. Two modes: by skillKey (refresh local config) or by slug (update from ClawHub registry).",
      parameters: {
        type: "object",
        properties: {
          skillKey: {
            type: "string",
            description: "Local skill key to update config. Use this OR slug, not both.",
          },
          slug: {
            type: "string",
            description: "ClawHub skill slug to update from registry. Use this OR skillKey, not both.",
          },
          version: {
            type: "string",
            description: "Optional version constraint (slug mode only)",
          },
        },
        required: [],
      },
      annotations: { readOnly: false, destructive: false, requiresConfirmation: true, idempotent: true },
      permission: "confirm",
      async execute(args) {
        if (!gatewaySkill) return { output: "Gateway skill service not available.", isError: true }
        const params = args as Record<string, unknown>
        const skillKey = typeof params.skillKey === "string" ? params.skillKey.trim() : undefined
        const slug = typeof params.slug === "string" ? params.slug.trim() : undefined

        if (skillKey) {
          try {
            const result = await gatewaySkill.updateSkill({ skillKey })
            return { output: JSON.stringify(result, null, 2), isError: false }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            return { output: `Skill update failed: ${msg}`, isError: true }
          }
        }

        if (slug) {
          try {
            const result = await gatewaySkill.updateSkill({
              slug,
              version: typeof params.version === "string" ? params.version : undefined,
            })
            return { output: JSON.stringify(result, null, 2), isError: false }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            return { output: `Skill update failed: ${msg}`, isError: true }
          }
        }

        return { output: 'Either "skillKey" or "slug" is required.', isError: true }
      },
    },

    // ============================================
    // gateway_skill_search — Search OpenClaw Gateway ClawHub skills
    // ============================================
    {
      name: "gateway_skill_search",
      description:
        "Search the OpenClaw Gateway's ClawHub registry for installable skills. This is for OpenClaw's skill system, NOT Wevra's internal skills.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query string (optional). The gateway parameter name is 'query', not 'q'.",
          },
        },
        required: [],
      },
      annotations: { readOnly: true, destructive: false, requiresConfirmation: false, idempotent: true },
      permission: "auto",
      async execute(args) {
        if (!gatewaySkill) return { output: "Gateway skill service not available.", isError: true }
        const params = args as Record<string, unknown>
        try {
          const result = await gatewaySkill.searchSkills({
            query: typeof params.query === "string" ? params.query.trim() : undefined,
          })
          return { output: JSON.stringify(result, null, 2), isError: false }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          return { output: `Skill search failed: ${msg}`, isError: true }
        }
      },
    },

    // ============================================
    // gateway_skill_status — List installed OpenClaw Gateway skills
    // ============================================
    {
      name: "gateway_skill_status",
      description:
        "List all skills installed in the OpenClaw Gateway runtime, including bundled and ClawHub-installed skills. This is for OpenClaw's skill system, NOT Wevra's internal skills.",
      parameters: { type: "object", properties: {}, required: [] },
      annotations: { readOnly: true, destructive: false, requiresConfirmation: false, idempotent: true },
      permission: "auto",
      async execute() {
        if (!gatewaySkill) return { output: "Gateway skill service not available.", isError: true }
        try {
          const result = await gatewaySkill.getSkillStatus()
          return { output: JSON.stringify(result, null, 2), isError: false }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          return { output: `Skill status failed: ${msg}`, isError: true }
        }
      },
    },
  ]
}
