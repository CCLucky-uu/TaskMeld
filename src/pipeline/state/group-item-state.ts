import { transitionStatus } from "../state-machine";
import type { GroupItemRun, NodeItemRunStatus } from "../runtime-model";
import type { StateTransitionContext } from "./types";

const now = (ctx: StateTransitionContext) => ctx.now ?? new Date().toISOString();

export const markGroupItemQueued = (item: GroupItemRun, ctx: StateTransitionContext) => {
  item.status = transitionStatus(item.status, "queued", ctx.command);
};

export const markGroupItemRunning = (item: GroupItemRun, ctx: StateTransitionContext) => {
  item.status = transitionStatus(item.status, "running", ctx.command);
  item.attempt += 1;
  item.startedAt = now(ctx);
  item.finishedAt = null;
  item.lastError = null;
};

export const markGroupItemSuccess = (item: GroupItemRun, ctx: StateTransitionContext) => {
  item.status = transitionStatus(item.status, "success", ctx.command);
  item.finishedAt = now(ctx);
  item.lastError = null;
};

export const markGroupItemFailed = (item: GroupItemRun, ctx: StateTransitionContext) => {
  item.status = transitionStatus(item.status, "failed", ctx.command);
  item.finishedAt = now(ctx);
  item.lastError = ctx.error ?? null;
};

export const markGroupItemSkipped = (item: GroupItemRun, ctx: StateTransitionContext) => {
  item.status = transitionStatus(item.status, "skipped", ctx.command);
  item.finishedAt = now(ctx);
  item.lastError = null;
};

export const markGroupItemBlocked = (item: GroupItemRun, ctx: StateTransitionContext) => {
  item.status = transitionStatus(item.status, "blocked", ctx.command);
};

export const markGroupItemWaiting = (item: GroupItemRun, ctx: StateTransitionContext) => {
  item.status = transitionStatus(item.status, "waiting", ctx.command);
};

export const markGroupItemReset = (item: GroupItemRun, targetStatus: NodeItemRunStatus, ctx: StateTransitionContext) => {
  item.status = transitionStatus(item.status, targetStatus, ctx.command);
  item.startedAt = null;
  item.finishedAt = targetStatus === "skipped" ? now(ctx) : null;
  item.lastError = null;
};
