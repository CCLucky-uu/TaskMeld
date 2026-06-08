import { isRecord } from "../../utils/guards"
import { normalizeSchemaVersion, type ResultEnvelope } from "./contract"

const truncateText = (text: string, maxChars: number) =>
  text.length > maxChars ? `${text.slice(0, maxChars)}\n...[truncated]` : text

export const toPromptContentText = (content: unknown): string => {
  if (typeof content === "string") return truncateText(content, 8_000)
  try {
    return truncateText(JSON.stringify(content, null, 2), 8_000)
  } catch {
    return truncateText(String(content), 8_000)
  }
}

export const detectFenceLanguage = (content: string): "json" | "text" => {
  const trimmed = content.trim()
  if (!trimmed) return "text"
  try {
    JSON.parse(trimmed)
    return "json"
  } catch {
    return "text"
  }
}

const extractBalancedJsonObjectCandidates = (text: string): string[] => {
  const candidates: string[] = []
  const seen = new Set<string>()
  // Streaming output often has "explanatory text + JSON" concatenated in the same text segment.
  // Use bracket-balanced scanning to extract embedded JSON objects, avoiding direct JSON.parse failure on the whole segment.
  for (let start = text.indexOf("{"); start >= 0; start = text.indexOf("{", start + 1)) {
    let depth = 0
    let inString = false
    let escaped = false
    for (let i = start; i < text.length; i += 1) {
      const char = text[i]
      if (inString) {
        if (escaped) {
          escaped = false
          continue
        }
        if (char === "\\") {
          escaped = true
          continue
        }
        if (char === '"') {
          inString = false
        }
        continue
      }
      if (char === '"') {
        inString = true
        continue
      }
      if (char === "{") {
        depth += 1
        continue
      }
      if (char !== "}") continue
      depth -= 1
      if (depth !== 0) continue
      const candidate = text.slice(start, i + 1).trim()
      if (!candidate || seen.has(candidate)) break
      seen.add(candidate)
      candidates.push(candidate)
      break
    }
  }
  return candidates
}

const extractTextCandidates = (payload: unknown): string[] => {
  const texts: string[] = []
  const seen = new Set<string>()
  let nodesVisited = 0
  const walk = (value: unknown, depth: number) => {
    if (depth > 6) return
    nodesVisited += 1
    if (nodesVisited > 2_000) return
    if (typeof value === "string") {
      const trimmed = value.trim()
      if (trimmed && trimmed.length <= 60_000 && !seen.has(trimmed)) {
        seen.add(trimmed)
        texts.push(trimmed)
      }
      return
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1)
      return
    }
    if (!isRecord(value)) return
    for (const item of Object.values(value)) {
      walk(item, depth + 1)
    }
  }
  walk(payload, 0)
  return texts
}

const tryParseEnvelopeObject = (value: unknown): ResultEnvelope | null => {
  if (!isRecord(value)) return null
  if (value.version !== "2.0") return null
  if (value.status !== "success" && value.status !== "failed") return null
  if (!Array.isArray(value.artifacts)) return null
  if (typeof value.runId !== "string" || !value.runId) return null
  if (typeof value.nodeId !== "string" || !value.nodeId) return null
  if (typeof value.requestId !== "string" || !value.requestId) return null
  if (typeof value.sessionId !== "string" || !value.sessionId) return null
  for (const rawArtifact of value.artifacts) {
    if (!isRecord(rawArtifact)) continue
    const normalized = normalizeSchemaVersion(rawArtifact.schemaVersion)
    if (normalized !== null) {
      // Loosely correct at parse stage; subsequent processing uniformly uses number semantic validation and persistence.
      rawArtifact.schemaVersion = normalized
    }
  }
  return value as ResultEnvelope
}

const mayContainResultEnvelopeText = (text: string) =>
  text.includes('"version"') && text.includes('"requestId"') && text.includes('"artifacts"')

const tryParseEnvelopeText = (text: string): ResultEnvelope | null => {
  if (!mayContainResultEnvelopeText(text)) return null
  const ENVELOPE_TEXT_SCAN_TAIL_CHARS = 64_000
  let scanText = text
  if (text.length > ENVELOPE_TEXT_SCAN_TAIL_CHARS) {
    const headLen = text.length - ENVELOPE_TEXT_SCAN_TAIL_CHARS
    const headPart = text.slice(0, headLen)
    // Backtrack to the nearest { to prevent the JSON start from being cut off by the window
    const lastBrace = headPart.lastIndexOf("{")
    scanText = lastBrace >= 0 ? text.slice(lastBrace) : text.slice(-ENVELOPE_TEXT_SCAN_TAIL_CHARS)
  }
  const fenced = scanText.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced?.[1]?.trim() || scanText.trim()
  try {
    const parsed = JSON.parse(candidate)
    return tryParseEnvelopeObject(parsed)
  } catch {
    const embeddedCandidates = extractBalancedJsonObjectCandidates(candidate)
    for (const embedded of embeddedCandidates) {
      try {
        const parsed = JSON.parse(embedded)
        const envelope = tryParseEnvelopeObject(parsed)
        if (envelope) return envelope
      } catch {
        // Continue trying subsequent candidates
      }
    }
    return null
  }
}

export const collectEnvelopeCandidates = (payload: unknown): ResultEnvelope[] => {
  const envelopes: ResultEnvelope[] = []
  const seenKeys = new Set<string>()
  const pushEnvelope = (envelope: ResultEnvelope) => {
    const key = `${envelope.runId}|${envelope.nodeId}|${envelope.requestId}|${envelope.sessionId}|${envelope.status}|${envelope.artifacts.length}`
    if (seenKeys.has(key)) return
    seenKeys.add(key)
    envelopes.push(envelope)
  }

  const textCandidates = extractTextCandidates(payload)
  for (const text of textCandidates) {
    const parsed = tryParseEnvelopeText(text)
    if (parsed) pushEnvelope(parsed)
  }

  const walk = (value: unknown, depth: number) => {
    if (depth > 6) return
    const parsed = tryParseEnvelopeObject(value)
    if (parsed) {
      pushEnvelope(parsed)
      return
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1)
      return
    }
    if (!isRecord(value)) return
    for (const item of Object.values(value)) {
      walk(item, depth + 1)
    }
  }
  walk(payload, 0)
  return envelopes
}
