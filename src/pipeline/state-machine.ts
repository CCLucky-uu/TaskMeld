import type { NodeRunStatus } from "./runtime-model"
import type { StateTransitionCommand } from "./state/types"

/**
 * Legal state transitions for pipeline node/item/group status.
 *
 * Self-transitions (current === next) are always allowed and returned
 * without validation.
 *
 * Transitions are now gated by StateTransitionCommand:
 * - "execute": normal execution flow only
 * - "dependency": scheduler marking ready/waiting/skipped/blocked
 * - "sleep": sleepUntil wakeup
 * - "retry_reset": retry reset
 * - "reject_reset": reject cascade reset
 * - "route_backfill": route initialization (copy ancestor state)
 * - "group_aggregate": parallel group member aggregation
 *
 * Key restrictions:
 * - failed/rejected -> success is ONLY allowed via route_backfill
 * - blocked -> running/success/failed/rejected is ONLY allowed via route_backfill
 * - Normal execute path: queued -> running -> success|failed|rejected
 */

type TransitionRules = Record<NodeRunStatus, Partial<Record<StateTransitionCommand, NodeRunStatus[]>>>

export const VALID_TRANSITIONS: TransitionRules = {
  queued: {
    execute: ["running", "failed"],
    dependency: ["waiting", "blocked", "skipped"],
    group_aggregate: ["running", "failed", "waiting", "blocked", "skipped"],
    retry_reset: ["queued"],
    reject_reset: ["queued"],
    route_backfill: ["running", "success", "failed", "rejected", "waiting", "skipped", "blocked"],
  },

  running: {
    execute: ["success", "failed", "rejected", "waiting"],
    group_aggregate: ["success", "failed", "rejected", "waiting", "queued", "blocked", "skipped"],
    retry_reset: ["queued", "blocked", "skipped"],
    reject_reset: ["queued", "blocked", "skipped"],
  },

  waiting: {
    sleep: ["success"],
    dependency: ["queued", "skipped", "blocked"],
    group_aggregate: ["success", "queued", "skipped", "blocked"],
    retry_reset: ["queued"],
    reject_reset: ["queued"],
  },

  blocked: {
    dependency: ["queued", "waiting", "skipped"],
    group_aggregate: ["running", "success", "failed", "rejected", "queued", "waiting", "blocked"],
    route_backfill: ["running", "success", "failed", "rejected", "skipped", "queued", "waiting", "blocked"],
    retry_reset: ["queued", "skipped"],
    reject_reset: ["queued", "skipped"],
  },

  success: {
    sleep: ["waiting"],
    dependency: ["queued", "blocked", "skipped"],
    group_aggregate: ["queued", "blocked", "skipped", "waiting"],
    retry_reset: ["queued", "blocked", "skipped"],
    reject_reset: ["queued", "blocked", "skipped"],
    route_backfill: ["success", "running", "failed", "rejected", "queued", "blocked", "skipped", "waiting"],
  },

  failed: {
    dependency: ["queued", "blocked", "skipped"],
    group_aggregate: ["queued", "blocked", "skipped"],
    retry_reset: ["queued", "blocked", "running"],
    reject_reset: ["queued", "blocked"],
    sleep: ["waiting"],
    route_backfill: ["success"],
  },

  rejected: {
    dependency: ["queued", "blocked", "skipped"],
    group_aggregate: ["queued", "blocked", "skipped"],
    retry_reset: ["queued", "blocked"],
    reject_reset: ["queued", "blocked"],
    sleep: ["waiting"],
    route_backfill: ["success"],
  },

  skipped: {
    dependency: ["queued", "blocked"],
    group_aggregate: ["queued", "blocked"],
    retry_reset: ["queued", "blocked"],
    route_backfill: ["running", "success", "failed", "rejected", "queued", "blocked", "skipped", "waiting"],
  },

  stopped: {
    retry_reset: ["queued", "blocked", "skipped"],
    reject_reset: ["queued", "blocked", "skipped"],
  },
}

export class IllegalStateTransitionError extends Error {
  public readonly current: NodeRunStatus
  public readonly next: NodeRunStatus
  public readonly command?: StateTransitionCommand

  constructor(current: NodeRunStatus, next: NodeRunStatus, command?: StateTransitionCommand) {
    const cmdInfo = command ? ` (command: ${command})` : ""
    super(`Illegal state transition: "${current}" -> "${next}"${cmdInfo}`)
    this.name = "IllegalStateTransitionError"
    this.current = current
    this.next = next
    this.command = command
  }
}

export const transitionStatus = (
  current: NodeRunStatus,
  next: NodeRunStatus,
  command?: StateTransitionCommand,
): NodeRunStatus => {
  if (current === next) return current
  const allowedByCommand = VALID_TRANSITIONS[current]
  // When no command is specified, only execute + dependency permissions are allowed (safe default),
  // special permissions (route_backfill/retry_reset/reject_reset/sleep/group_aggregate) require an explicit command.
  const allowed = command
    ? (allowedByCommand[command] ?? [])
    : [...new Set([...(allowedByCommand["execute"] ?? []), ...(allowedByCommand["dependency"] ?? [])])]
  if (!allowed.includes(next)) {
    throw new IllegalStateTransitionError(current, next, command)
  }
  return next
}
