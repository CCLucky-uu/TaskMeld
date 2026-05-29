import { transitionStatus } from "../state-machine";
import type { NodeRun } from "../runtime-model";
import type { StateTransitionContext } from "./types";

const now = (ctx: StateTransitionContext) => ctx.now ?? new Date().toISOString();

export const markNodeQueued = (node: NodeRun, ctx: StateTransitionContext) => {
  node.status = transitionStatus(node.status, "queued", ctx.command);
};

export const markNodeRunning = (node: NodeRun, ctx: StateTransitionContext) => {
  node.status = transitionStatus(node.status, "running", ctx.command);
  node.attempt += 1;
  node.startedAt = now(ctx);
  node.finishedAt = null;
  node.lastError = null;
};

export const markNodeSuccess = (node: NodeRun, ctx: StateTransitionContext) => {
  node.status = transitionStatus(node.status, "success", ctx.command);
  node.finishedAt = now(ctx);
  node.lastError = null;
  if (ctx.artifacts) node.artifacts = ctx.artifacts;
};

export const markNodeFailed = (node: NodeRun, ctx: StateTransitionContext) => {
  node.status = transitionStatus(node.status, "failed", ctx.command);
  node.finishedAt = now(ctx);
  node.lastError = ctx.error ?? null;
};

export const markNodeRejected = (node: NodeRun, ctx: StateTransitionContext) => {
  node.status = transitionStatus(node.status, "rejected", ctx.command);
  node.finishedAt = now(ctx);
  node.lastError = ctx.error ?? null;
};

export const markNodeSkipped = (node: NodeRun, ctx: StateTransitionContext) => {
  node.status = transitionStatus(node.status, "skipped", ctx.command);
  node.finishedAt = now(ctx);
  node.lastError = null;
};

export const markNodeBlocked = (node: NodeRun, ctx: StateTransitionContext) => {
  node.status = transitionStatus(node.status, "blocked", ctx.command);
};

export const markNodeWaiting = (node: NodeRun, ctx: StateTransitionContext) => {
  node.status = transitionStatus(node.status, "waiting", ctx.command);
};
