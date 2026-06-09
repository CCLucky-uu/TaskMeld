import type { Tool } from "../../types"

export function createQuestionTool(): Tool[] {
  return [
    {
      name: "ask_user",
      description: `Ask the user one or more structured questions with predefined options.
The user picks from your options, or selects "Other" to type a custom answer.

Use cases:
- Pipeline design: ask about goals, node structure, agent assignment
- Ambiguous requirements: clarify what the user actually wants
- Architecture decisions: let the user choose between alternatives
- Gathering multiple inputs in a single interaction (batch questions)

Return value: { "answers": [...] } — an array matching the questions order, each containing the question text and full selected option details (label + description).

IMPORTANT:
- Do NOT use this tool for simple yes/no confirmations on tool execution.
- Do NOT use this tool for open-ended questions with no predefined choices. Just ask in plain text — the user will reply in chat.
- Always provide 2-4 clear options per question. An "Other" option is always available automatically.
- Group related questions into a single call rather than making multiple separate calls.`,
      parameters: {
        type: "object",
        properties: {
          questions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                question: {
                  type: "string",
                  description: "The question to ask. Be specific and clear.",
                },
                header: {
                  type: "string",
                  description: "Short label for the question tab (max 12 chars). Examples: Goal, Nodes, Agent",
                },
                options: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      label: { type: "string", description: "Short display text (1-5 words)" },
                      description: { type: "string", description: "Explanation of what this option means" },
                    },
                    required: ["label", "description"],
                  },
                  description: "2-4 predefined choices. An 'Other' option is appended automatically for custom input.",
                },
                multiSelect: {
                  type: "boolean",
                  description: "Allow selecting multiple options. Default: false.",
                },
              },
              required: ["question", "options"],
            },
            description:
              "One or more questions to ask. Each question has its own options. For a single question, pass an array with one item.",
          },
        },
        required: ["questions"],
      },
      annotations: { readOnly: true, destructive: false, requiresConfirmation: false, idempotent: true },
      permission: "auto",
      async execute(args) {
        const { questions } = args as {
          questions?: Array<{
            question: string
            header?: string
            options?: Array<{ label: string; description: string }>
            multiSelect?: boolean
          }>
        }

        if (!questions || questions.length === 0) {
          return { output: "Error: questions array is required and must have at least 1 question.", isError: true }
        }

        for (let i = 0; i < questions.length; i++) {
          const q = questions[i]
          if (!q.question?.trim()) {
            return { output: `Error: questions[${i}].question is required.`, isError: true }
          }
          if (!q.options || q.options.length < 2) {
            return {
              output: `Error: questions[${i}].options must have at least 2 choices. If you just want to ask, use plain text instead.`,
              isError: true,
            }
          }
        }

        return {
          output: "",
          isError: false,
          needsUserInput: true,
          metadata: {
            question: questions.map((q) => ({
              question: q.question.trim(),
              header: q.header?.trim() ?? null,
              options: q.options,
              multiSelect: q.multiSelect ?? false,
            })),
          },
        }
      },
    },
  ]
}
