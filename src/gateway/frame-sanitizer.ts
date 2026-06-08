import type { GatewayFrame } from "./types"
import { isRecord } from "../utils/guards"

export type SanitizeOptions = {
  maxTextHeadChars?: number
  maxTextTailChars?: number
  maxObjectDepth?: number
  maxArrayItems?: number
  maxTextLength?: number
}

type TruncationMarker = {
  __truncated: true
  length: number
  head: string
  tail: string
}

const TARGET_FIELDS = new Set([
  "args",
  "body",
  "content",
  "delta",
  "html",
  "input",
  "markdown",
  "message",
  "output",
  "pagecontent",
  "prompt",
  "result",
  "stderr",
  "stdout",
  "summary",
  "text",
])

const resolveOptions = (options?: SanitizeOptions): Required<SanitizeOptions> => ({
  maxTextHeadChars: options?.maxTextHeadChars ?? 256,
  maxTextTailChars: options?.maxTextTailChars ?? 2048,
  maxObjectDepth: options?.maxObjectDepth ?? 8,
  maxArrayItems: options?.maxArrayItems ?? 20,
  maxTextLength: options?.maxTextLength ?? 2048,
})

const maybeTruncateString = (
  value: string,
  key: string,
  opts: Required<SanitizeOptions>,
): string | TruncationMarker => {
  if (!TARGET_FIELDS.has(key.toLowerCase())) return value
  if (value.length <= opts.maxTextLength) return value
  return {
    __truncated: true,
    length: value.length,
    head: value.slice(0, opts.maxTextHeadChars),
    tail: value.slice(-opts.maxTextTailChars),
  }
}

const sanitizeAny = (
  value: unknown,
  parentKey: string | null,
  depth: number,
  opts: Required<SanitizeOptions>,
): unknown => {
  if (depth > opts.maxObjectDepth) {
    return { __depthLimitReached: true }
  }

  if (typeof value === "string") {
    if (parentKey !== null) {
      return maybeTruncateString(value, parentKey, opts)
    }
    return value
  }

  if (Array.isArray(value)) {
    const kept = value.slice(0, opts.maxArrayItems)
    const result: unknown[] = kept.map((item) => sanitizeAny(item, parentKey, depth, opts))
    if (value.length > opts.maxArrayItems) {
      result.push({ __omittedItems: value.length - opts.maxArrayItems })
    }
    return result
  }

  if (isRecord(value)) {
    const result: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      result[k] = sanitizeAny(v, k, depth + 1, opts)
    }
    return result
  }

  return value
}

export const sanitizeGatewayFrame = (frame: GatewayFrame, options?: SanitizeOptions): GatewayFrame => {
  const opts = resolveOptions(options)
  return sanitizeAny(frame, null, 0, opts) as GatewayFrame
}

export const sanitizeDiagnosticPayload = (value: unknown, options?: SanitizeOptions): unknown => {
  const opts = resolveOptions(options)
  return sanitizeAny(value, null, 0, opts)
}
