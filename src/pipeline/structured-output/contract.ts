import type { OutputSpec } from "../template"

type JsonValue = string | number | boolean | null | { [key: string]: JsonValue } | JsonValue[]

export type ResultArtifact = {
  type: string
  schemaVersion: number
  name?: string
  content: JsonValue
  meta?: Record<string, unknown>
}

export type ResultEnvelope = {
  version: "2.0"
  runId: string
  nodeId: string
  requestId: string
  sessionId: string
  status: "success" | "failed"
  artifacts: ResultArtifact[]
  control?: {
    sleepUntil?: string | null
    retryFromNodeId?: string | null
  }
  logs?: string[]
  error?: unknown
}

export type ContractViolationCode =
  | "result_envelope_missing"
  | "run_id_mismatch"
  | "node_id_mismatch"
  | "request_id_mismatch"
  | "session_id_mismatch"
  | "artifacts_invalid"
  | "artifacts_required"
  | "artifact_invalid"
  | "artifact_type_invalid"
  | "artifact_schema_invalid"
  | "artifact_content_invalid"
  | "artifact_spec_mismatch"
  | "route_invalid"
  | "route_content_invalid"
  | "hold_control_invalid"

export type ObservedEnvelope = {
  envelope: ResultEnvelope
  observedAt: number
  source: string
}

export type DependencyArtifactInput = {
  sourceNodeId: string
  sourceNodeTitle: string
  sourceAgentId: string
  type: string
  schemaVersion: number
  name: string
  path: string
  hash: string
  createdAt: string
  content: string
  meta?: Record<string, unknown>
}

export type ExternalPipelineArtifactInput = {
  sourceKind: "pipeline_output"
  sourcePipelineId: string
  sourceRunId: string
  sourceBatchRunId: string | null
  sourceOutputId: string
  sourceOutputNodeId: string
  sourceArtifactId: string
  sourceArtifactHash: string
  type: string
  schemaVersion: number
  name: string
  path: string
  createdAt: string
  content: string
  meta?: Record<string, unknown>
}

export type EnvelopeValidationContext = {
  runId: string
  nodeId: string
  requestId: string
  sessionId: string
  outputSpec: OutputSpec
  allowedRoutes?: string[]
  requireRouteContent?: boolean
}

import { isRecord } from "../../utils/guards"
export { isRecord }

export const normalizeSchemaVersion = (value: unknown): number | null => {
  if (typeof value === "number") {
    if (Number.isFinite(value) && Number.isSafeInteger(value)) return value
    return null
  }
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  // Accommodate models that output schemaVersion as a numeric string (e.g. "1").
  if (!/^\d+$/.test(trimmed)) return null
  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed) || !Number.isSafeInteger(parsed)) return null
  return parsed
}

export const normalizeAllowedRoute = (rawRoute: unknown, allowedRoutes?: string[]): string | null => {
  if (typeof rawRoute !== "string") return null
  const trimmed = rawRoute.trim()
  if (!trimmed) return null
  if (!allowedRoutes || allowedRoutes.length === 0) return trimmed
  const direct = allowedRoutes.find((route) => route === trimmed)
  if (direct) return direct
  const lower = trimmed.toLowerCase()
  // Allow case-insensitive matches, normalizing to the declared workflow route to avoid pointless failures.
  const insensitive = allowedRoutes.find((route) => route.toLowerCase() === lower)
  return insensitive ?? null
}

const isJsonValue = (value: unknown, depth = 0): value is JsonValue => {
  if (depth > 20) return false
  if (value === null) return true
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return true
  if (Array.isArray(value)) {
    return value.every((item) => isJsonValue(item, depth + 1))
  }
  if (!isRecord(value)) return false
  return Object.values(value).every((item) => isJsonValue(item, depth + 1))
}

const isEmptyArtifactContent = (value: JsonValue): boolean => {
  if (value === null) return true
  if (typeof value === "string") return value.trim().length === 0
  if (typeof value === "number" || typeof value === "boolean") return false
  if (Array.isArray(value)) return value.length === 0 || value.every((item) => isEmptyArtifactContent(item))
  const entries = Object.values(value)
  return entries.length === 0 || entries.every((item) => isEmptyArtifactContent(item))
}

export const validateEnvelope = (
  envelope: ResultEnvelope,
  ctx: EnvelopeValidationContext,
): { ok: true } | { ok: false; code: ContractViolationCode } => {
  if (envelope.runId !== ctx.runId) return { ok: false, code: "run_id_mismatch" }
  if (envelope.nodeId !== ctx.nodeId) return { ok: false, code: "node_id_mismatch" }
  if (envelope.requestId !== ctx.requestId) return { ok: false, code: "request_id_mismatch" }
  if (envelope.sessionId !== ctx.sessionId) return { ok: false, code: "session_id_mismatch" }
  if (!Array.isArray(envelope.artifacts)) return { ok: false, code: "artifacts_invalid" }
  if (envelope.status === "success" && envelope.artifacts.length === 0) {
    return { ok: false, code: "artifacts_required" }
  }
  const spec = ctx.outputSpec
  for (const artifact of envelope.artifacts) {
    if (!isRecord(artifact)) return { ok: false, code: "artifact_invalid" }
    if (typeof artifact.type !== "string" || !artifact.type) return { ok: false, code: "artifact_type_invalid" }
    const normalizedSchemaVersion = normalizeSchemaVersion(artifact.schemaVersion)
    if (normalizedSchemaVersion === null) return { ok: false, code: "artifact_schema_invalid" }
    artifact.schemaVersion = normalizedSchemaVersion
    if (!isJsonValue(artifact.content)) return { ok: false, code: "artifact_content_invalid" }
    if (envelope.status === "success" && isEmptyArtifactContent(artifact.content))
      return { ok: false, code: "artifact_content_invalid" }
    if (artifact.type !== spec.type || artifact.schemaVersion !== spec.schemaVersion) {
      return { ok: false, code: "artifact_spec_mismatch" }
    }
  }

  // Backward-compat with legacy/redundant fields: top-level route and decisions are no longer hard-failure conditions — simply ignore.
  if (envelope.control !== undefined) {
    if (!isRecord(envelope.control)) return { ok: false, code: "hold_control_invalid" }
    const sleepUntil = envelope.control.sleepUntil
    if (sleepUntil !== undefined && sleepUntil !== null) {
      if (typeof sleepUntil !== "string" || !sleepUntil.trim() || !Number.isFinite(Date.parse(sleepUntil))) {
        return { ok: false, code: "hold_control_invalid" }
      }
    }
  }
  if (ctx.requireRouteContent && envelope.status === "success") {
    const primaryArtifact = envelope.artifacts[0]
    if (!primaryArtifact) {
      return { ok: false, code: "route_content_invalid" }
    }
    if (!Array.isArray(primaryArtifact.content) && isRecord(primaryArtifact.content)) {
      // Accommodate single-object output by normalizing to an array so downstream routing logic stays consistent.
      primaryArtifact.content = [primaryArtifact.content]
    }
    if (!Array.isArray(primaryArtifact.content) || primaryArtifact.content.length === 0) {
      return { ok: false, code: "route_content_invalid" }
    }
    for (const entry of primaryArtifact.content) {
      if (!isRecord(entry)) return { ok: false, code: "route_content_invalid" }
      const route = normalizeAllowedRoute(entry.route, ctx.allowedRoutes)
      if (!route) return { ok: false, code: "route_content_invalid" }
      entry.route = route
    }
  }
  return { ok: true }
}
