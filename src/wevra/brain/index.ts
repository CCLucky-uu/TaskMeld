import type { Message, ToolDefinition, LLMResponse, StreamEvent, RuntimeModelConfig, ThinkingConfig } from '../types'
import { createLLMClient, type LLMClient, type DebugCallback } from './llm-client'

export { type DebugCallback } from './llm-client'

export class Brain {
  private client: LLMClient

  constructor(modelConfig: RuntimeModelConfig, timeoutMs: number) {
    this.client = createLLMClient(modelConfig, timeoutMs)
  }

  updateModel(model: RuntimeModelConfig): void {
    this.client.updateModel(model)
  }

  setThinkingLevel(level: ThinkingConfig['level']): void {
    this.client.setThinkingLevel(level)
  }

  setDebugCallback(cb: DebugCallback | null): void {
    this.client.setDebugCallback(cb)
  }

  async chat(messages: Message[], tools?: ToolDefinition[]): Promise<LLMResponse> {
    return this.client.chat(messages, tools)
  }

  async *streamChat(messages: Message[], tools?: ToolDefinition[], signal?: AbortSignal): AsyncIterable<StreamEvent> {
    yield* this.client.streamChat(messages, tools, signal)
  }

  async summarize(messages: Message[]): Promise<string> {
    const response = await this.client.chat([
      { role: 'system', content: 'You are a conversation summarizer. Compress the following conversation into a concise summary, preserving key information, decisions, and pending tasks. Reply in English.' },
      { role: 'user', content: formatMessages(messages) },
    ])
    return response.content
  }
}

function formatMessages(messages: Message[]): string {
  return messages
    .filter(m => m.role !== 'system')
    .map(m => `[${m.role}] ${m.content}`)
    .join('\n')
}
