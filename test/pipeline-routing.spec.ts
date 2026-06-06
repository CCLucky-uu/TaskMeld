import assert from "node:assert/strict";
import { join } from "node:path";
import { createWorkflowGraph } from "../src/pipeline/workflow-graph";
import { createRunStateHelpers } from "../src/pipeline/execution/run-state-helpers";
import { createDependencyState } from "../src/pipeline/scheduler/dependency-state";
import { createRouteItemManager } from "../src/pipeline/execution/route-item-manager";
import { createRuntimeStore } from "../src/app/runtime-store";
import { seedRunWithItems } from "../src/pipeline/runtime-model";
import type { WorkflowDefinitionRuntime, WorkflowNode } from "../src/pipeline/template";
import { validateWorkflowGraph } from "../src/pipeline/workflow/validate";

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

const makeRouteWorkflow = (): WorkflowDefinitionRuntime => ({
  version: "3.0",
  scheduler: { enabled: true, mode: "auto", dispatchBy: "item", maxConcurrency: 1, loopGuard: { maxGlobalIterations: 20, maxPerItemLoop: 5 } },
  plugins: [
    { pluginId: 'remote-batch', enabled: false, config: { url: "", startBatch: 1, batchSize: 5, sourceField: "list30" } },
    { pluginId: 'scheduler', enabled: true, config: {} },
  ],
  nodes: [
    makeNode({ id: "router", name: "Router", routePolicy: { allowed: ["yes", "no"] } }),
    makeNode({ id: "main-downstream", name: "MainAfterRouter" }),
    makeNode({ id: "no-downstream", name: "NoBranch", lane: "branch" }),
  ],
  edges: [
    { from: "router", to: "main-downstream", when: null },
    { from: "router", to: "no-downstream", when: "no" },
  ],
  groups: [],
});

const makeMultiRouteWorkflow = (): WorkflowDefinitionRuntime => ({
  ...makeRouteWorkflow(),
  nodes: [
    makeNode({ id: "router", name: "Router", routePolicy: { allowed: ["yes", "no", "route_a", "route_b"] } }),
    makeNode({ id: "branch-a", name: "BranchA", lane: "branch" }),
    makeNode({ id: "branch-b", name: "BranchB", lane: "branch" }),
  ],
  edges: [
    { from: "router", to: "branch-a", when: "route_a" },
    { from: "router", to: "branch-b", when: "route_b" },
  ],
});

const makeRouteEnvelope = (nodeId: string, routes: string[]): import("../src/pipeline/structured-output/contract").ResultEnvelope => ({
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
  // ====== Test 1: Single route match ======
  {
    const workflow = makeRouteWorkflow();
    const graph = createWorkflowGraph(workflow);
    const store = createRuntimeStore({
      graph,
      defaultItemKeys: ["kw-1"],
      runStateFile: join(process.cwd(), ".data", "test-route-single.json"),
      initialRun: seedRunWithItems(graph.getTemplateNodes(), ["kw-1"]),
      getSchedulerState: () => ({ enabled: true, mode: "auto" }),
    });
    const state = createRunStateHelpers({ runtimeStore: store, graph, defaultItemKeys: ["kw-1"] });
    const depState = createDependencyState({ runtimeStore: store, graph, ensureItemRuns: state.ensureItemRuns, getItemRun: state.getItemRun, getGroupItemRun: state.getGroupItemRun });
    const routeMgr = createRouteItemManager({ runtimeStore: store, graph, state });

    const source = state.getItemRun("router", "kw-1");
    assert.ok(source, "source item must exist");
    source.status = "success";
    source.finishedAt = new Date().toISOString();
    source.artifacts = [];

    await routeMgr.applyEnvelopeOutcomeToItem(source, makeRouteEnvelope("router", ["yes"]));

    const mainDerived = state.getItemRun("main-downstream", "kw-1::router:yes");
    assert.ok(mainDerived, "yes route should create derived item for mainline downstream");
    assert.equal(mainDerived?.status, "blocked", "yes mainline dependency should wait for dependency scheduler");

    depState.markReadyItemsFromDependencies();
    assert.equal(mainDerived?.status, "queued", "yes route should satisfy normal dependency on derived key");
    const mainBase = state.getItemRun("main-downstream", "kw-1");
    assert.equal(mainBase?.status, "skipped", "base key for mainline downstream should be skipped after route split");

    depState.markReadyItemsFromDependencies();
    const noDerived = state.getItemRun("no-downstream", "kw-1::router:yes");
    assert.ok(noDerived, "yes route should also create derived item for no-downstream");
    assert.equal(noDerived?.status, "skipped", "no-downstream with yes-derived key should be skipped (unreachable)");
  }

  // ====== Test 2: Multi-route match (both branches) ======
  {
    const workflow = makeMultiRouteWorkflow();
    const graph = createWorkflowGraph(workflow);
    const store = createRuntimeStore({
      graph,
      defaultItemKeys: ["kw-1"],
      runStateFile: join(process.cwd(), ".data", "test-route-multi.json"),
      initialRun: seedRunWithItems(graph.getTemplateNodes(), ["kw-1"]),
      getSchedulerState: () => ({ enabled: true, mode: "auto" }),
    });
    const state = createRunStateHelpers({ runtimeStore: store, graph, defaultItemKeys: ["kw-1"] });
    const routeMgr = createRouteItemManager({ runtimeStore: store, graph, state });

    const source = state.getItemRun("router", "kw-1");
    assert.ok(source, "source item must exist");
    source.status = "success";
    source.finishedAt = new Date().toISOString();
    source.artifacts = [];

    await routeMgr.applyEnvelopeOutcomeToItem(source, makeRouteEnvelope("router", ["route_a", "route_b"]));

    const aDerived = state.getItemRun("branch-a", "kw-1::router:route_a");
    const bDerived = state.getItemRun("branch-b", "kw-1::router:route_b");
    assert.ok(aDerived, "route_a should create derived item for branch-a");
    assert.ok(bDerived, "route_b should create derived item for branch-b");
    assert.equal(aDerived?.status, "queued", "branch-a derived item should be queued");
    assert.equal(bDerived?.status, "queued", "branch-b derived item should be queued");
    // Only the source node's derived item carries the route; downstream nodes have route=null after resetNodeItemRun
    assert.equal(aDerived?.route, null, "downstream derived item route is null (resetNodeItemRun clears it)");
    assert.equal(bDerived?.route, null, "downstream derived item route is null (resetNodeItemRun clears it)");
    assert.notEqual(aDerived?.id, bDerived?.id, "each derived item should have a distinct id");

    // The source node's derived item does carry the matched route
    const routerDerivedA = state.getItemRun("router", "kw-1::router:route_a");
    const routerDerivedB = state.getItemRun("router", "kw-1::router:route_b");
    assert.equal(routerDerivedA?.route, "route_a", "source-derived item should carry route_a");
    assert.equal(routerDerivedB?.route, "route_b", "source-derived item should carry route_b");
  }

  // ====== Test 3: Unmatched route downstream skipped ======
  {
    const workflow = makeRouteWorkflow();
    const graph = createWorkflowGraph(workflow);
    const store = createRuntimeStore({
      graph,
      defaultItemKeys: ["kw-1"],
      runStateFile: join(process.cwd(), ".data", "test-route-unmatched.json"),
      initialRun: seedRunWithItems(graph.getTemplateNodes(), ["kw-1"]),
      getSchedulerState: () => ({ enabled: true, mode: "auto" }),
    });
    const state = createRunStateHelpers({ runtimeStore: store, graph, defaultItemKeys: ["kw-1"] });
    const depState = createDependencyState({ runtimeStore: store, graph, ensureItemRuns: state.ensureItemRuns, getItemRun: state.getItemRun, getGroupItemRun: state.getGroupItemRun });
    const routeMgr = createRouteItemManager({ runtimeStore: store, graph, state });

    const source = state.getItemRun("router", "kw-1");
    assert.ok(source, "source item must exist");
    source.status = "success";
    source.finishedAt = new Date().toISOString();
    source.artifacts = [];

    await routeMgr.applyEnvelopeOutcomeToItem(source, makeRouteEnvelope("router", ["yes"]));

    depState.markReadyItemsFromDependencies();

    const mainDerived = state.getItemRun("main-downstream", "kw-1::router:yes");
    assert.ok(mainDerived, "yes route should create derived item for mainline downstream");
    assert.equal(mainDerived?.status, "queued", "matched mainline should be queued");

    const noDerived = state.getItemRun("no-downstream", "kw-1::router:yes");
    assert.ok(noDerived, "no-downstream still gets a derived item under yes-key");
    assert.equal(noDerived?.status, "skipped", "no-downstream should be skipped when route is yes (unreachable)");

    const noBaseItem = state.getItemRun("no-downstream", "kw-1");
    assert.equal(noBaseItem?.status, "skipped", "no-downstream base item should be skipped (dependency impossible)");
  }

  // ====== Test 4: Non-yes route must not pass through the normal mainline edge ======
  {
    const workflow = makeRouteWorkflow();
    const graph = createWorkflowGraph(workflow);
    const store = createRuntimeStore({
      graph,
      defaultItemKeys: ["kw-1"],
      runStateFile: join(process.cwd(), ".data", "test-route-normal-edge.json"),
      initialRun: seedRunWithItems(graph.getTemplateNodes(), ["kw-1"]),
      getSchedulerState: () => ({ enabled: true, mode: "auto" }),
    });
    const state = createRunStateHelpers({ runtimeStore: store, graph, defaultItemKeys: ["kw-1"] });
    const depState = createDependencyState({ runtimeStore: store, graph, ensureItemRuns: state.ensureItemRuns, getItemRun: state.getItemRun, getGroupItemRun: state.getGroupItemRun });
    const routeMgr = createRouteItemManager({ runtimeStore: store, graph, state });

    const source = state.getItemRun("router", "kw-1");
    assert.ok(source, "source item must exist");
    source.status = "success";
    source.finishedAt = new Date().toISOString();
    source.artifacts = [];

    await routeMgr.applyEnvelopeOutcomeToItem(source, makeRouteEnvelope("router", ["no"]));

    const mainDerived = state.getItemRun("main-downstream", "kw-1::router:no");
    assert.ok(mainDerived, "mainline downstream should have a derived item under no-key");
    assert.equal(mainDerived?.status, "skipped", "post-init: mainline derived item is skipped for no route");

    depState.markReadyItemsFromDependencies();
    assert.equal(mainDerived?.status, "skipped", "no route must not satisfy router's normal mainline dependency");

    const mainBase = state.getItemRun("main-downstream", "kw-1");
    assert.equal(mainBase?.status, "skipped", "mainline base item should remain skipped after route split");
  }

  // ====== Test 5: Retry route source node clears old derivations ======
  {
    const workflow = makeRouteWorkflow();
    const graph = createWorkflowGraph(workflow);
    const store = createRuntimeStore({
      graph,
      defaultItemKeys: ["kw-1"],
      runStateFile: join(process.cwd(), ".data", "test-route-retry.json"),
      initialRun: seedRunWithItems(graph.getTemplateNodes(), ["kw-1"]),
      getSchedulerState: () => ({ enabled: true, mode: "auto" }),
    });
    const state = createRunStateHelpers({ runtimeStore: store, graph, defaultItemKeys: ["kw-1"] });
    const depState = createDependencyState({ runtimeStore: store, graph, ensureItemRuns: state.ensureItemRuns, getItemRun: state.getItemRun, getGroupItemRun: state.getGroupItemRun });
    const routeMgr = createRouteItemManager({ runtimeStore: store, graph, state });

    const source = state.getItemRun("router", "kw-1");
    assert.ok(source, "source item must exist");
    source.status = "success";
    source.finishedAt = new Date().toISOString();
    source.artifacts = [];

    // First execution
    await routeMgr.applyEnvelopeOutcomeToItem(source, makeRouteEnvelope("router", ["yes"]));
    const firstRunItem = state.getItemRun("main-downstream", "kw-1::router:yes");
    assert.ok(firstRunItem, "first run should create derived item");
    const firstRunId = firstRunItem?.id;

    // Second execution (simulating retry)
    await routeMgr.applyEnvelopeOutcomeToItem(source, makeRouteEnvelope("router", ["yes"]));
    const secondRunItem = state.getItemRun("main-downstream", "kw-1::router:yes");
    assert.ok(secondRunItem, "second run should create new derived item");
    assert.notEqual(
      secondRunItem?.id,
      firstRunId,
      "retry should clear old derived item and create a fresh one with new id",
    );
    depState.markReadyItemsFromDependencies();
    assert.equal(secondRunItem?.status, "queued", "new derived item should be queued after retry dependency pass");

    // Verify no duplicate derived items with the same key prefix
    const allDerived = (store.getRun().itemRuns ?? []).filter(
      (item) => item.itemKey.startsWith("kw-1::router:"),
    );
    assert.equal(allDerived.length, 3, "retry should leave exactly one derived item per node (3 nodes total)");
  }

  // ====== Test 6: Workflow validation permits yes mainline dependency plus non-yes route edge ======
  {
    const result = validateWorkflowGraph(makeRouteWorkflow());
    assert.equal(result.ok, true, "route node should allow one normal yes-mainline edge plus non-yes route edges");
  }

  // ====== Test 7: Workflow validation rejects yes route edge ======
  {
    const invalid = makeRouteWorkflow();
    invalid.edges = [
      { from: "router", to: "main-downstream", when: null },
      { from: "router", to: "no-downstream", when: "yes" },
    ];
    const result = validateWorkflowGraph(invalid);
    assert.equal(result.ok, false, "yes must not be modeled as a route edge");
  }

  console.log("pipeline routing tests passed");
};

void run().catch((error) => {
  console.error("pipeline routing tests failed", error);
  process.exitCode = 1;
});
