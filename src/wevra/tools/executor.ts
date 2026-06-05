import type { ToolCall, ToolResult, ToolContext, ToolPreferences } from '../types'
import { DEFAULT_TOOL_PREFERENCES } from '../types'
import type { ToolRegistry } from './registry'
import type { WevraConfig } from '../config'
import { truncateOutput } from './result'
import { resolvePermission } from '../preferences'

export class ToolExecutor {
  constructor(
    private registry: ToolRegistry,
    private config: WevraConfig,
  ) {}

  async execute(call: ToolCall, ctx: ToolContext): Promise<ToolResult> {
    const tool = this.registry.get(call.name)

    // Step 1: 查找
    if (!tool) {
      const available = Array.from(this.registry['tools'].keys()).join(', ')
      return {
        output: `Error: Unknown tool "${call.name}". Available tools: ${available}`,
        isError: true,
      }
    }

    // Step 2: 校验
    if (tool.validate) {
      const result = tool.validate(call.arguments)
      if (!result.valid) {
        return {
          output: `Invalid arguments for "${call.name}": ${result.error}. Please correct and retry.`,
          isError: true,
        }
      }
    }

    // Guard against stale __parseError objects from failed JSON parse
    if (call.arguments && ('__parseError' in call.arguments)) {
      return {
        output: `Invalid arguments for "${call.name}": failed to parse JSON arguments.`,
        isError: true,
      }
    }

    // Step 3: permission
    const prefs = ctx.preferences ?? DEFAULT_TOOL_PREFERENCES
    const result = resolvePermission(call.name, tool.annotations, prefs)
    console.log(`[wevra:perm] tool=${call.name} mode=${prefs.mode} readOnly=${tool.annotations.readOnly} destructive=${tool.annotations.destructive} requiresConfirm=${tool.annotations.requiresConfirmation} → ${result.decision}`)
    if (result.decision === 'deny') {
      return {
        output: result.reason!,
        isError: true,
      }
    }
    if (result.decision === 'confirm') {
      return {
        output: `Confirmation required for "${call.name}".`,
        isError: false,
        needsConfirmation: true,
      }
    }

    // Step 4: 执行（带超时 + AbortSignal）
    const controller = new AbortController()
    // 将传入的 abortSignal 链接到新 controller
    ctx.abortSignal.addEventListener('abort', () => controller.abort(), { once: true })

    try {
      const result = await this.withTimeout(
        tool.execute(call.arguments, { ...ctx, abortSignal: controller.signal }),
        this.config.toolTimeoutMs,
        controller,
      )

      // Step 5: 截断
      return {
        ...result,
        output: truncateOutput(result.output, this.config.maxToolOutputChars),
      }
    } catch (err) {
      return {
        output: `Tool "${call.name}" execution failed: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      }
    }
  }

  async executeAll(calls: ToolCall[], ctx: ToolContext): Promise<ToolResult[]> {
    return Promise.all(calls.map(call => this.execute(call, ctx)))
  }

  private withTimeout<T>(promise: Promise<T>, ms: number, controller: AbortController): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { controller.abort(); reject(new Error(`Tool execution timed out after ${ms}ms`)) }, ms)
      promise.then(
        val => { clearTimeout(timer); resolve(val) },
        err => { clearTimeout(timer); reject(err) },
      )
    })
  }
}
