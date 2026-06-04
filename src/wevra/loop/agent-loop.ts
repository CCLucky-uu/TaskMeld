import type { Message, ToolCall, StreamEvent, LoopResult, ToolContext } from '../types'
import type { Brain, DebugCallback } from '../brain'
import type { ToolExecutor } from '../tools/executor'
import type { ToolRegistry } from '../tools/registry'
import type { SkillRegistry } from '../skills'
import type { WevraMemory } from '../memory'
import type { SessionData } from '../conversation'
import type { WevraConfig } from '../config'
import { generateMessageId } from '../util'

export interface LoopCallbacks {
  onStream?: (event: StreamEvent) => void
  onDebug?: (payload: unknown) => void
  /** 消息写入回调 — 循环中每产生 assistant/tool 消息时调用 */
  onMessage?: (message: Message) => Promise<void>
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

  async run(fullHistory: Message[], session: SessionData, callbacks?: LoopCallbacks): Promise<LoopResult> {
    if (!this.brain) return { type: 'error', content: 'No LLM model configured', iterations: 0 }

    const allTools = session.frozenTools
    let iterations = 0

    while (iterations < this.config.maxIterations) {
      iterations++

      // 构建请求消息：frozen prompt + 完整历史
      const requestMessages: Message[] = [
        { role: 'system', content: session.frozenPrompt },
        ...fullHistory,
      ]

      // LLM 推理（流式）
      let assistantContent = ''
      const toolCalls: ToolCall[] = []
      let reasoningContent = ''  // DeepSeek reasoning_content 需要回传

      for await (const event of this.brain.streamChat(requestMessages, allTools)) {
        callbacks?.onStream?.(event)

        switch (event.type) {
          case 'text_delta':
            assistantContent += event.content ?? ''
            break
          case 'tool_start':
            if (event.toolCall) toolCalls.push(event.toolCall)
            break
          case 'step_finish':
            if (event.content) reasoningContent = event.content
            break
        }
      }

      // 追加 assistant 消息
      const assistantMsg: Message = {
        role: 'assistant',
        content: assistantContent,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        reasoningContent: reasoningContent || undefined,
      }
      fullHistory.push(assistantMsg)
      await callbacks?.onMessage?.(assistantMsg)

      // 无 tool calls → 结束
      if (toolCalls.length === 0) {
        return {
          type: 'text',
          content: assistantContent,
          iterations,
        }
      }

      // 执行 tool calls
      const toolCtx = this.buildToolContext(session.id)
      const results = await this.executor.executeAll(toolCalls, toolCtx)

      // 追加 tool results
      for (let i = 0; i < toolCalls.length; i++) {
        const toolMsg: Message = {
          role: 'tool',
          toolCallId: toolCalls[i].id,
          content: results[i].output,
          isError: results[i].isError,
        }
        fullHistory.push(toolMsg)
        await callbacks?.onMessage?.(toolMsg)

        callbacks?.onStream?.({
          type: 'tool_delta',
          content: results[i].output,
          toolResult: { ...results[i], toolCallId: toolCalls[i].id },
        })
      }

      // 循环回到顶部重新从磁盘加载最新历史
      // （fullHistory 已在内存中更新，无需重新加载）
    }

    return {
      type: 'max_iterations',
      content: 'Reached maximum iterations.',
      iterations,
    }
  }

  private buildToolContext(sessionId: string): ToolContext {
    return {
      sessionId,
      messageId: generateMessageId(),
      abortSignal: AbortSignal.timeout(this.config.toolTimeoutMs),
      requestPermission: async () => true, // Phase 1: 全部放行
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
