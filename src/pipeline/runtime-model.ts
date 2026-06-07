import { randomUUID } from "node:crypto"
import type { PipelineTemplateNode } from "./template"
import type { NodeExecutor, OutputSpec } from "./template"
import { buildRunId } from "./identity"
import type { RunInput } from "./types/pipeline-link"
import type { PipelineOutput } from "./types/pipeline-output"

export type TimelineItem = {
  id: string
  ts: string
  createdAt: string
  text: string
  level: "info" | "warn" | "error"
  detail?: unknown
}

export type NodeRunStatus =
  | "queued"
  | "running"
  | "success"
  | "failed"
  | "blocked"
  | "rejected"
  | "waiting"
  | "skipped"
  | "stopped"
export type NodeItemRunStatus = NodeRunStatus
export type RunStatus = "running" | "success" | "failed" | "stopped"

export type ArtifactManifest = {
  id: string
  type: string
  schemaVersion: number
  name: string
  path: string
  hash: string
  sourceNodeId: string
  createdAt: string
}

export type NodeRun = {
  id: string
  title: string
  executor: NodeExecutor
  instruction: string
  outputSpec: OutputSpec
  allowReject: boolean
  maxRejectCount: number
  status: NodeRunStatus
  dependsOn: string[]
  artifacts: ArtifactManifest[]
  rejectFeedbacks: string[]
  attempt: number
  rejectCount: number
  startedAt: string | null
  finishedAt: string | null
  lastError: string | null
}

export type NodeItemRun = {
  id: string
  itemKey: string
  nodeId: string
  status: NodeItemRunStatus
  route: string | null
  attempt: number
  loopCount: number
  wakeAt: string | null
  startedAt: string | null
  finishedAt: string | null
  lastError: string | null
  artifacts: ArtifactManifest[]
}

export type GroupRun = {
  id: string
  title: string
  status: NodeRunStatus
  members: string[]
  joinPolicy: "all"
  artifacts: ArtifactManifest[]
  startedAt: string | null
  finishedAt: string | null
  lastError: string | null
}

export type GroupItemRun = {
  id: string
  groupId: string
  itemKey: string
  status: NodeItemRunStatus
  attempt: number
  startedAt: string | null
  finishedAt: string | null
  lastError: string | null
  artifacts: ArtifactManifest[]
}

export type Run = {
  id: string
  status: RunStatus
  createdAt: string
  updatedAt: string
  input?: RunInput
  nodes: NodeRun[]
  itemRuns?: NodeItemRun[]
  groups?: GroupRun[]
  groupItemRuns?: GroupItemRun[]
  output?: PipelineOutput | null
}

export { pickArray } from "../utils/array"
export { normalizeSession, type NormalizedSession } from "../utils/session"

const NODE_STATUS_PRIORITY: Record<NodeRunStatus, number> = {
  failed: 100,
  running: 90,
  rejected: 80,
  waiting: 70,
  queued: 60,
  blocked: 50,
  success: 40,
  skipped: 30,
  stopped: 20,
}

export const aggregateNodeStatusFromItemRuns = (itemRuns: NodeItemRun[]): NodeRunStatus => {
  if (itemRuns.length === 0) return "blocked"
  let best: NodeRunStatus = itemRuns[0].status
  for (const item of itemRuns) {
    if (NODE_STATUS_PRIORITY[item.status] > NODE_STATUS_PRIORITY[best]) {
      best = item.status
    }
  }
  return best
}

export const syncRunNodeStatusFromItemRuns = (run: Run) => {
  const itemRuns = run.itemRuns ?? []
  if (itemRuns.length === 0) return

  const itemsByNodeId = new Map<string, NodeItemRun[]>()
  for (const item of itemRuns) {
    const current = itemsByNodeId.get(item.nodeId) ?? []
    current.push(item)
    itemsByNodeId.set(item.nodeId, current)
  }

  for (const node of run.nodes) {
    const related = itemsByNodeId.get(node.id)
    if (!related || related.length === 0) continue
    node.status = aggregateNodeStatusFromItemRuns(related)
  }
}

export const createNodeItemRun = (nodeId: string, itemKey: string, initialStatus: NodeItemRunStatus): NodeItemRun => ({
  id: randomUUID(),
  nodeId,
  itemKey,
  status: initialStatus,
  route: null,
  attempt: 0,
  loopCount: 0,
  wakeAt: null,
  startedAt: null,
  finishedAt: null,
  lastError: null,
  artifacts: [],
})

export const createGroupItemRun = (
  groupId: string,
  itemKey: string,
  initialStatus: NodeItemRunStatus,
): GroupItemRun => ({
  id: randomUUID(),
  groupId,
  itemKey,
  status: initialStatus,
  attempt: 0,
  startedAt: null,
  finishedAt: null,
  lastError: null,
  artifacts: [],
})

export const seedNodeItemRuns = (templateNodes: PipelineTemplateNode[], itemKeys: string[]): NodeItemRun[] => {
  const uniqueItemKeys = [...new Set(itemKeys.map((item) => item.trim()).filter(Boolean))]
  if (uniqueItemKeys.length === 0) return []

  const itemRuns: NodeItemRun[] = []
  for (const node of templateNodes) {
    const initialStatus: NodeItemRunStatus = node.dependsOn.length > 0 ? "blocked" : "queued"
    for (const itemKey of uniqueItemKeys) {
      itemRuns.push(createNodeItemRun(node.id, itemKey, initialStatus))
    }
  }
  return itemRuns
}

export const computeRunStatus = (run: Run): RunStatus => {
  if (run.nodes.some((node) => node.status === "failed")) return "failed"
  if ((run.groups ?? []).some((group) => group.status === "failed")) return "failed"
  if (run.nodes.some((node) => node.status === "stopped")) return "stopped"
  if ((run.groups ?? []).some((group) => group.status === "stopped")) return "stopped"
  if (
    run.nodes.every((node) => node.status === "success" || node.status === "skipped") &&
    (run.groups ?? []).every((group) => group.status === "success" || group.status === "skipped")
  ) {
    return "success"
  }
  return "running"
}

export const touchRun = (run: Run) => {
  run.updatedAt = new Date().toISOString()
  run.status = computeRunStatus(run)
}

export const seedRun = (templateNodes: PipelineTemplateNode[]): Run => {
  const now = new Date().toISOString()
  const run: Run = {
    id: buildRunId(),
    status: "running",
    createdAt: now,
    updatedAt: now,
    input: { trigger: "manual" },
    nodes: templateNodes.map((tpl) => ({
      id: tpl.id,
      title: tpl.title,
      executor: tpl.executor,
      instruction: tpl.instruction,
      outputSpec: tpl.outputSpec,
      allowReject: tpl.allowReject,
      maxRejectCount: tpl.maxRejectCount,
      status: tpl.dependsOn.length > 0 ? "blocked" : "queued",
      dependsOn: tpl.dependsOn,
      artifacts: [],
      rejectFeedbacks: [],
      attempt: 0,
      rejectCount: 0,
      startedAt: null,
      finishedAt: null,
      lastError: null,
    })),
    itemRuns: [],
    groups: [],
    groupItemRuns: [],
    output: null,
  }
  touchRun(run)
  return run
}

export const seedRunWithItems = (templateNodes: PipelineTemplateNode[], itemKeys: string[]): Run => {
  const run = seedRun(templateNodes)
  run.itemRuns = seedNodeItemRuns(templateNodes, itemKeys)
  touchRun(run)
  return run
}

export const addTimeline = (
  timeline: TimelineItem[],
  text: string,
  level: TimelineItem["level"] = "info",
  detail?: unknown,
  maxTimeline = 200,
) => {
  const item: TimelineItem = {
    id: randomUUID(),
    ts: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
    createdAt: new Date().toISOString(),
    text,
    level,
    ...(detail === undefined ? {} : { detail }),
  }
  timeline.unshift(item)
  if (timeline.length > maxTimeline) {
    timeline.length = maxTimeline
  }
  return item
}

export { parseAgentSessionMapFromEnv, inferSessionAgentIds } from "../utils/session"
