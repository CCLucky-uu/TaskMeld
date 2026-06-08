import { transitionStatus } from "../state-machine"
import type { GroupRun, NodeRunStatus } from "../runtime-model"
import type { StateTransitionContext } from "./types"

const now = (ctx: StateTransitionContext) => ctx.now ?? new Date().toISOString()

export const markGroupQueued = (group: GroupRun, ctx: StateTransitionContext) => {
  group.status = transitionStatus(group.status, "queued", ctx.command)
}

export const markGroupRunning = (group: GroupRun, ctx: StateTransitionContext) => {
  group.status = transitionStatus(group.status, "running", ctx.command)
  group.startedAt = now(ctx)
}

export const markGroupSuccess = (group: GroupRun, ctx: StateTransitionContext) => {
  group.status = transitionStatus(group.status, "success", ctx.command)
  group.finishedAt = now(ctx)
  group.lastError = null
}

export const markGroupFailed = (group: GroupRun, ctx: StateTransitionContext) => {
  group.status = transitionStatus(group.status, "failed", ctx.command)
  group.finishedAt = now(ctx)
  group.lastError = ctx.error ?? null
}

export const markGroupBlocked = (group: GroupRun, ctx: StateTransitionContext) => {
  group.status = transitionStatus(group.status, "blocked", ctx.command)
}

export const markGroupWaiting = (group: GroupRun, ctx: StateTransitionContext) => {
  group.status = transitionStatus(group.status, "waiting", ctx.command)
}

export const markGroupReset = (group: GroupRun, targetStatus: NodeRunStatus, ctx: StateTransitionContext) => {
  group.status = transitionStatus(group.status, targetStatus, ctx.command)
  group.startedAt = null
  group.finishedAt = null
  group.lastError = null
}
