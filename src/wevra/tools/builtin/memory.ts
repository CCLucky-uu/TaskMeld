import type { Tool } from "../../types"
import type { WevraMemory } from "../../memory"

export function createMemoryTools(memory: WevraMemory): Tool[] {
  return [
    {
      name: "memory_recall",
      description: "Search your memory for relevant information about past conversations, decisions, and facts.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "What to search for in memory" },
          topK: { type: "number", description: "Max results to return, default 5", default: 5 },
        },
        required: ["query"],
      },
      annotations: { readOnly: true, destructive: false, requiresConfirmation: false, idempotent: true },
      permission: "auto",
      async execute(args) {
        const { query, topK } = args as { query: string; topK?: number }
        const results = await memory.recall({ query, scope: "global", topK: topK ?? 5 })
        if (results.length === 0) {
          return { output: "No relevant memories found.", isError: false }
        }
        return {
          output: results
            .map((r) => `- [${r.createdAt}] ${r.content} (importance: ${r.importance}, tags: ${r.tags.join(", ")})`)
            .join("\n"),
          isError: false,
        }
      },
    },
    {
      name: "memory_remember",
      description: "Save information to your long-term memory for future reference.",
      parameters: {
        type: "object",
        properties: {
          content: { type: "string", description: "The information to remember" },
          type: { type: "string", description: "Memory type", enum: ["fact", "preference", "event", "summary"] },
          importance: { type: "number", description: "Importance 0-1", default: 0.5 },
          tags: { type: "array", items: { type: "string" }, description: "Tags for categorization" },
        },
        required: ["content", "type"],
      },
      annotations: { readOnly: false, destructive: false, requiresConfirmation: false, idempotent: true },
      permission: "auto",
      async execute(args) {
        const { content, type, importance, tags } = args as {
          content: string
          type: string
          importance?: number
          tags?: string[]
        }
        await memory.remember({
          content,
          type: type as "fact" | "preference" | "event" | "summary",
          scope: "global",
          importance: importance ?? 0.5,
          tags: tags ?? [],
          source: "wevra",
          createdAt: new Date().toISOString(),
        })
        return { output: "Saved to memory.", isError: false }
      },
    },
  ]
}
