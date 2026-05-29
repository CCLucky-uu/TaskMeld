import assert from "node:assert/strict";
import { diagnoseNodeDependency, REASON_MESSAGES, type DependencyDiagnosticGraph } from "../src/pipeline/diagnostics/index";
import type { Run, NodeItemRun, GroupItemRun } from "../src/pipeline/runtime-model";

const makeMockGraph = (overrides?: Partial<DependencyDiagnosticGraph>): DependencyDiagnosticGraph => ({
  getWorkflowNodeById: () => ({ dependencyPolicy: "all" }),
  getIncomingEdges: () => [],
  isCrossBranchEdge: () => false,
  isGroupId: () => false,
  isWorkflowNodeEnabled: () => true,
  ...overrides,
});

const makeItem = (overrides?: Partial<NodeItemRun>): NodeItemRun => ({
  id: "i1",
  nodeId: "n1",
  itemKey: "kw-1",
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

const run = async () => {
  // ====== source_not_success ======
  {
    const graph = makeMockGraph({
      getWorkflowNodeById: () => ({ dependencyPolicy: "all" }),
      getIncomingEdges: () => [{ from: "upstream", to: "n1", when: null }],
    });

    const runObj: Run = {
      id: "run-1",
      status: "running",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      nodes: [{ id: "n1", title: "Target", executor: { agentId: "a", role: "planner", fallbackAgentId: null, sessionId: null }, instruction: "", outputSpec: { type: "json", schemaVersion: 1 }, allowReject: false, maxRejectCount: 0, status: "blocked", dependsOn: ["upstream"], artifacts: [], rejectFeedbacks: [], attempt: 0, rejectCount: 0, startedAt: null, finishedAt: null, lastError: null }],
      itemRuns: [
        makeItem({ nodeId: "upstream", itemKey: "kw-1", status: "queued" }),
        makeItem({ nodeId: "n1", itemKey: "kw-1", status: "blocked" }),
      ],
      groups: [],
      groupItemRuns: [],
    };

    const result = diagnoseNodeDependency(runObj, graph, "n1", "kw-1");
    assert.equal(result.length, 1);
    assert.equal(result[0].incoming.length, 1);
    assert.equal(result[0].incoming[0].reason, "source_not_success");
    assert.equal(result[0].incoming[0].satisfied, false);
    assert.equal(result[0].outcome, "waiting");
  }

  // ====== source_failed ======
  {
    const graph = makeMockGraph({
      getWorkflowNodeById: () => ({ dependencyPolicy: "all" }),
      getIncomingEdges: () => [{ from: "upstream", to: "n1", when: null }],
    });

    const runObj: Run = {
      id: "run-2",
      status: "running",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      nodes: [
        { id: "n1", title: "Target", executor: { agentId: "a", role: "planner", fallbackAgentId: null, sessionId: null }, instruction: "", outputSpec: { type: "json", schemaVersion: 1 }, allowReject: false, maxRejectCount: 0, status: "blocked", dependsOn: ["upstream"], artifacts: [], rejectFeedbacks: [], attempt: 0, rejectCount: 0, startedAt: null, finishedAt: null, lastError: null },
      ],
      itemRuns: [
        makeItem({ nodeId: "upstream", itemKey: "kw-1", status: "failed", finishedAt: new Date().toISOString() }),
        makeItem({ nodeId: "n1", itemKey: "kw-1", status: "blocked" }),
      ],
      groups: [],
      groupItemRuns: [],
    };

    const result = diagnoseNodeDependency(runObj, graph, "n1", "kw-1");
    assert.equal(result.length, 1);
    assert.equal(result[0].incoming[0].reason, "source_failed");
    assert.equal(result[0].incoming[0].impossible, true);
    assert.equal(result[0].outcome, "skipped");
  }

  // ====== route_mismatch ======
  {
    const graph = makeMockGraph({
      getWorkflowNodeById: () => ({ dependencyPolicy: "all" }),
      getIncomingEdges: () => [{ from: "router", to: "n1", when: "route_b" }],
    });

    const runObj: Run = {
      id: "run-3",
      status: "running",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      nodes: [
        { id: "n1", title: "Target", executor: { agentId: "a", role: "planner", fallbackAgentId: null, sessionId: null }, instruction: "", outputSpec: { type: "json", schemaVersion: 1 }, allowReject: false, maxRejectCount: 0, status: "blocked", dependsOn: ["router"], artifacts: [], rejectFeedbacks: [], attempt: 0, rejectCount: 0, startedAt: null, finishedAt: null, lastError: null },
      ],
      itemRuns: [
        makeItem({ nodeId: "router", itemKey: "kw-1", status: "success", route: "route_a", finishedAt: new Date().toISOString() }),
        makeItem({ nodeId: "n1", itemKey: "kw-1", status: "blocked" }),
      ],
      groups: [],
      groupItemRuns: [],
    };

    const result = diagnoseNodeDependency(runObj, graph, "n1", "kw-1");
    assert.equal(result.length, 1);
    assert.equal(result[0].incoming[0].reason, "route_mismatch");
    assert.equal(result[0].incoming[0].satisfied, false);
    assert.equal(result[0].incoming[0].impossible, true);
    assert.equal(result[0].outcome, "skipped");
  }

  // ====== cross_branch_edge_blocked ======
  {
    const graph = makeMockGraph({
      getWorkflowNodeById: () => ({ dependencyPolicy: "all" }),
      getIncomingEdges: () => [{ from: "B1", to: "n1", when: null }],
      isCrossBranchEdge: () => true,
    });

    const runObj: Run = {
      id: "run-4",
      status: "running",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      nodes: [
        { id: "n1", title: "Target", executor: { agentId: "a", role: "planner", fallbackAgentId: null, sessionId: null }, instruction: "", outputSpec: { type: "json", schemaVersion: 1 }, allowReject: false, maxRejectCount: 0, status: "blocked", dependsOn: ["B1"], artifacts: [], rejectFeedbacks: [], attempt: 0, rejectCount: 0, startedAt: null, finishedAt: null, lastError: null },
      ],
      itemRuns: [
        makeItem({ nodeId: "B1", itemKey: "kw-1", status: "success", finishedAt: new Date().toISOString() }),
        makeItem({ nodeId: "n1", itemKey: "kw-1", status: "blocked" }),
      ],
      groups: [],
      groupItemRuns: [],
    };

    const result = diagnoseNodeDependency(runObj, graph, "n1", "kw-1");
    assert.equal(result.length, 1);
    assert.equal(result[0].incoming[0].reason, "cross_branch_edge_blocked");
    assert.equal(result[0].incoming[0].satisfied, false);
    assert.equal(result[0].incoming[0].impossible, true);
  }

  // ====== source_skipped ======
  {
    const graph = makeMockGraph({
      getWorkflowNodeById: () => ({ dependencyPolicy: "all" }),
      getIncomingEdges: () => [{ from: "upstream", to: "n1", when: null }],
    });

    const runObj: Run = {
      id: "run-5",
      status: "running",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      nodes: [
        { id: "n1", title: "Target", executor: { agentId: "a", role: "planner", fallbackAgentId: null, sessionId: null }, instruction: "", outputSpec: { type: "json", schemaVersion: 1 }, allowReject: false, maxRejectCount: 0, status: "blocked", dependsOn: ["upstream"], artifacts: [], rejectFeedbacks: [], attempt: 0, rejectCount: 0, startedAt: null, finishedAt: null, lastError: null },
      ],
      itemRuns: [
        makeItem({ nodeId: "upstream", itemKey: "kw-1", status: "skipped", finishedAt: new Date().toISOString() }),
        makeItem({ nodeId: "n1", itemKey: "kw-1", status: "blocked" }),
      ],
      groups: [],
      groupItemRuns: [],
    };

    const result = diagnoseNodeDependency(runObj, graph, "n1", "kw-1");
    assert.equal(result.length, 1);
    assert.equal(result[0].incoming[0].reason, "source_skipped");
    assert.equal(result[0].incoming[0].impossible, true);
  }

  // ====== dependencyPolicy: any ======
  {
    const graph = makeMockGraph({
      getWorkflowNodeById: () => ({ dependencyPolicy: "any" }),
      getIncomingEdges: () => [
        { from: "up-a", to: "merge", when: null },
        { from: "up-b", to: "merge", when: null },
      ],
    });

    const runObj: Run = {
      id: "run-6",
      status: "running",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      nodes: [
        { id: "merge", title: "MergeAny", executor: { agentId: "a", role: "planner", fallbackAgentId: null, sessionId: null }, instruction: "", outputSpec: { type: "json", schemaVersion: 1 }, allowReject: false, maxRejectCount: 0, status: "blocked", dependsOn: ["up-a", "up-b"], artifacts: [], rejectFeedbacks: [], attempt: 0, rejectCount: 0, startedAt: null, finishedAt: null, lastError: null },
      ],
      itemRuns: [
        makeItem({ nodeId: "up-a", itemKey: "kw-1", status: "success", finishedAt: new Date().toISOString() }),
        makeItem({ nodeId: "up-b", itemKey: "kw-1", status: "failed", finishedAt: new Date().toISOString() }),
        makeItem({ nodeId: "merge", itemKey: "kw-1", status: "blocked" }),
      ],
      groups: [],
      groupItemRuns: [],
    };

    const result = diagnoseNodeDependency(runObj, graph, "merge", "kw-1");
    assert.equal(result.length, 1);
    assert.equal(result[0].policy, "any");
    assert.equal(result[0].outcome, "queued");
    const satisfied = result[0].incoming.filter((d) => d.satisfied);
    assert.equal(satisfied.length, 1, "any policy: one satisfied edge should suffice");
    assert.equal(satisfied[0].from, "up-a");
    assert.equal(satisfied[0].reason, "dependency_satisfied", "enabled source success should yield dependency_satisfied");
  }

  // ====== source_disabled_dependency_satisfied ======
  {
    const graph = makeMockGraph({
      getWorkflowNodeById: () => ({ dependencyPolicy: "all" }),
      getIncomingEdges: () => [{ from: "disabled-upstream", to: "n1", when: null }],
      isWorkflowNodeEnabled: (id) => id !== "disabled-upstream",
    });

    const runObj: Run = {
      id: "run-disabled",
      status: "running",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      nodes: [
        { id: "n1", title: "Target", executor: { agentId: "a", role: "planner", fallbackAgentId: null, sessionId: null }, instruction: "", outputSpec: { type: "json", schemaVersion: 1 }, allowReject: false, maxRejectCount: 0, status: "blocked", dependsOn: ["disabled-upstream"], artifacts: [], rejectFeedbacks: [], attempt: 0, rejectCount: 0, startedAt: null, finishedAt: null, lastError: null },
      ],
      itemRuns: [
        makeItem({ nodeId: "n1", itemKey: "kw-1", status: "blocked" }),
      ],
      groups: [],
      groupItemRuns: [],
    };

    const result = diagnoseNodeDependency(runObj, graph, "n1", "kw-1");
    assert.equal(result.length, 1);
    assert.equal(result[0].incoming[0].reason, "source_disabled_dependency_satisfied");
    assert.equal(result[0].incoming[0].satisfied, true);
  }

  // ====== missing_source_item_run ======
  {
    const graph = makeMockGraph({
      getWorkflowNodeById: () => ({ dependencyPolicy: "all" }),
      getIncomingEdges: () => [{ from: "upstream", to: "n1", when: null }],
    });

    const runObj: Run = {
      id: "run-7",
      status: "running",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      nodes: [
        { id: "n1", title: "Target", executor: { agentId: "a", role: "planner", fallbackAgentId: null, sessionId: null }, instruction: "", outputSpec: { type: "json", schemaVersion: 1 }, allowReject: false, maxRejectCount: 0, status: "blocked", dependsOn: ["upstream"], artifacts: [], rejectFeedbacks: [], attempt: 0, rejectCount: 0, startedAt: null, finishedAt: null, lastError: null },
      ],
      itemRuns: [
        makeItem({ nodeId: "n1", itemKey: "kw-1", status: "blocked" }),
      ],
      groups: [],
      groupItemRuns: [],
    };

    const result = diagnoseNodeDependency(runObj, graph, "n1", "kw-1");
    assert.equal(result.length, 1);
    assert.equal(result[0].incoming[0].reason, "missing_source_item_run");
    assert.equal(result[0].incoming[0].satisfied, false);
  }

  // ====== REASON_MESSAGES covers all ReasonCodes ======
  {
    const reasonCodes: string[] = [
      "dependency_satisfied",
      "source_not_success", "source_failed", "source_skipped", "route_mismatch",
      "cross_branch_edge_blocked", "group_not_success",
      "source_disabled_dependency_satisfied", "source_disabled_route_impossible",
      "missing_source_item_run", "missing_group_item_run",
    ];
    for (const code of reasonCodes) {
      assert.ok(REASON_MESSAGES[code as keyof typeof REASON_MESSAGES], `REASON_MESSAGES should have ${code}`);
    }
  }

  console.log("pipeline diagnostics tests passed");
};

void run().catch((error) => {
  console.error("pipeline diagnostics tests failed", error);
  process.exitCode = 1;
});
