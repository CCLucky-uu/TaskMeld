import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { NodeItemRun, NodeRun, GroupItemRun, GroupRun } from "../src/pipeline/runtime-model";
import {
  markItemQueued,
  markItemRunning,
  markItemSuccess,
  markItemFailed,
  markItemRejected,
  markItemSkipped,
  markItemWaiting,
  markItemBlocked,
  markItemWakeSuccess,
  markItemReset,
  markNodeQueued,
  markNodeRunning,
  markNodeSuccess,
  markNodeFailed,
  markNodeRejected,
  markNodeSkipped,
  markNodeBlocked,
  markNodeWaiting,
  markGroupItemQueued,
  markGroupItemRunning,
  markGroupItemSuccess,
  markGroupItemFailed,
  markGroupItemSkipped,
  markGroupItemBlocked,
  markGroupItemWaiting,
  markGroupItemReset,
  markGroupQueued,
  markGroupRunning,
  markGroupSuccess,
  markGroupFailed,
  markGroupBlocked,
  markGroupReset,
} from "../src/pipeline/state";
import { IllegalStateTransitionError } from "../src/pipeline/state-machine";

const makeItem = (overrides?: Partial<NodeItemRun>): NodeItemRun => ({
  id: randomUUID(),
  nodeId: "n1",
  itemKey: "default",
  status: "blocked",
  route: null,
  attempt: 0,
  loopCount: 0,
  wakeAt: null,
  startedAt: null,
  finishedAt: null,
  lastError: null,
  artifacts: [],
  ...overrides,
});

const makeNode = (overrides?: Partial<NodeRun>): NodeRun => ({
  id: "n1",
  title: "Test Node",
  executor: { agentId: "agent-1", role: "coder" as const, fallbackAgentId: null, sessionId: null },
  instruction: "test",
  outputSpec: { type: "json", schemaVersion: 1 },
  allowReject: false,
  maxRejectCount: 0,
  status: "blocked",
  dependsOn: [],
  artifacts: [],
  rejectFeedbacks: [],
  attempt: 0,
  rejectCount: 0,
  startedAt: null,
  finishedAt: null,
  lastError: null,
  ...overrides,
});

const makeGroupItem = (overrides?: Partial<GroupItemRun>): GroupItemRun => ({
  id: randomUUID(),
  groupId: "g1",
  itemKey: "default",
  status: "blocked",
  attempt: 0,
  startedAt: null,
  finishedAt: null,
  lastError: null,
  artifacts: [],
  ...overrides,
});

const makeGroup = (overrides?: Partial<GroupRun>): GroupRun => ({
  id: "g1",
  title: "Test Group",
  status: "blocked",
  members: [],
  joinPolicy: "all",
  artifacts: [],
  startedAt: null,
  finishedAt: null,
  lastError: null,
  ...overrides,
});

const ctx = (reason: string) => ({ reason });

const run = async () => {
  // ====== NodeItemRun transitions ======

  // blocked -> queued
  {
    const item = makeItem({ status: "blocked" });
    markItemQueued(item, ctx("dep_satisfied"));
    assert.equal(item.status, "queued", "blocked -> queued");
  }

  // queued -> running
  {
    const item = makeItem({ status: "queued" });
    markItemRunning(item, ctx("exec_start"));
    assert.equal(item.status, "running", "queued -> running status");
    assert.equal(item.attempt, 1, "attempt incremented");
    assert.ok(item.startedAt, "startedAt set");
    assert.equal(item.finishedAt, null, "finishedAt cleared");
    assert.equal(item.lastError, null, "lastError cleared");
    assert.equal(item.wakeAt, null, "wakeAt cleared");
  }

  // running -> success
  {
    const item = makeItem({ status: "running", startedAt: "2025-01-01T00:00:00.000Z", attempt: 1 });
    markItemSuccess(item, ctx("exec_done"));
    assert.equal(item.status, "success", "running -> success");
    assert.ok(item.finishedAt, "finishedAt set");
    assert.equal(item.lastError, null, "lastError cleared");
  }

  // running -> failed
  {
    const item = makeItem({ status: "running", attempt: 1 });
    markItemFailed(item, { reason: "exec_error", error: "something went wrong" });
    assert.equal(item.status, "failed", "running -> failed");
    assert.ok(item.finishedAt, "finishedAt set");
    assert.equal(item.lastError, "something went wrong", "lastError set");
  }

  // running -> rejected
  {
    const item = makeItem({ status: "running", attempt: 1 });
    markItemRejected(item, { reason: "upstream_reject", error: "reject by downstream" });
    assert.equal(item.status, "rejected", "running -> rejected");
    assert.ok(item.finishedAt, "finishedAt set");
    assert.equal(item.lastError, "reject by downstream", "lastError set");
  }

  // running -> waiting (sleepUntil)
  {
    const item = makeItem({ status: "running", attempt: 1 });
    markItemWaiting(item, { reason: "sleep_until", wakeAt: "2026-12-01T00:00:00.000Z" });
    assert.equal(item.status, "waiting", "running -> waiting");
    assert.equal(item.wakeAt, "2026-12-01T00:00:00.000Z", "wakeAt set");
    assert.equal(item.finishedAt, null, "finishedAt stays null (not terminal)");
  }

  // waiting -> success (wake)
  {
    const item = makeItem({ status: "waiting", wakeAt: "2026-01-01T00:00:00.000Z" });
    markItemWakeSuccess(item, ctx("sleep_expired"));
    assert.equal(item.status, "success", "waiting -> success (wake)");
    assert.equal(item.wakeAt, null, "wakeAt cleared");
    assert.ok(item.finishedAt, "finishedAt set");
  }

  // blocked -> waiting
  {
    const item = makeItem({ status: "blocked" });
    markItemWaiting(item, { reason: "dep_not_met" });
    assert.equal(item.status, "waiting", "blocked -> waiting");
    assert.equal(item.wakeAt, null, "wakeAt not set without explicit wakeAt");
  }

  // blocked -> skipped
  {
    const item = makeItem({ status: "blocked" });
    markItemSkipped(item, ctx("node_disabled"));
    assert.equal(item.status, "skipped", "blocked -> skipped");
    assert.equal(item.wakeAt, null, "wakeAt cleared");
    assert.ok(item.finishedAt, "finishedAt set");
  }

  // waiting -> skipped
  {
    const item = makeItem({ status: "waiting" });
    markItemSkipped(item, ctx("dep_impossible"));
    assert.equal(item.status, "skipped", "waiting -> skipped");
    assert.ok(item.finishedAt, "finishedAt set");
  }

  // queued -> blocked
  {
    const item = makeItem({ status: "queued" });
    markItemBlocked(item, ctx("group_member_detected"));
    assert.equal(item.status, "blocked", "queued -> blocked");
  }

  // self-transition (no-op)
  {
    const item = makeItem({ status: "queued" });
    markItemQueued(item, ctx("redundant"));
    assert.equal(item.status, "queued", "queued -> queued (self)");
  }

  // Reset from running
  {
    const item = makeItem({ status: "running", startedAt: "2025-01-01T00:00:00.000Z", attempt: 2, lastError: "old", wakeAt: "2025-01-01T00:00:00.000Z" });
    markItemReset(item, "blocked", ctx("retry"));
    assert.equal(item.status, "blocked", "reset: running -> blocked");
    assert.equal(item.startedAt, null, "reset: startedAt cleared");
    assert.equal(item.finishedAt, null, "reset: finishedAt cleared");
    assert.equal(item.lastError, null, "reset: lastError cleared");
    assert.equal(item.wakeAt, null, "reset: wakeAt cleared");
  }

  // Reset with target skipped
  {
    const item = makeItem({ status: "failed", lastError: "old" });
    markItemReset(item, "skipped", ctx("skip_on_retry"));
    assert.equal(item.status, "skipped", "reset: failed -> skipped");
    assert.ok(item.finishedAt, "reset: finishedAt set for skipped target");
    assert.equal(item.lastError, null, "reset: lastError cleared");
  }

  // Illegal transition
  {
    const item = makeItem({ status: "success" });
    assert.throws(
      () => markItemRunning(item, ctx("bad")),
      IllegalStateTransitionError,
      "success -> running should throw",
    );
  }

  // ====== NodeRun transitions ======

  // blocked -> queued
  {
    const node = makeNode({ status: "blocked" });
    markNodeQueued(node, ctx("dep_satisfied"));
    assert.equal(node.status, "queued", "node: blocked -> queued");
  }

  // queued -> running
  {
    const node = makeNode({ status: "queued" });
    markNodeRunning(node, ctx("exec_start"));
    assert.equal(node.status, "running", "node: queued -> running");
    assert.equal(node.attempt, 1, "node: attempt incremented");
    assert.ok(node.startedAt, "node: startedAt set");
    assert.equal(node.finishedAt, null, "node: finishedAt cleared");
    assert.equal(node.lastError, null, "node: lastError cleared");
  }

  // running -> success
  {
    const node = makeNode({ status: "running", startedAt: "2025-01-01T00:00:00.000Z", attempt: 1 });
    markNodeSuccess(node, { reason: "done", artifacts: [{ id: "a1", type: "t", schemaVersion: 1, name: "n", path: "/p", hash: "h", sourceNodeId: "n1", createdAt: "2025-01-01T00:00:00.000Z" }] });
    assert.equal(node.status, "success", "node: running -> success");
    assert.ok(node.finishedAt, "node: finishedAt set");
    assert.equal(node.lastError, null, "node: lastError cleared");
    assert.equal(node.artifacts.length, 1, "node: artifacts set");
  }

  // running -> failed
  {
    const node = makeNode({ status: "running", attempt: 1 });
    markNodeFailed(node, { reason: "error", error: "node crash" });
    assert.equal(node.status, "failed", "node: running -> failed");
    assert.ok(node.finishedAt, "node: finishedAt set");
    assert.equal(node.lastError, "node crash", "node: lastError set");
  }

  // running -> rejected
  {
    const node = makeNode({ status: "running", attempt: 1 });
    markNodeRejected(node, { reason: "upstream_reject", error: "rejected" });
    assert.equal(node.status, "rejected", "node: running -> rejected");
    assert.ok(node.finishedAt, "node: finishedAt set");
    assert.equal(node.lastError, "rejected", "node: lastError set");
  }

  // node skipped
  {
    const node = makeNode({ status: "blocked" });
    markNodeSkipped(node, ctx("node_disabled"));
    assert.equal(node.status, "skipped", "node: blocked -> skipped");
    assert.ok(node.finishedAt, "node: finishedAt set");
  }

  // node blocked
  {
    const node = makeNode({ status: "queued" });
    markNodeBlocked(node, ctx("group_member"));
    assert.equal(node.status, "blocked", "node: queued -> blocked");
  }

  // node waiting
  {
    const node = makeNode({ status: "queued" });
    markNodeWaiting(node, ctx("dep_pending"));
    assert.equal(node.status, "waiting", "node: queued -> waiting");
  }

  // ====== GroupItemRun transitions ======

  // blocked -> queued
  {
    const gi = makeGroupItem({ status: "blocked" });
    markGroupItemQueued(gi, ctx("dep_satisfied"));
    assert.equal(gi.status, "queued", "groupItem: blocked -> queued");
  }

  // queued -> running
  {
    const gi = makeGroupItem({ status: "queued" });
    markGroupItemRunning(gi, ctx("exec_start"));
    assert.equal(gi.status, "running", "groupItem: queued -> running");
    assert.equal(gi.attempt, 1, "groupItem: attempt incremented");
    assert.ok(gi.startedAt, "groupItem: startedAt set");
    assert.equal(gi.finishedAt, null, "groupItem: finishedAt cleared");
    assert.equal(gi.lastError, null, "groupItem: lastError cleared");
  }

  // running -> success
  {
    const gi = makeGroupItem({ status: "running", attempt: 1 });
    markGroupItemSuccess(gi, ctx("all_members_done"));
    assert.equal(gi.status, "success", "groupItem: running -> success");
    assert.ok(gi.finishedAt, "groupItem: finishedAt set");
  }

  // running -> failed
  {
    const gi = makeGroupItem({ status: "running", attempt: 1 });
    markGroupItemFailed(gi, { reason: "member_failed", error: "member error" });
    assert.equal(gi.status, "failed", "groupItem: running -> failed");
    assert.equal(gi.lastError, "member error", "groupItem: lastError set");
  }

  // blocked -> skipped
  {
    const gi = makeGroupItem({ status: "blocked" });
    markGroupItemSkipped(gi, ctx("dep_impossible"));
    assert.equal(gi.status, "skipped", "groupItem: blocked -> skipped");
    assert.ok(gi.finishedAt, "groupItem: finishedAt set");
  }

  // blocked -> waiting
  {
    const gi = makeGroupItem({ status: "blocked" });
    markGroupItemWaiting(gi, ctx("dep_pending"));
    assert.equal(gi.status, "waiting", "groupItem: blocked -> waiting");
  }

  // blocked via markGroupItemBlocked
  {
    const gi = makeGroupItem({ status: "queued" });
    markGroupItemBlocked(gi, ctx("dependency_blocked"));
    assert.equal(gi.status, "blocked", "groupItem: queued -> blocked");
  }

  // Reset
  {
    const gi = makeGroupItem({ status: "running", startedAt: "2025-01-01T00:00:00.000Z", attempt: 2, lastError: "old" });
    markGroupItemReset(gi, "blocked", ctx("retry"));
    assert.equal(gi.status, "blocked", "groupItem reset: running -> blocked");
    assert.equal(gi.startedAt, null, "groupItem reset: startedAt cleared");
    assert.equal(gi.finishedAt, null, "groupItem reset: finishedAt cleared");
    assert.equal(gi.lastError, null, "groupItem reset: lastError cleared");
  }

  // ====== GroupRun transitions ======

  // blocked -> queued
  {
    const g = makeGroup({ status: "blocked" });
    markGroupQueued(g, ctx("members_queued"));
    assert.equal(g.status, "queued", "group: blocked -> queued");
  }

  // queued -> running
  {
    const g = makeGroup({ status: "queued" });
    markGroupRunning(g, ctx("members_running"));
    assert.equal(g.status, "running", "group: queued -> running");
    assert.ok(g.startedAt, "group: startedAt set");
  }

  // running -> success
  {
    const g = makeGroup({ status: "running", startedAt: "2025-01-01T00:00:00.000Z" });
    markGroupSuccess(g, ctx("all_members_done"));
    assert.equal(g.status, "success", "group: running -> success");
    assert.ok(g.finishedAt, "group: finishedAt set");
    assert.equal(g.lastError, null, "group: lastError cleared");
  }

  // running -> failed
  {
    const g = makeGroup({ status: "running" });
    markGroupFailed(g, { reason: "member_failed", error: "one member failed" });
    assert.equal(g.status, "failed", "group: running -> failed");
    assert.equal(g.lastError, "one member failed", "group: lastError set");
  }

  // queued -> blocked
  {
    const g = makeGroup({ status: "queued" });
    markGroupBlocked(g, ctx("members_blocked"));
    assert.equal(g.status, "blocked", "group: queued -> blocked");
  }

  // Reset group
  {
    const g = makeGroup({ status: "running", startedAt: "2025-01-01T00:00:00.000Z", lastError: "old" });
    markGroupReset(g, "blocked", ctx("retry"));
    assert.equal(g.status, "blocked", "group reset: running -> blocked");
    assert.equal(g.startedAt, null, "group reset: startedAt cleared");
    assert.equal(g.finishedAt, null, "group reset: finishedAt cleared");
    assert.equal(g.lastError, null, "group reset: lastError cleared");
  }

  // ====== StateTransitionContext.now override ======
  {
    const item = makeItem({ status: "queued" });
    markItemRunning(item, { reason: "test_now", now: "2026-06-01T12:00:00.000Z" });
    assert.equal(item.startedAt, "2026-06-01T12:00:00.000Z", "custom now used for startedAt");
  }

  console.log("pipeline state machine tests passed");
};

void run().catch((error) => {
  console.error("pipeline state machine tests failed", error);
  process.exitCode = 1;
});
