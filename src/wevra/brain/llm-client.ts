import type {
  Message,
  ToolDefinition,
  LLMResponse,
  StreamEvent,
  OpenAIChatResponse,
  OpenAIStreamChunk,
  ToolCall,
  TokenUsage,
  RuntimeModelConfig,
  ThinkingConfig,
} from "../types"

export type DebugCallback = (event: { type: "request" | "stream_chunk" | "response" | "error"; data: unknown }) => void

export interface LLMClient {
  chat(messages: Message[], tools?: ToolDefinition[]): Promise<LLMResponse>
  streamChat(messages: Message[], tools?: ToolDefinition[], signal?: AbortSignal): AsyncIterable<StreamEvent>
  setDebugCallback(cb: DebugCallback | null): void
  updateModel(model: RuntimeModelConfig): void
  setThinkingLevel(level: ThinkingConfig["level"]): void
}

export function createLLMClient(modelConfig: RuntimeModelConfig, timeoutMs: number): LLMClient {
  return new OpenAICompatClient(modelConfig, timeoutMs)
}

class OpenAICompatClient implements LLMClient {
  private debug: DebugCallback | null = null

  constructor(
    private modelConfig: RuntimeModelConfig,
    private timeoutMs: number,
  ) {}

  setDebugCallback(cb: DebugCallback | null): void {
    this.debug = cb
  }

  updateModel(model: RuntimeModelConfig): void {
    this.modelConfig = model
  }

  setThinkingLevel(level: ThinkingConfig["level"]): void {
    this.modelConfig = { ...this.modelConfig, thinking: { level } }
  }

  async chat(messages: Message[], tools?: ToolDefinition[]): Promise<LLMResponse> {
    const body = this.buildRequest(messages, tools, false)
    this.debug?.({ type: "request", data: { raw: body } })
    const response = await this.fetch(body)
    const data: OpenAIChatResponse = await response.json()
    this.debug?.({ type: "response", data: { raw: data, parsed: this.parseResponse(data) } })
    return this.parseResponse(data)
  }

  async *streamChat(messages: Message[], tools?: ToolDefinition[], signal?: AbortSignal): AsyncIterable<StreamEvent> {
    const body = this.buildRequest(messages, tools, true)
    this.debug?.({ type: "request", data: { raw: body } })
    const response = await this.fetch(body, signal)

    if (!response.body) {
      yield { type: "error", error: "Empty response body" }
      return
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""

    // Accumulate tool call state
    const toolCalls = new Map<number, { id: string; name: string; arguments: string }>()
    let thinkingStarted = false
    let textStarted = false
    let reasoningContent = "" // Accumulate reasoning_content for passthrough

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() ?? ""

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || !trimmed.startsWith("data: ")) continue

          const dataStr = trimmed.slice(6)
          if (dataStr === "[DONE]") return

          this.debug?.({ type: "stream_chunk", data: { raw: JSON.parse(dataStr) } })

          try {
            const chunk: OpenAIStreamChunk = JSON.parse(dataStr)
            const delta = chunk.choices?.[0]?.delta
            if (!delta) continue

            // DeepSeek reasoning_content — only treat as thinking when there is actual content
            // DeepSeek V4 sends reasoning_content: "NULL" string during reply phase, must be filtered
            const hasReasoning =
              delta.reasoning_content !== undefined &&
              delta.reasoning_content !== null &&
              delta.reasoning_content !== "NULL" &&
              delta.reasoning_content !== ""

            if (hasReasoning) {
              if (!thinkingStarted) {
                thinkingStarted = true
                yield { type: "thinking_start" }
              }
              reasoningContent += delta.reasoning_content
              yield { type: "thinking_delta", content: delta.reasoning_content! }
              continue
            }

            // If reasoning_content field exists but is empty, thinking has ended
            if (delta.reasoning_content !== undefined && thinkingStarted) {
              yield { type: "thinking_end" }
              thinkingStarted = false
            }

            // Text content — filter DeepSeek's "NULL" placeholder
            const content = delta.content
            if (content && content !== "NULL") {
              if (!textStarted) {
                // End thinking (if active)
                if (thinkingStarted) {
                  yield { type: "thinking_end" }
                  thinkingStarted = false
                }
                textStarted = true
                yield { type: "text_start" }
              }
              yield { type: "text_delta", content: content! }
            }

            // Tool calls
            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index
                if (!toolCalls.has(idx)) {
                  toolCalls.set(idx, { id: tc.id ?? "", name: "", arguments: "" })
                  // Don't yield tool_start here; wait for finish_reason to emit complete arguments
                }
                const existing = toolCalls.get(idx)!
                if (tc.id) existing.id = tc.id
                if (tc.function?.name) existing.name = tc.function.name
                if (tc.function?.arguments) existing.arguments += tc.function.arguments
              }
            }

            // Usage (may be present at end of stream)
            if (chunk.usage) {
              yield {
                type: "step_finish",
                usage: this.parseUsage(chunk.usage),
              }
            }

            // Finish reason
            const finishReason = chunk.choices?.[0]?.finish_reason
            if (finishReason) {
              if (thinkingStarted) {
                yield { type: "thinking_end" }
                thinkingStarted = false
              }
              if (textStarted && finishReason !== "tool_calls") {
                yield { type: "text_end" }
                // Pass reasoning_content for non-tool-call responses
                if (reasoningContent) {
                  yield { type: "step_finish", content: reasoningContent }
                }
              }
              // If tool_calls, yield accumulated tool calls + reasoning_content
              if (finishReason === "tool_calls" && toolCalls.size > 0) {
                for (const tc of toolCalls.values()) {
                  yield {
                    type: "tool_start",
                    toolCall: {
                      id: tc.id,
                      name: tc.name,
                      arguments: safeParseJSON(tc.arguments),
                    },
                  }
                }
                // Pass reasoning_content to agent-loop via step_finish
                if (reasoningContent) {
                  yield { type: "step_finish", content: reasoningContent }
                }
              }
            }
          } catch {
            // Ignore unparseable lines
          }
        }
      }
    } finally {
      reader.releaseLock()
    }
  }

  // ── Internal methods ──

  private buildUrl(path: string): string {
    const base = this.modelConfig.baseUrl.replace(/\/+$/, "")
    return /\/v\d+$/.test(base) ? `${base}${path}` : `${base}/v1${path}`
  }

  private buildRequest(
    messages: Message[],
    tools: ToolDefinition[] | undefined,
    stream: boolean,
  ): Record<string, unknown> {
    const compat = this.modelConfig.compat
    const thinkingLevel = this.modelConfig.thinking?.level ?? "off"
    const thinkingEnabled = thinkingLevel !== "off"

    const req: Record<string, unknown> = {
      model: this.modelConfig.modelId,
      messages: this.toOpenAIMessages(messages),
      stream,
    }

    // max_tokens field name is determined by compat
    if (this.modelConfig.maxTokens) {
      req[compat.maxTokensField] = this.modelConfig.maxTokens
    }

    // temperature — skip if ignored in thinking mode
    if (!(compat.temperatureIgnoredInThinking && thinkingEnabled)) {
      req.temperature = 1
    }

    // Tools
    if (tools && tools.length > 0) {
      req.tools = tools.map((t) => ({
        type: "function" as const,
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }))
      req.tool_choice = "auto"
    }

    // reasoning_effort — only when model supports it and thinking is enabled
    if (compat.supportsReasoningEffort && thinkingEnabled) {
      req.reasoning_effort = mapThinkingLevelToEffort(thinkingLevel)
    }

    // DeepSeek-specific: extra_body thinking toggle
    if (compat.extraBodyThinkingToggle && thinkingEnabled) {
      req.extra_body = { thinking: { type: "enabled", level: thinkingLevel } }
    }

    return req
  }

  private toOpenAIMessages(messages: Message[]): unknown[] {
    const compat = this.modelConfig.compat
    return messages.map((m) => {
      if (m.role === "tool") {
        return {
          role: "tool",
          tool_call_id: m.toolCallId,
          content: m.content,
        }
      }
      if (m.role === "assistant") {
        const hasToolCalls = m.toolCalls && m.toolCalls.length > 0
        return {
          role: "assistant",
          content: m.content || null,
          // Only DeepSeek needs passthrough
          ...(compat.requiresReasoningContentPassthrough && m.reasoningContent
            ? { reasoning_content: m.reasoningContent }
            : {}),
          ...(hasToolCalls
            ? {
                tool_calls: m.toolCalls!.map((tc) => ({
                  id: tc.id,
                  type: "function",
                  function: {
                    name: tc.name,
                    arguments: JSON.stringify(tc.arguments),
                  },
                })),
              }
            : {}),
        }
      }
      return {
        role: m.role,
        content: m.content,
      }
    })
  }

  private async fetch(body: unknown, externalSignal?: AbortSignal): Promise<Response> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
    // Chain external signal → internal abort
    externalSignal?.addEventListener("abort", () => controller.abort(), { once: true })

    try {
      const resp = await fetch(this.buildUrl("/chat/completions"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.modelConfig.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })

      if (!resp.ok) {
        const text = await resp.text()
        throw new Error(`LLM API error ${resp.status}: ${text}`)
      }

      return resp
    } finally {
      clearTimeout(timeout)
    }
  }

  private parseResponse(data: OpenAIChatResponse): LLMResponse {
    const choice = data.choices[0]
    const rawToolCalls = choice.message.tool_calls ?? []

    const toolCalls: ToolCall[] = rawToolCalls.map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: safeParseJSON(tc.function.arguments),
    }))

    return {
      content: choice.message.content ?? "",
      toolCalls,
      usage: this.parseUsage(data.usage),
      finishReason: choice.finish_reason as LLMResponse["finishReason"],
    }
  }

  private parseUsage(usage: OpenAIChatResponse["usage"]): TokenUsage {
    return {
      promptTokens: usage.prompt_tokens,
      completionTokens: usage.completion_tokens,
      totalTokens: usage.total_tokens,
      cachedTokens: usage.prompt_tokens_details?.cached_tokens,
      reasoningTokens: usage.completion_tokens_details?.reasoning_tokens,
    }
  }
}

// ── Utilities ──

function safeParseJSON(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw)
  } catch {
    /* continue */
  }

  const fixes = ["}", "}]", '"}"]', '"]']
  for (const fix of fixes) {
    try {
      return JSON.parse(raw + fix)
    } catch {
      /* continue */
    }
  }

  return {}
}

function mapThinkingLevelToEffort(level: string): string {
  switch (level) {
    case "low":
      return "low"
    case "medium":
      return "medium"
    case "high":
    case "max":
    default:
      return "high"
  }
}
