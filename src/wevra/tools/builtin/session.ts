import type { Tool } from "../../types"
import type { SessionService } from "../../../services/session-service"

export function createSessionTools(session?: SessionService): Tool[] {
  return [
    {
      name: "gateway_session_list",
      description:
        "List active OpenClaw agent execution sessions from the Gateway. These are external sessions living in the OpenClaw Gateway where agents execute pipeline nodes — NOT Wevra's internal conversation sessions.",
      parameters: { type: "object", properties: {}, required: [] },
      annotations: { readOnly: true, destructive: false, requiresConfirmation: false, idempotent: true },
      permission: "auto",
      async execute() {
        if (!session) return { output: "Session service not available.", isError: true }
        try {
          const list = await session.listSessions()
          if (list.length === 0) return { output: "No active sessions found.", isError: false }
          return {
            output: JSON.stringify(
              list.map((s) => ({
                id: s.id,
                title: s.title,
              })),
              null,
              2,
            ),
            isError: false,
          }
        } catch (err) {
          return {
            output: `Failed to list sessions: ${err instanceof Error ? err.message : String(err)}`,
            isError: true,
          }
        }
      },
    },
    {
      name: "gateway_session_get",
      description:
        "Get details of a specific OpenClaw agent execution session. These are external sessions living in the OpenClaw Gateway — NOT Wevra's internal conversation sessions.",
      parameters: {
        type: "object",
        properties: { sessionId: { type: "string", description: "The OpenClaw agent session ID" } },
        required: ["sessionId"],
      },
      annotations: { readOnly: true, destructive: false, requiresConfirmation: false, idempotent: true },
      permission: "auto",
      async execute(args) {
        if (!session) return { output: "Session service not available.", isError: true }
        const { sessionId } = args as { sessionId: string }
        try {
          const list = await session.listSessions()
          const found = list.find((s) => s.id === sessionId)
          if (!found) return { output: `Session "${sessionId}" not found.`, isError: true }
          return {
            output: JSON.stringify({ id: found.id, title: found.title, raw: found.raw }, null, 2),
            isError: false,
          }
        } catch (err) {
          return { output: `Failed to get session: ${err instanceof Error ? err.message : String(err)}`, isError: true }
        }
      },
    },
    {
      name: "gateway_session_history",
      description:
        "Get the conversation history of an OpenClaw agent execution session. This reads the agent's execution log from the OpenClaw Gateway — NOT Wevra's chat history.",
      parameters: {
        type: "object",
        properties: { sessionId: { type: "string", description: "The OpenClaw agent session ID" } },
        required: ["sessionId"],
      },
      annotations: { readOnly: true, destructive: false, requiresConfirmation: false, idempotent: true },
      permission: "auto",
      async execute(args) {
        if (!session) return { output: "Session service not available.", isError: true }
        const { sessionId } = args as { sessionId: string }
        try {
          const history = await session.getSessionHistory(sessionId)
          if (history.length === 0) return { output: `No history found for session "${sessionId}".`, isError: false }
          const formatted = history.map((h) => `[${h.role}]${h.ts ? ` (${h.ts})` : ""}: ${h.content}`).join("\n\n")
          return {
            output: formatted.length > 20000 ? formatted.slice(0, 20000) + "\n\n[... truncated]" : formatted,
            isError: false,
          }
        } catch (err) {
          return {
            output: `Failed to get session history: ${err instanceof Error ? err.message : String(err)}`,
            isError: true,
          }
        }
      },
    },
  ]
}
