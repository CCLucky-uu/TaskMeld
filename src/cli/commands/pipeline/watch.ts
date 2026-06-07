import { CliError } from "../../errors"
import type { CliCommandHandler } from "../../types"
import { throwSelectorScopedError } from "./errors"
import { describePipelineSelector, getPipelineStatusBySelector } from "./selector"
import type { PipelineRunSelector, PipelineStatusPayload } from "./types"

const readFlagAsPositiveInteger = (value: string | boolean | undefined, fallback: number): number => {
  if (typeof value !== "string") return fallback
  const parsed = Number.parseInt(value.trim(), 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return parsed
}

const delay = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

const isTerminalStatus = (statusPayload: PipelineStatusPayload): boolean => {
  if (statusPayload.ok === true && statusPayload.running === false) return true
  const status = statusPayload.status
  if (!status) return false
  if (status.running === false) return true
  const runStatus = String(status.runStatus ?? "")
  if (runStatus === "success" || runStatus === "failed" || runStatus === "stopped") return true
  const batchStatus = String(status.batchRun?.status ?? "")
  return batchStatus === "completed" || batchStatus === "failed" || batchStatus === "stopped"
}

export const watchPipelineUntilTerminal = async (
  ctx: Parameters<CliCommandHandler>[1],
  selector: PipelineRunSelector,
  timeoutFlag: string | boolean | undefined,
  intervalFlag: string | boolean | undefined,
): Promise<unknown> => {
  const timeoutMs = readFlagAsPositiveInteger(timeoutFlag, 10 * 60 * 1000)
  const intervalMs = readFlagAsPositiveInteger(intervalFlag, 1200)
  const startAt = Date.now()
  const selectorLabel = describePipelineSelector(selector)
  let wsSignalAvailable = typeof ctx.app.pipelineService.waitForPipelineWatchSignal === "function"
  while (true) {
    const statusResult = await getPipelineStatusBySelector(ctx, selector)
    if (statusResult.ok === false) {
      throwSelectorScopedError(statusResult, selector)
    }
    if (isTerminalStatus(statusResult)) {
      return statusResult
    }
    if (Date.now() - startAt > timeoutMs) {
      throw new CliError(`Pipeline watch timed out: ${selectorLabel}`, {
        code: "PIPELINE_WATCH_TIMEOUT",
        exitCode: 4,
        details: { ...selector, timeoutMs },
      })
    }
    if (wsSignalAvailable) {
      try {
        // The daemon-first path prioritizes triggering the next status check via WS events to reduce unnecessary polling;
        // when the event link flaps, auto-degrade to interval polling so the watch isn't directly interrupted by a failed subscription.
        await ctx.app.pipelineService.waitForPipelineWatchSignal?.(
          selector,
          Math.max(1, Math.min(intervalMs, timeoutMs - (Date.now() - startAt))),
        )
        continue
      } catch {
        wsSignalAvailable = false
      }
    }
    await delay(intervalMs)
  }
}
