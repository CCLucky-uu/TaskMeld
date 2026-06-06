import assert from "node:assert/strict";
import { join } from "node:path";
import { createWorkflowGraph } from "../src/pipeline/workflow-graph";
import { createRunStateHelpers } from "../src/pipeline/execution/run-state-helpers";
import { createDependencyState } from "../src/pipeline/scheduler/dependency-state";
import { createRouteItemManager } from "../src/pipeline/execution/route-item-manager";
import { createRuntimeStore } from "../src/app/runtime-store";
import { seedRunWithItems } from "../src/pipeline/runtime-model";
import { isDependencySatisfied, canNeverSatisfy, type DependencyCheckContext } from "../src/pipeline/execution/dependency-check";
import type { WorkflowDefinitionRuntime, WorkflowNode } from "../src/pipeline/template";
import type { ResultEnvelope } from "../src/pipeline/structured-output/contract";

const makeNode = (overrides: Partial<WorkflowNode> & { id: string; name: string }): WorkflowNode => ({
  type: "task",
  enabled: true,
  isMainline: overrides.lane !== "branch",
  lane: "main",
  parallelGroupId: null,
  executor: { agentId: "a", role: "planner", fallbackAgentId: null, sessionId: null },
  inputMode: "single",
  outputMode: "single",
  routePolicy: null,
  retryPolicy: { maxAttempts: 2, backoffMs: 0 },
  outputSpec: { type: "brief.v1", schemaVersion: 1 },
  instruction: "",
  allowReject: false,
  maxRejectCount: 0,
  ...overrides,
});

const makeRouteEnvelope = (nodeId: string, routes: string[]): ResultEnvelope => ({
  version: "2.0",
  runId: "run-test",
  nodeId,
  requestId: "req-1",
  sessionId: "agent:router:main",
  status: "success",
  artifacts: [{ type: "route.v1", schemaVersion: 1, name: "route", content: routes.map((r) => ({ route: r })), meta: {} }],
  control: { sleepUntil: null, retryFromNodeId: null },
  logs: [],
  error: null,
});

const run = async () => {
  // ====== Test 6: Cross-branch normal edge isDependencySatisfied returns false ======
  // COMPAT-BEHAVIOR: isCrossBranchEdge is structurally unreachable for real workflow edges
  // in the current implementation. The cross-branch detection relies on "all incoming edges
  // are route edges" which creates a logical deadlock — the edge's own presence disqualifies
  // the target node from being a "pure" branch node.
  //
  // In practice, cross-branch isolation is enforced by the route-mismatch check in
  // isDependencySatisfied / canNeverSatisfy: when source.route !== edge.when, the
  // dependency is unsatisfiable — which is the actual mechanism blocking execution
  // across different route branches.
  //
  // TARGET-BEHAVIOR (Phase 2): Cross-branch detection should use explicit branchScopeId
  // instead of inferring from incoming edge shape. The isCrossBranchEdge function should
  // be reachable for real workflow edges, enabling proper validation rejection at save time.
  //
  // This test uses a mock DependencyCheckContext (isCrossBranchEdge → true) to verify
  // that the dependency-check layer handles the cross-branch signal correctly if it
  // were ever reached. It also directly tests the route-mismatch and disabled-node
  // branches of the same functions.
  {
    const mockCtx: DependencyCheckContext = {
      isCrossBranchEdge: () => true,
      isGroupId: () => false,
      isWorkflowNodeEnabled: () => true,
      isRoutePolicyNode: () => false,
      getGroupItemRun: () => null,
      getItemRun: () => ({ status: "success", route: null }),
    };

    const edge = { from: "B1", to: "B2", when: null as string | null };

    assert.equal(
      isDependencySatisfied("kw-1", edge, mockCtx),
      false,
      "cross-branch edge should never satisfy dependency",
    );
    assert.equal(
      canNeverSatisfy("kw-1", edge, mockCtx),
      true,
      "cross-branch edge should be considered permanently unsatisfiable",
    );

    // Also verify: when source is route node with mismatched route
    const routeCtx: DependencyCheckContext = {
      ...mockCtx,
      isCrossBranchEdge: () => false,
      getItemRun: () => ({ status: "success", route: "route_a" }),
    };
    const routeEdge = { from: "router", to: "B2", when: "route_b" as string | null };
    assert.equal(
      isDependencySatisfied("kw-1", routeEdge, routeCtx),
      false,
      "route mismatch should not satisfy dependency even when source succeeded",
    );
    assert.equal(
      canNeverSatisfy("kw-1", routeEdge, routeCtx),
      true,
      "route mismatch from succeeded source should be permanently unsatisfiable",
    );

    // enabled=false node with route edge should be permanently unsatisfiable
    const disabledCtx: DependencyCheckContext = {
      ...mockCtx,
      isCrossBranchEdge: () => false,
      isWorkflowNodeEnabled: () => false,
    };
    assert.equal(
      isDependencySatisfied("kw-1", routeEdge, disabledCtx),
      false,
      "disabled source with route edge should not satisfy dependency",
    );
    assert.equal(
      canNeverSatisfy("kw-1", routeEdge, disabledCtx),
      true,
      "disabled source with route edge should be permanently unsatisfiable",
    );
  }

  // ====== Test 7: Cross-branch normal edge doesn't propagate to other branch ======
  // Constructs a workflow where B1 (from route_a) has a normal edge to B2 (from route_b).
  // Verifies that B1's success does not effectively promote B2 — the dependency check
  // blocks B2 because the route doesn't match.
  {
    const workflow: WorkflowDefinitionRuntime = {
      version: "3.0",
      scheduler: { enabled: true, mode: "auto", dispatchBy: "item", maxConcurrency: 1, loopGuard: { maxGlobalIterations: 20, maxPerItemLoop: 5 } },
      plugins: [
        { pluginId: 'remote-batch', enabled: false, config: { url: "", startBatch: 1, batchSize: 5, sourceField: "list30" } },
        { pluginId: 'scheduler', enabled: true, config: {} },
      ],
      nodes: [
        makeNode({ id: "router", name: "Router", routePolicy: { allowed: ["yes", "no", "a", "b"] } }),
        makeNode({ id: "NoBranch", name: "NoBranch", lane: "branch" }),
        makeNode({ id: "B1", name: "Branch1", lane: "branch" }),
        makeNode({ id: "B2", name: "Branch2", lane: "branch" }),
      ],
      edges: [
        { from: "router", to: "NoBranch", when: "no" },
        { from: "router", to: "B1", when: "a" },
        { from: "router", to: "B2", when: "b" },
        { from: "B1", to: "B2", when: null },
      ],
      groups: [],
    };

    const graph = createWorkflowGraph(workflow);
    const store = createRuntimeStore({
      graph,
      defaultItemKeys: ["kw-1"],
      runStateFile: join(process.cwd(), ".data", "test-branch-isolation-propagation.json"),
      initialRun: seedRunWithItems(graph.getTemplateNodes(), ["kw-1"]),
      getSchedulerState: () => ({ enabled: true, mode: "auto" }),
    });
    const state = createRunStateHelpers({ runtimeStore: store, graph, defaultItemKeys: ["kw-1"] });
    const depState = createDependencyState({ runtimeStore: store, graph, ensureItemRuns: state.ensureItemRuns, getItemRun: state.getItemRun, getGroupItemRun: state.getGroupItemRun });
    const routeMgr = createRouteItemManager({ runtimeStore: store, graph, state });

    // Route with "a" only — B2 should not be reachable
    const routerItem = state.getItemRun("router", "kw-1");
    assert.ok(routerItem, "router item must exist");
    routerItem.status = "success";
    routerItem.finishedAt = new Date().toISOString();
    routerItem.artifacts = [];

    await routeMgr.applyEnvelopeOutcomeToItem(routerItem, makeRouteEnvelope("router", ["a"]));

    // B1 derived item should be created and queued
    const b1Derived = state.getItemRun("B1", "kw-1::router:a");
    assert.ok(b1Derived, "B1 should have derived item for route a");
    assert.equal(b1Derived?.status, "queued", "B1 derived item should be queued");

    // Now simulate B1 completing successfully
    b1Derived.status = "success";
    b1Derived.finishedAt = new Date().toISOString();
    b1Derived.route = null;

    // Apply B1's outcome to propagate downstream
    await routeMgr.applyEnvelopeOutcomeToItem(b1Derived, {
      version: "2.0",
      runId: "run-test",
      nodeId: "B1",
      requestId: "req-b1",
      sessionId: "agent:B1:main",
      status: "success",
      artifacts: [{ type: "brief.v1", schemaVersion: 1, name: "out", content: { ok: true }, meta: {} }],
      control: { sleepUntil: null, retryFromNodeId: null },
      logs: [],
      error: null,
    });

    // Run dependency evaluation to see final state
    depState.markReadyItemsFromDependencies();
    depState.markReadyGroupsFromDependencies();

    // B2 with derived key "kw-1::router:a" should not execute —
    // its dependency (router→B2 when:"b") requires route "b" but router only produced "a"
    const b2Derived = state.getItemRun("B2", "kw-1::router:a");
    assert.ok(b2Derived, "B2 should have a derived item under route a key");
    assert.notEqual(
      b2Derived?.status,
      "running",
      "B2 should NOT be running — cross-branch propagation is effectively blocked",
    );
    assert.ok(
      b2Derived?.status === "skipped" || b2Derived?.status === "waiting" || b2Derived?.status === "blocked",
      "B2 should be in a non-executing state (skipped/waiting/blocked)",
    );

    // B2 with base key should also be non-executing
    const b2Base = state.getItemRun("B2", "kw-1");
    assert.ok(b2Base, "B2 base item must exist");
    assert.ok(
      b2Base?.status !== "running" && b2Base?.status !== "queued",
      "B2 base item should not be queued/running after route split",
    );
  }

  // ====== Test 8: Route derived itemKey can execute independently from mainline ======
  {
    const workflow: WorkflowDefinitionRuntime = {
      version: "3.0",
      scheduler: { enabled: true, mode: "auto", dispatchBy: "item", maxConcurrency: 1, loopGuard: { maxGlobalIterations: 20, maxPerItemLoop: 5 } },
      plugins: [
        { pluginId: 'remote-batch', enabled: false, config: { url: "", startBatch: 1, batchSize: 5, sourceField: "list30" } },
        { pluginId: 'scheduler', enabled: true, config: {} },
      ],
      nodes: [
        makeNode({ id: "router", name: "Router", routePolicy: { allowed: ["yes", "no"] } }),
        makeNode({ id: "B-no", name: "NoBranch", lane: "branch" }),
        makeNode({ id: "after-no", name: "AfterNo" }),
      ],
      edges: [
        { from: "router", to: "B-no", when: "no" },
        { from: "B-no", to: "after-no", when: null },
      ],
      groups: [],
    };

    const graph = createWorkflowGraph(workflow);
    const store = createRuntimeStore({
      graph,
      defaultItemKeys: ["kw-1"],
      runStateFile: join(process.cwd(), ".data", "test-branch-independence.json"),
      initialRun: seedRunWithItems(graph.getTemplateNodes(), ["kw-1"]),
      getSchedulerState: () => ({ enabled: true, mode: "auto" }),
    });
    const state = createRunStateHelpers({ runtimeStore: store, graph, defaultItemKeys: ["kw-1"] });
    const depState = createDependencyState({ runtimeStore: store, graph, ensureItemRuns: state.ensureItemRuns, getItemRun: state.getItemRun, getGroupItemRun: state.getGroupItemRun });
    const routeMgr = createRouteItemManager({ runtimeStore: store, graph, state });

    // Route "no" — create derived branch item path
    const routerItem = state.getItemRun("router", "kw-1");
    assert.ok(routerItem, "router item must exist");
    routerItem.status = "success";
    routerItem.finishedAt = new Date().toISOString();
    routerItem.artifacts = [];

    await routeMgr.applyEnvelopeOutcomeToItem(routerItem, makeRouteEnvelope("router", ["no"]));

    // The base item path and derived item path should be independent
    const noDerived = state.getItemRun("B-no", "kw-1::router:no");
    const noBase = state.getItemRun("B-no", "kw-1");
    assert.ok(noDerived, "derived item must exist");
    assert.ok(noBase, "base item must exist");
    assert.equal(noDerived?.status, "queued", "derived item should be queued");

    // Base item status depends on dependency evaluation: router→B-no is a route edge (when:"no"),
    // and router's base item has route=null, so the dependency is never satisfiable.
    depState.markReadyItemsFromDependencies();
    assert.equal(noBase?.status, "skipped", "base item should be skipped after dep check (route edge from base router not satisfied)");

    // Advance derived item to success — after-no on derived key should become queued
    noDerived.status = "success";
    noDerived.finishedAt = new Date().toISOString();
    noDerived.route = null;
    await routeMgr.applyEnvelopeOutcomeToItem(noDerived, {
      version: "2.0",
      runId: "run-test",
      nodeId: "B-no",
      requestId: "req-b1",
      sessionId: "agent:Bno:main",
      status: "success",
      artifacts: [{ type: "brief.v1", schemaVersion: 1, name: "out", content: { ok: true }, meta: {} }],
      control: { sleepUntil: null, retryFromNodeId: null },
      logs: [],
      error: null,
    });

    depState.markReadyItemsFromDependencies();

    const afterNoDerived = state.getItemRun("after-no", "kw-1::router:no");
    assert.equal(afterNoDerived?.status, "queued", "after-no should be queued on derived key after B-no succeeds");

    // The base key after-no should still be blocked/skipped
    const afterNoBase = state.getItemRun("after-no", "kw-1");
    assert.notEqual(afterNoBase?.status, "queued", "after-no on base key should NOT be queued — only derived key path executes");
  }

  // ====== Test 9: Route downstream connects to parallel group ======
  {
    const workflow: WorkflowDefinitionRuntime = {
      version: "3.0",
      scheduler: { enabled: true, mode: "auto", dispatchBy: "item", maxConcurrency: 1, loopGuard: { maxGlobalIterations: 20, maxPerItemLoop: 5 } },
      plugins: [
        { pluginId: 'remote-batch', enabled: false, config: { url: "", startBatch: 1, batchSize: 5, sourceField: "list30" } },
        { pluginId: 'scheduler', enabled: true, config: {} },
      ],
      nodes: [
        makeNode({ id: "router", name: "Router", routePolicy: { allowed: ["yes", "no"] } }),
        makeNode({ id: "pa", name: "ParallelA", parallelGroupId: "g1" }),
        makeNode({ id: "pb", name: "ParallelB", parallelGroupId: "g1" }),
        makeNode({ id: "after-g", name: "AfterGroup" }),
      ],
      edges: [
        { from: "router", to: "g1", when: "no" },
        { from: "g1", to: "after-g", when: null },
      ],
      groups: [{ id: "g1", type: "parallel", members: ["pa", "pb"], joinPolicy: "all" }],
    };

    const graph = createWorkflowGraph(workflow);
    const store = createRuntimeStore({
      graph,
      defaultItemKeys: ["kw-1"],
      runStateFile: join(process.cwd(), ".data", "test-route-group.json"),
      initialRun: seedRunWithItems(graph.getTemplateNodes(), ["kw-1"]),
      getSchedulerState: () => ({ enabled: true, mode: "auto" }),
    });
    const state = createRunStateHelpers({ runtimeStore: store, graph, defaultItemKeys: ["kw-1"] });
    const depState = createDependencyState({ runtimeStore: store, graph, ensureItemRuns: state.ensureItemRuns, getItemRun: state.getItemRun, getGroupItemRun: state.getGroupItemRun });
    const routeMgr = createRouteItemManager({ runtimeStore: store, graph, state });

    graph.syncRunGroupsFromWorkflow(store.getRun());

    const routerItem = state.getItemRun("router", "kw-1");
    assert.ok(routerItem, "router item must exist");
    routerItem.status = "success";
    routerItem.finishedAt = new Date().toISOString();
    routerItem.artifacts = [];

    await routeMgr.applyEnvelopeOutcomeToItem(routerItem, makeRouteEnvelope("router", ["no"]));

    // Group item run should be initialized for the derived key
    const g1Derived = state.getGroupItemRun("g1", "kw-1::router:no");
    assert.ok(g1Derived, "group item run should be created for derived key");
    assert.equal(g1Derived?.status, "queued", "group item should be queued after route hit");

    // Member items should be created for the derived key
    const paDerived = state.getItemRun("pa", "kw-1::router:no");
    const pbDerived = state.getItemRun("pb", "kw-1::router:no");
    assert.ok(paDerived, "parallel member pa should have derived item");
    assert.ok(pbDerived, "parallel member pb should have derived item");

    // Group item run for non-matching route should NOT be queued
    const g1YesDerived = state.getGroupItemRun("g1", "kw-1::router:yes");
    assert.equal(g1YesDerived?.status ?? "skipped", "skipped", "group item for unmatched route should be skipped");

    depState.markReadyGroupsFromDependencies();
    const groups = store.getRun().groups ?? [];
    const g1Group = groups.find((g) => g.id === "g1");
    assert.ok(g1Group, "group g1 must exist");
  }

  // ====== Test 10: Route downstream connects to merge node (join policy) ======
  {
    const workflow: WorkflowDefinitionRuntime = {
      version: "3.0",
      scheduler: { enabled: true, mode: "auto", dispatchBy: "item", maxConcurrency: 1, loopGuard: { maxGlobalIterations: 20, maxPerItemLoop: 5 } },
      plugins: [
        { pluginId: 'remote-batch', enabled: false, config: { url: "", startBatch: 1, batchSize: 5, sourceField: "list30" } },
        { pluginId: 'scheduler', enabled: true, config: {} },
      ],
      nodes: [
        makeNode({ id: "router", name: "Router", routePolicy: { allowed: ["a", "b"] } }),
        makeNode({ id: "branch-a", name: "BranchA", lane: "branch" }),
        makeNode({ id: "branch-b", name: "BranchB", lane: "branch" }),
        makeNode({ id: "merge", name: "MergeNode", dependencyPolicy: "any" }),
      ],
      edges: [
        { from: "router", to: "branch-a", when: "a" },
        { from: "router", to: "branch-b", when: "b" },
        { from: "branch-a", to: "merge", when: null },
        { from: "branch-b", to: "merge", when: null },
      ],
      groups: [],
    };

    const graph = createWorkflowGraph(workflow);
    const store = createRuntimeStore({
      graph,
      defaultItemKeys: ["kw-1"],
      runStateFile: join(process.cwd(), ".data", "test-route-merge.json"),
      initialRun: seedRunWithItems(graph.getTemplateNodes(), ["kw-1"]),
      getSchedulerState: () => ({ enabled: true, mode: "auto" }),
    });
    const state = createRunStateHelpers({ runtimeStore: store, graph, defaultItemKeys: ["kw-1"] });
    const depState = createDependencyState({ runtimeStore: store, graph, ensureItemRuns: state.ensureItemRuns, getItemRun: state.getItemRun, getGroupItemRun: state.getGroupItemRun });
    const routeMgr = createRouteItemManager({ runtimeStore: store, graph, state });

    // Route both "a" and "b" to create two parallel derived paths
    const routerItem = state.getItemRun("router", "kw-1");
    assert.ok(routerItem, "router item must exist");
    routerItem.status = "success";
    routerItem.finishedAt = new Date().toISOString();
    routerItem.artifacts = [];

    await routeMgr.applyEnvelopeOutcomeToItem(routerItem, makeRouteEnvelope("router", ["a", "b"]));

    const baDerived = state.getItemRun("branch-a", "kw-1::router:a");
    const bbDerived = state.getItemRun("branch-b", "kw-1::router:b");
    assert.ok(baDerived, "branch-a derived must exist");
    assert.ok(bbDerived, "branch-b derived must exist");

    // Verify merge node has items for both derived keys
    const mergeA = state.getItemRun("merge", "kw-1::router:a");
    const mergeB = state.getItemRun("merge", "kw-1::router:b");
    assert.ok(mergeA, "merge should have item for route a key");
    assert.ok(mergeB, "merge should have item for route b key");

    // Simulate branch-a succeeding, branch-b still pending
    baDerived.status = "success";
    baDerived.finishedAt = new Date().toISOString();
    baDerived.route = null;
    await routeMgr.applyEnvelopeOutcomeToItem(baDerived, {
      version: "2.0",
      runId: "run-test",
      nodeId: "branch-a",
      requestId: "req-ba",
      sessionId: "agent:Ba:main",
      status: "success",
      artifacts: [{ type: "brief.v1", schemaVersion: 1, name: "out", content: { ok: true }, meta: {} }],
      control: { sleepUntil: null, retryFromNodeId: null },
      logs: [],
      error: null,
    });

    // Merge with dependencyPolicy:"any" should be queued when either upstream succeeds
    depState.markReadyItemsFromDependencies();

    // merge on key "kw-1::router:a": branch-a is success, branch-b is from different key so not a dependency
    // merge's incoming: branch-a (null edge), branch-b (null edge)
    // For merge on "kw-1::router:a": branch-a is success ✓, branch-b... branch-b's item on "kw-1::router:a" does exist but is skipped (not reachable from route a)
    // Since dependencyPolicy is "any", one satisfied is enough → queued
    assert.equal(mergeA.status, "queued", "merge with any-policy should queue when one upstream succeeds");

    // merge on key "kw-1::router:b": branch-a is success but on wrong derived key, branch-b is blocked
    // branch-a with "kw-1::router:a" is for a different key → dependency is on wrong key → not satisfied
    // Hmm actually the dependency check looks up items by itemKey. merge on "kw-1::router:b"
    // looks for branch-a item with key "kw-1::router:b" → that item exists (from initialization) but is skipped
    // So branch-a dependency is not satisfied for merge on key "kw-1::router:b"
    // And branch-b on "kw-1::router:b" is still blocked
    // So merge on "kw-1::router:b" should be waiting
    assert.ok(
      mergeB.status === "waiting" || mergeB.status === "blocked",
      "merge on route b key should wait for its own upstream path",
    );

    // Now make branch-b succeed too
    bbDerived.status = "success";
    bbDerived.finishedAt = new Date().toISOString();
    bbDerived.route = null;
    await routeMgr.applyEnvelopeOutcomeToItem(bbDerived, {
      version: "2.0",
      runId: "run-test",
      nodeId: "branch-b",
      requestId: "req-bb",
      sessionId: "agent:Bb:main",
      status: "success",
      artifacts: [{ type: "brief.v1", schemaVersion: 1, name: "out", content: { ok: true }, meta: {} }],
      control: { sleepUntil: null, retryFromNodeId: null },
      logs: [],
      error: null,
    });
    depState.markReadyItemsFromDependencies();
    assert.equal(mergeB.status, "queued", "merge on route b key should queue when its upstream succeeds");
  }

  // ====== Test 11: TARGET — Cross-branch edge is now rejected by scope-based validation ======
  // Phase 2 已修复：基于显式 branchScopeId 的跨支线检测替代了旧的入边形状推断。
  // B1→B2 (when:null) 在不同分支 scope 之间现在被正确识别并拒绝。
  {
    const { validateWorkflowGraph } = await import("../src/pipeline/workflow/validate.js");
    const workflow: WorkflowDefinitionRuntime = {
      version: "3.0",
      scheduler: { enabled: true, mode: "auto", dispatchBy: "item", maxConcurrency: 1, loopGuard: { maxGlobalIterations: 20, maxPerItemLoop: 5 } },
      plugins: [
        { pluginId: 'remote-batch', enabled: false, config: { url: "", startBatch: 1, batchSize: 5, sourceField: "list30" } },
        { pluginId: 'scheduler', enabled: true, config: {} },
      ],
      nodes: [
        makeNode({ id: "router", name: "Router", routePolicy: { allowed: ["a", "b"] } }),
        makeNode({ id: "B1", name: "Branch1", lane: "branch" }),
        makeNode({ id: "B2", name: "Branch2", lane: "branch" }),
      ],
      edges: [
        { from: "router", to: "B1", when: "a" },
        { from: "router", to: "B2", when: "b" },
        { from: "B1", to: "B2", when: null },
      ],
      groups: [],
    };

    const result = validateWorkflowGraph(workflow);
    assert.equal(result.ok, false, "scope-based validation should reject cross-branch edge");
    assert.equal((result as { error: string }).error, "cross_branch_edge_forbidden");
  }

  console.log("pipeline branch isolation tests passed");
};

void run().catch((error) => {
  console.error("pipeline branch isolation tests failed", error);
  process.exitCode = 1;
});
