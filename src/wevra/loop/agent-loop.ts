import type {
  Message,
  ToolCall,
  StreamEvent,
  LoopResult,
  ToolContext,
  ConfirmRequest,
  QuestionRequest,
  QuestionAnswer,
  ToolPreferences,
} from "../types"
import { DEFAULT_TOOL_PREFERENCES } from "../types"
import type { Brain, DebugCallback } from "../brain"
import type { ToolExecutor } from "../tools/executor"
import type { ToolRegistry } from "../tools/registry"
import type { SkillRegistry } from "../skills"
import type { WevraMemory } from "../memory"
import type { SessionData } from "../conversation"
import type { WevraConfig } from "../config"
import { generateMessageId } from "../util"

const MODE_PROMPTS: Record<string, string> = {
  normal:
    "Normal mode is active. Read-only tools execute freely. Write and destructive tools require user confirmation before execution.",
  plan: "Plan mode is active. You have read-only access — write and destructive tools are unavailable until the user switches mode.",
  auto: "Auto mode is active. All tools are available without confirmation.",
}

export interface LoopCallbacks {
  onStream?: (event: StreamEvent) => void
  onDebug?: (payload: unknown) => void
  /** Message write callback — called for each assistant/tool message produced in the loop */
  onMessage?: (message: Message) => Promise<void>
  onConfirm?: (req: ConfirmRequest) => Promise<"allow" | "deny" | "always-allow">
  onQuestion?: (req: QuestionRequest) => Promise<QuestionAnswer>
}

export class WevraLoop {
  constructor(
    private brain: Brain | null,
    private executor: ToolExecutor,
    private registry: ToolRegistry,
    private skills: SkillRegistry,
    private memory: WevraMemory,
    private config: WevraConfig,
  ) {}

  async run(
    fullHistory: Message[],
    session: SessionData,
    callbacks?: LoopCallbacks,
    preferences?: ToolPreferences,
    externalAbort?: AbortController,
  ): Promise<LoopResult> {
    if (!this.brain) return { type: "error", content: "No LLM model configured", iterations: 0 }

    const allTools = session.frozenTools
    let iterations = 0

    while (iterations < this.config.maxIterations) {
      iterations++

      // Check external abort
      if (externalAbort?.signal.aborted) {
        return { type: "error", content: "Chat aborted by user.", iterations }
      }

      // Build request messages: frozen prompt (cacheable) + history with mode markers expanded
      const expandedHistory = fullHistory
        .map((msg) => {
          if (msg.role === "system") {
            const match = msg.content.match(/^\[mode:(\w+):v(\d+)\]$/)
            if (match) {
              const template = MODE_PROMPTS[match[1]] ?? ""
              const prompt = template ? `${template} [mode-version: ${match[2]}]` : ""
              return prompt ? { ...msg, content: prompt } : null
            }
          }
          return msg
        })
        .filter((msg): msg is Message => msg !== null)

      const requestMessages: Message[] = [{ role: "system", content: session.frozenPrompt }, ...expandedHistory]

      // LLM inference (streaming)
      let assistantContent = ""
      const toolCalls: ToolCall[] = []
      let reasoningContent = "" // DeepSeek reasoning_content must be passed back

      for await (const event of this.brain.streamChat(requestMessages, allTools, externalAbort?.signal)) {
        callbacks?.onStream?.(event)

        switch (event.type) {
          case "text_delta":
            assistantContent += event.content ?? ""
            break
          case "tool_start":
            if (event.toolCall) toolCalls.push(event.toolCall)
            break
          case "step_finish":
            if (event.content) reasoningContent = event.content
            break
        }
      }

      // Append assistant message
      const assistantMsg: Message = {
        role: "assistant",
        content: assistantContent,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        reasoningContent: reasoningContent || undefined,
        timestamp: Date.now(),
      }
      fullHistory.push(assistantMsg)
      await callbacks?.onMessage?.(assistantMsg)

      // No tool calls → done
      if (toolCalls.length === 0) {
        return {
          type: "text",
          content: assistantContent,
          iterations,
        }
      }

      // Execute tool calls
      const toolCtx = this.buildToolContext(session.id, session.conversationId, preferences ?? DEFAULT_TOOL_PREFERENCES, externalAbort)
      const results = await this.executor.executeAll(toolCalls, toolCtx)

      // Handle tool calls that need user confirmation or structured input
      const finalResults: typeof results = []
      for (let i = 0; i < results.length; i++) {
        const result = results[i]

        // Handle needsUserInput: tool asks the user structured questions
        if (result.needsUserInput && callbacks?.onQuestion) {
          const questionMeta = result.metadata?.question
          const questionsArray = Array.isArray(questionMeta) ? questionMeta : [questionMeta]
          const questionReq: QuestionRequest = {
            toolCallId: toolCalls[i].id,
            questions: questionsArray.map((q: Record<string, unknown>) => ({
              question: typeof q.question === "string" ? q.question : "",
              header: typeof q.header === "string" ? q.header : undefined,
              options: Array.isArray(q.options) ? q.options : [],
              multiSelect: q.multiSelect === true,
            })),
          }

          callbacks.onStream?.({ type: "question_request", ...questionReq } as StreamEvent)

          try {
            const answer = await callbacks.onQuestion(questionReq)
            callbacks.onStream?.({ type: "question_response", content: JSON.stringify(answer) })
            finalResults.push({ output: JSON.stringify(answer), isError: false })
          } catch (err) {
            // Timeout or other failure — emit error result so the conversation
            // history stays valid (every tool_call needs a matching tool message).
            const errMsg = err instanceof Error ? err.message : String(err)
            callbacks.onStream?.({ type: "question_response", content: `Error: ${errMsg}` })
            finalResults.push({
              output: `Question timed out or failed: ${errMsg}. The user did not answer in time. Ask again or proceed without the answer.`,
              isError: false,
            })
          }
          continue
        }

        // Handle needsConfirmation
        if (result.needsConfirmation && callbacks?.onConfirm) {
          callbacks?.onStream?.({
            type: "confirm_request",
            toolCall: {
              id: toolCalls[i].id,
              name: toolCalls[i].name,
              arguments: toolCalls[i].arguments,
            },
          })

          const decision = await callbacks.onConfirm({
            toolCallId: toolCalls[i].id,
            toolName: toolCalls[i].name,
            toolArgs: toolCalls[i].arguments,
          })

          callbacks?.onStream?.({ type: "confirm_response", content: decision })

          if (decision === "deny") {
            finalResults.push({
              output: `User denied execution of "${toolCalls[i].name}".`,
              isError: true,
            })
            continue
          }
          const [singleResult] = await this.executor.executeAll([toolCalls[i]], toolCtx, { skipPermission: true })
          finalResults.push(singleResult)
        } else if (result.needsConfirmation) {
          finalResults.push({
            output: `Confirmation required for "${toolCalls[i].name}" but no confirm handler available.`,
            isError: true,
          })
        } else {
          finalResults.push(result)
        }
      }

      // Append tool results
      for (let i = 0; i < toolCalls.length; i++) {
        const result = finalResults[i]
        const toolMsg: Message = {
          role: "tool",
          toolCallId: toolCalls[i].id,
          content: result.output,
          isError: result.isError,
          timestamp: Date.now(),
        }
        fullHistory.push(toolMsg)
        await callbacks?.onMessage?.(toolMsg)

        callbacks?.onStream?.({
          type: "tool_delta",
          content: result.output,
          toolResult: { ...result, toolCallId: toolCalls[i].id },
        })
      }

      // Loop back to top — fullHistory is already updated in memory, no reload needed
    }

    return {
      type: "max_iterations",
      content: "Reached maximum iterations.",
      iterations,
    }
  }

  private buildToolContext(
    sessionId: string,
    conversationId: string,
    preferences: ToolPreferences,
    externalAbort?: AbortController,
  ): ToolContext {
    // Merge external abort with tool timeout
    const merged = new AbortController()
    const timeoutSignal = AbortSignal.timeout(this.config.toolTimeoutMs)
    timeoutSignal.addEventListener("abort", () => merged.abort(), { once: true })
    externalAbort?.signal.addEventListener("abort", () => merged.abort(), { once: true })

    return {
      sessionId,
      conversationId,
      preferences,
      messageId: generateMessageId(),
      abortSignal: merged.signal,
      requestPermission: async () => true,
      services: null as unknown,
      memory: this.memory,
      webFetcher: null as unknown,
      logger: {
        info: (msg: string) => console.log(`[wevra] ${msg}`),
        warn: (msg: string) => console.warn(`[wevra] ${msg}`),
        error: (msg: string) => console.error(`[wevra] ${msg}`),
        debug: (msg: string) => console.debug(`[wevra] ${msg}`),
      },
    }
  }
}
