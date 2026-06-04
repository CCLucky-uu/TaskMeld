import type {
  Message, ToolDefinition, LLMResponse, StreamEvent,
  OpenAIChatResponse, OpenAIStreamChunk, ToolCall, TokenUsage,
  RuntimeModelConfig,
} from '../types'

export type DebugCallback = (event: { type: 'request' | 'stream_chunk' | 'response' | 'error'; data: unknown }) => void

export interface LLMClient {
  chat(messages: Message[], tools?: ToolDefinition[]): Promise<LLMResponse>
  streamChat(messages: Message[], tools?: ToolDefinition[]): AsyncIterable<StreamEvent>
  setDebugCallback(cb: DebugCallback | null): void
  updateModel(model: RuntimeModelConfig): void
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

  async chat(messages: Message[], tools?: ToolDefinition[]): Promise<LLMResponse> {
    const body = this.buildRequest(messages, tools, false)
    this.debug?.({ type: 'request', data: { raw: body } })
    const response = await this.fetch(body)
    const data: OpenAIChatResponse = await response.json()
    this.debug?.({ type: 'response', data: { raw: data, parsed: this.parseResponse(data) } })
    return this.parseResponse(data)
  }

  async *streamChat(messages: Message[], tools?: ToolDefinition[]): AsyncIterable<StreamEvent> {
    const body = this.buildRequest(messages, tools, true)
    this.debug?.({ type: 'request', data: { raw: body } })
    const response = await this.fetch(body)

    if (!response.body) {
      yield { type: 'error', error: 'Empty response body' }
      return
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    // 累积 tool call 的状态
    const toolCalls = new Map<number, { id: string; name: string; arguments: string }>()
    let thinkingStarted = false
    let textStarted = false
    let reasoningContent = ''  // 累积 reasoning_content 用于回传

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || !trimmed.startsWith('data: ')) continue

          const dataStr = trimmed.slice(6)
          if (dataStr === '[DONE]') return

          this.debug?.({ type: 'stream_chunk', data: { raw: JSON.parse(dataStr) } })

          try {
            const chunk: OpenAIStreamChunk = JSON.parse(dataStr)
            const delta = chunk.choices?.[0]?.delta
            if (!delta) continue

            // DeepSeek reasoning_content — 仅当有实际内容时才视为 thinking
            // DeepSeek V4 在回复阶段会发 reasoning_content: "NULL" 字符串，需要过滤
            const hasReasoning = delta.reasoning_content !== undefined
              && delta.reasoning_content !== null
              && delta.reasoning_content !== 'NULL'
              && delta.reasoning_content !== ''

            if (hasReasoning) {
              if (!thinkingStarted) {
                thinkingStarted = true
                yield { type: 'thinking_start' }
              }
              reasoningContent += delta.reasoning_content
              yield { type: 'thinking_delta', content: delta.reasoning_content! }
              continue
            }

            // 如果 reasoning_content 字段存在但为空值，说明 thinking 已结束
            if (delta.reasoning_content !== undefined && thinkingStarted) {
              yield { type: 'thinking_end' }
              thinkingStarted = false
            }

            // 文本内容 — 过滤 DeepSeek 的 "NULL" 占位
            const content = delta.content
            if (content && content !== 'NULL') {
              if (!textStarted) {
                // 思考结束（如果有）
                if (thinkingStarted) {
                  yield { type: 'thinking_end' }
                  thinkingStarted = false
                }
                textStarted = true
                yield { type: 'text_start' }
              }
              yield { type: 'text_delta', content: content! }
            }

            // Tool calls
            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index
                if (!toolCalls.has(idx)) {
                  toolCalls.set(idx, { id: tc.id ?? '', name: '', arguments: '' })
                  // 不在此处 yield tool_start，等 finish_reason 到后再吐出完整参数
                }
                const existing = toolCalls.get(idx)!
                if (tc.id) existing.id = tc.id
                if (tc.function?.name) existing.name = tc.function.name
                if (tc.function?.arguments) existing.arguments += tc.function.arguments
              }
            }

            // Usage（流式结束时可能有）
            if (chunk.usage) {
              yield {
                type: 'step_finish',
                usage: this.parseUsage(chunk.usage),
              }
            }

            // Finish reason
            const finishReason = chunk.choices?.[0]?.finish_reason
            if (finishReason) {
              if (thinkingStarted) {
                yield { type: 'thinking_end' }
                thinkingStarted = false
              }
              if (textStarted && finishReason !== 'tool_calls') {
                yield { type: 'text_end' }
              }
              // 如果是 tool_calls，yield 完整累积的 tool calls + reasoning_content
              if (finishReason === 'tool_calls' && toolCalls.size > 0) {
                for (const tc of toolCalls.values()) {
                  yield {
                    type: 'tool_start',
                    toolCall: {
                      id: tc.id,
                      name: tc.name,
                      arguments: safeParseJSON(tc.arguments),
                    },
                  }
                }
                // 把 reasoning_content 通过 step_finish 带给 agent-loop
                if (reasoningContent) {
                  yield { type: 'step_finish', content: reasoningContent }
                }
              }
            }
          } catch {
            // 忽略无法解析的行
          }
        }
      }
    } finally {
      reader.releaseLock()
    }
  }

  // ── 内部方法 ──

  private buildUrl(path: string): string {
    const base = this.modelConfig.baseUrl.replace(/\/+$/, '')
    return /\/v\d+$/.test(base) ? `${base}${path}` : `${base}/v1${path}`
  }

  private buildRequest(messages: Message[], tools: ToolDefinition[] | undefined, stream: boolean): Record<string, unknown> {
    const compat = this.modelConfig.compat
    const thinking = this.modelConfig.reasoning
    const req: Record<string, unknown> = {
      model: this.modelConfig.modelId,
      messages: this.toOpenAIMessages(messages),
      stream,
    }

    // max_tokens 字段名由 compat 决定
    if (this.modelConfig.maxTokens) {
      req[compat.maxTokensField] = this.modelConfig.maxTokens
    }

    // temperature — 思考模式下被忽略则不发送
    if (!(compat.temperatureIgnoredInThinking && thinking)) {
      req.temperature = 1
    }

    // Tools
    if (tools && tools.length > 0) {
      req.tools = tools.map(t => ({
        type: 'function' as const,
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }))
      req.tool_choice = 'auto'
    }

    // reasoning_effort
    if (compat.supportsReasoningEffort && thinking) {
      req.reasoning_effort = 'high'
    }

    // DeepSeek 特有：extra_body thinking toggle
    if (compat.extraBodyThinkingToggle && thinking) {
      req.extra_body = { thinking: { type: 'enabled' } }
    }

    return req
  }

  private toOpenAIMessages(messages: Message[]): unknown[] {
    const compat = this.modelConfig.compat
    return messages.map(m => {
      if (m.role === 'tool') {
        return {
          role: 'tool',
          tool_call_id: m.toolCallId,
          content: m.content,
        }
      }
      if (m.role === 'assistant') {
        const hasToolCalls = m.toolCalls && m.toolCalls.length > 0
        return {
          role: 'assistant',
          content: m.content || null,
          // 仅 DeepSeek 需要回传
          ...(compat.requiresReasoningContentPassthrough && m.reasoningContent
            ? { reasoning_content: m.reasoningContent }
            : {}),
          ...(hasToolCalls ? {
            tool_calls: m.toolCalls!.map(tc => ({
              id: tc.id,
              type: 'function',
              function: {
                name: tc.name,
                arguments: JSON.stringify(tc.arguments),
              },
            })),
          } : {}),
        }
      }
      return {
        role: m.role,
        content: m.content,
      }
    })
  }

  private async fetch(body: unknown): Promise<Response> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)

    try {
      const resp = await fetch(this.buildUrl('/chat/completions'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.modelConfig.apiKey}`,
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

    const toolCalls: ToolCall[] = rawToolCalls.map(tc => ({
      id: tc.id,
      name: tc.function.name,
      arguments: safeParseJSON(tc.function.arguments),
    }))

    return {
      content: choice.message.content ?? '',
      toolCalls,
      usage: this.parseUsage(data.usage),
      finishReason: choice.finish_reason as LLMResponse['finishReason'],
    }
  }

  private parseUsage(usage: OpenAIChatResponse['usage']): TokenUsage {
    return {
      promptTokens: usage.prompt_tokens,
      completionTokens: usage.completion_tokens,
      totalTokens: usage.total_tokens,
      cachedTokens: usage.prompt_tokens_details?.cached_tokens,
      reasoningTokens: usage.completion_tokens_details?.reasoning_tokens,
    }
  }

}

// ── 工具函数 ──

function safeParseJSON(raw: string): Record<string, unknown> {
  try { return JSON.parse(raw) } catch { /* continue */ }

  const fixes = ['}', '}]', '"}"]', '"]']
  for (const fix of fixes) {
    try { return JSON.parse(raw + fix) } catch { /* continue */ }
  }

  return {}
}
