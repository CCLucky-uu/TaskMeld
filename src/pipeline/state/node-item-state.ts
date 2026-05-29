import { transitionStatus } from "../state-machine";
import type { NodeItemRun, NodeItemRunStatus } from "../runtime-model";
import type { StateTransitionContext } from "./types";

const now = (ctx: StateTransitionContext) => ctx.now ?? new Date().toISOString();

export const markItemQueued = (item: NodeItemRun, ctx: StateTransitionContext) => {
  item.status = transitionStatus(item.status, "queued", ctx.command);
};

export const markItemRunning = (item: NodeItemRun, ctx: StateTransitionContext) => {
  item.status = transitionStatus(item.status, "running", ctx.command);
  item.attempt += 1;
  item.startedAt = now(ctx);
  item.finishedAt = null;
  item.lastError = null;
  item.wakeAt = null;
};

export const markItemSuccess = (item: NodeItemRun, ctx: StateTransitionContext) => {
  item.status = transitionStatus(item.status, "success", ctx.command);
  item.finishedAt = now(ctx);
  item.lastError = null;
};

export const markItemFailed = (item: NodeItemRun, ctx: StateTransitionContext) => {
  item.status = transitionStatus(item.status, "failed", ctx.command);
  item.finishedAt = now(ctx);
  item.lastError = ctx.error ?? null;
};

export const markItemRejected = (item: NodeItemRun, ctx: StateTransitionContext) => {
  item.status = transitionStatus(item.status, "rejected", ctx.command);
  item.finishedAt = now(ctx);
  item.lastError = ctx.error ?? null;
};

export const markItemSkipped = (item: NodeItemRun, ctx: StateTransitionContext) => {
  item.status = transitionStatus(item.status, "skipped", ctx.command);
  item.wakeAt = null;
  item.finishedAt = now(ctx);
  item.lastError = null;
};

export const markItemWaiting = (item: NodeItemRun, ctx: StateTransitionContext) => {
  item.status = transitionStatus(item.status, "waiting", ctx.command);
  if (ctx.wakeAt) item.wakeAt = ctx.wakeAt;
};

export const markItemBlocked = (item: NodeItemRun, ctx: StateTransitionContext) => {
  item.status = transitionStatus(item.status, "blocked", ctx.command);
};

export const markItemWakeSuccess = (item: NodeItemRun, ctx: StateTransitionContext) => {
  item.status = transitionStatus(item.status, "success", ctx.command);
  item.wakeAt = null;
  item.finishedAt = now(ctx);
};

export const markItemReset = (item: NodeItemRun, targetStatus: NodeItemRunStatus, ctx: StateTransitionContext) => {
  item.status = transitionStatus(item.status, targetStatus, ctx.command);
  item.startedAt = null;
  item.finishedAt = targetStatus === "skipped" ? now(ctx) : null;
  item.lastError = null;
  item.wakeAt = null;
};
