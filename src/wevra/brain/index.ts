import type { Message, ToolDefinition, LLMResponse, StreamEvent, RuntimeModelConfig } from '../types'
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

  setDebugCallback(cb: DebugCallback | null): void {
    this.client.setDebugCallback(cb)
  }

  async chat(messages: Message[], tools?: ToolDefinition[]): Promise<LLMResponse> {
    return this.client.chat(messages, tools)
  }

  async *streamChat(messages: Message[], tools?: ToolDefinition[]): AsyncIterable<StreamEvent> {
    yield* this.client.streamChat(messages, tools)
  }

  async summarize(messages: Message[]): Promise<string> {
    const response = await this.client.chat([
      { role: 'system', content: '你是一个对话摘要助手。将以下对话压缩为简洁的摘要，保留关键信息、决策和未完成的任务。用中文回复。' },
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
