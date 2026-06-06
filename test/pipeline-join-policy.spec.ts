import assert from "node:assert/strict";
import { join } from "node:path";
import { createWorkflowGraph } from "../src/pipeline/workflow-graph";
import { createRunStateHelpers } from "../src/pipeline/execution/run-state-helpers";
import { createDependencyState } from "../src/pipeline/scheduler/dependency-state";
import { createRuntimeStore } from "../src/app/runtime-store";
import { seedRunWithItems } from "../src/pipeline/runtime-model";
import { markItemSuccess, markItemRunning } from "../src/pipeline/state";
import type { WorkflowDefinitionRuntime, WorkflowNode, WorkflowGroup } from "../src/pipeline/template";

const makeNode = (overrides: Partial<WorkflowNode> & { id: string; name: string }): WorkflowNode => ({
  type: "task",
  enabled: true,
  isMainline: true,
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

const makeGroupWorkflow = (overrides?: {
  joinPolicy?: WorkflowGroup["joinPolicy"];
}): WorkflowDefinitionRuntime => ({
  version: "3.0",
  scheduler: { enabled: true, mode: "auto", dispatchBy: "item", maxConcurrency: 1, loopGuard: { maxGlobalIterations: 20, maxPerItemLoop: 5 } },
  plugins: [
    { pluginId: 'remote-batch', enabled: false, config: { url: "", startBatch: 1, batchSize: 5, sourceField: "list30" } },
    { pluginId: 'scheduler', enabled: true, config: {} },
  ],
  nodes: [
    makeNode({ id: "n1", name: "root" }),
    makeNode({ id: "pa", name: "ParallelA", parallelGroupId: "g1" }),
    makeNode({ id: "pb", name: "ParallelB", parallelGroupId: "g1" }),
    makeNode({ id: "after", name: "AfterGroup" }),
  ],
  edges: [
    { from: "n1", to: "g1", when: null },
    { from: "g1", to: "after", when: null },
  ],
  groups: [{
    id: "g1",
    type: "parallel",
    members: ["pa", "pb"],
    joinPolicy: overrides?.joinPolicy ?? "all",
  }],
});

const run = async () => {
  // ====== Test 1: Group item success → group success ======
  {
    const workflow = makeGroupWorkflow();
    const graph = createWorkflowGraph(workflow);
    const store = createRuntimeStore({
      graph,
      defaultItemKeys: ["kw-1"],
      runStateFile: join(process.cwd(), ".data", "test-join-all-success.json"),
      initialRun: seedRunWithItems(graph.getTemplateNodes(), ["kw-1"]),
      getSchedulerState: () => ({ enabled: true, mode: "auto" }),
    });
    const state = createRunStateHelpers({ runtimeStore: store, graph, defaultItemKeys: ["kw-1"] });
    const depState = createDependencyState({ runtimeStore: store, graph, ensureItemRuns: state.ensureItemRuns, getItemRun: state.getItemRun, getGroupItemRun: state.getGroupItemRun });

    state.ensureGroupItemKeyInitialized("kw-1");
    const g1Item = state.getGroupItemRun("g1", "kw-1");
    assert.ok(g1Item, "group item must exist");

    // Simulate group execution success
    g1Item.status = "running";
    g1Item.status = "success";
    g1Item.finishedAt = new Date().toISOString();

    depState.markReadyGroupsFromDependencies();
    const groups = store.getRun().groups ?? [];
    const g1Group = groups.find((g: { id: string }) => g.id === "g1");
    assert.ok(g1Group);
    assert.equal(g1Group.status, "success", "group item success → group success");
    assert.equal(g1Group.lastError, null);
  }

  // ====== Test 2: Group item failed → group fails ======
  {
    const workflow = makeGroupWorkflow();
    const graph = createWorkflowGraph(workflow);
    const store = createRuntimeStore({
      graph,
      defaultItemKeys: ["kw-1"],
      runStateFile: join(process.cwd(), ".data", "test-join-any-fail.json"),
      initialRun: seedRunWithItems(graph.getTemplateNodes(), ["kw-1"]),
      getSchedulerState: () => ({ enabled: true, mode: "auto" }),
    });
    const state = createRunStateHelpers({ runtimeStore: store, graph, defaultItemKeys: ["kw-1"] });
    const depState = createDependencyState({ runtimeStore: store, graph, ensureItemRuns: state.ensureItemRuns, getItemRun: state.getItemRun, getGroupItemRun: state.getGroupItemRun });

    state.ensureGroupItemKeyInitialized("kw-1");
    const g1Item = state.getGroupItemRun("g1", "kw-1");
    assert.ok(g1Item);

    // Simulate group execution failure
    g1Item.status = "running";
    g1Item.status = "failed";
    g1Item.finishedAt = new Date().toISOString();
    g1Item.lastError = "group_member_failed";

    depState.markReadyGroupsFromDependencies();
    const groups = store.getRun().groups ?? [];
    const g1Group = groups.find((g: { id: string }) => g.id === "g1");
    assert.ok(g1Group);
    assert.equal(g1Group.status, "failed", "group item failed → group failed");
    assert.equal(g1Group.lastError, "group_member_failed", "group should carry error from item");
  }

  // ====== Test 3: Multiple group items — all succeed → group success ======
  {
    const graph = createWorkflowGraph(makeGroupWorkflow());
    const store = createRuntimeStore({
      graph,
      defaultItemKeys: ["kw-1", "kw-2"],
      runStateFile: join(process.cwd(), ".data", "test-join-multi-item.json"),
      initialRun: seedRunWithItems(graph.getTemplateNodes(), ["kw-1", "kw-2"]),
      getSchedulerState: () => ({ enabled: true, mode: "auto" }),
    });
    const state = createRunStateHelpers({ runtimeStore: store, graph, defaultItemKeys: ["kw-1", "kw-2"] });
    const depState = createDependencyState({ runtimeStore: store, graph, ensureItemRuns: state.ensureItemRuns, getItemRun: state.getItemRun, getGroupItemRun: state.getGroupItemRun });

    state.ensureGroupItemKeyInitialized("kw-1");
    state.ensureGroupItemKeyInitialized("kw-2");

    // kw-1: group item success
    const g1Item1 = state.getGroupItemRun("g1", "kw-1");
    assert.ok(g1Item1);
    g1Item1.status = "running";
    g1Item1.status = "success";
    g1Item1.finishedAt = new Date().toISOString();

    // kw-2: group item success
    const g1Item2 = state.getGroupItemRun("g1", "kw-2");
    assert.ok(g1Item2);
    g1Item2.status = "running";
    g1Item2.status = "success";
    g1Item2.finishedAt = new Date().toISOString();

    depState.markReadyGroupsFromDependencies();
    const groups = store.getRun().groups ?? [];
    const g1Group = groups.find((g: { id: string }) => g.id === "g1");
    assert.ok(g1Group);
    assert.equal(g1Group.status, "success", "all group items success → group success");
  }

  // ====== Test 4: Group members and artifact references ======
  {
    const workflow = makeGroupWorkflow();
    const graph = createWorkflowGraph(workflow);
    const store = createRuntimeStore({
      graph,
      defaultItemKeys: ["kw-1"],
      runStateFile: join(process.cwd(), ".data", "test-join-artifacts.json"),
      initialRun: seedRunWithItems(graph.getTemplateNodes(), ["kw-1"]),
      getSchedulerState: () => ({ enabled: true, mode: "auto" }),
    });
    const state = createRunStateHelpers({ runtimeStore: store, graph, defaultItemKeys: ["kw-1"] });

    state.ensureGroupItemKeyInitialized("kw-1");

    const artifactDir = join(process.cwd(), ".data");
    const pa = state.getItemRun("pa", "kw-1");
    const pb = state.getItemRun("pb", "kw-1");
    assert.ok(pa && pb);

    const a1 = { id: "a1", type: "patch.v1", schemaVersion: 1, name: "patch-a", path: join(artifactDir, "patch-a.json"), hash: "h1", sourceNodeId: "pa", createdAt: new Date().toISOString() };
    const a2 = { id: "a2", type: "patch.v1", schemaVersion: 1, name: "patch-b", path: join(artifactDir, "patch-b.json"), hash: "h2", sourceNodeId: "pb", createdAt: new Date().toISOString() };
    pa.artifacts = [a1];
    pb.artifacts = [a2];

    assert.equal(pa.artifacts.length, 1, "member pa should have 1 artifact");
    assert.equal(pb.artifacts.length, 1, "member pb should have 1 artifact");
    assert.equal(pa.artifacts[0].sourceNodeId, "pa", "artifact should reference source node");
    assert.equal(pb.artifacts[0].sourceNodeId, "pb", "artifact should reference source node");

    graph.syncRunGroupsFromWorkflow(store.getRun());
    const groups = store.getRun().groups ?? [];
    const g1Group = groups.find((g: { id: string }) => g.id === "g1");
    assert.ok(g1Group);
    assert.ok(Array.isArray(g1Group.members));
    assert.deepEqual([...g1Group.members].sort(), ["pa", "pb"]);
  }

  // ====== Test 5: Group status transitions via depState ======
  {
    const workflow = makeGroupWorkflow();
    const graph = createWorkflowGraph(workflow);
    const store = createRuntimeStore({
      graph,
      defaultItemKeys: ["kw-1"],
      runStateFile: join(process.cwd(), ".data", "test-join-dep-state.json"),
      initialRun: seedRunWithItems(graph.getTemplateNodes(), ["kw-1"]),
      getSchedulerState: () => ({ enabled: true, mode: "auto" }),
    });
    const state = createRunStateHelpers({ runtimeStore: store, graph, defaultItemKeys: ["kw-1"] });
    const depState = createDependencyState({ runtimeStore: store, graph, ensureItemRuns: state.ensureItemRuns, getItemRun: state.getItemRun, getGroupItemRun: state.getGroupItemRun });

    // Satisfy upstream (n1 → g1 dependency)
    const n1 = state.getItemRun("n1", "kw-1");
    assert.ok(n1);
    markItemRunning(n1, { reason: "start" });
    markItemSuccess(n1, { reason: "done" });
    n1.finishedAt = new Date().toISOString();

    state.ensureGroupItemKeyInitialized("kw-1");
    const g1Item = state.getGroupItemRun("g1", "kw-1");
    assert.ok(g1Item);

    // Dependency satisfied → group item should be queued
    depState.markReadyGroupsFromDependencies();
    assert.equal(g1Item.status, "queued", "dependency satisfied → group item queued");

    // Group item transitions to running → group running
    g1Item.status = "running";
    depState.markReadyGroupsFromDependencies();
    let groups = store.getRun().groups ?? [];
    let g1Group = groups.find((g: { id: string }) => g.id === "g1");
    assert.ok(g1Group);
    assert.equal(g1Group.status, "running", "group item running → group running");

    // Group item transitions to success → group success
    g1Item.status = "success";
    g1Item.finishedAt = new Date().toISOString();
    depState.markReadyGroupsFromDependencies();
    groups = store.getRun().groups ?? [];
    g1Group = groups.find((g: { id: string }) => g.id === "g1");
    assert.ok(g1Group);
    assert.equal(g1Group.status, "success", "group item success → group success (all policy)");
  }

  // ====== Test 6: TARGET — joinPolicy 仅支持 "all" ======
  // Phase 3 已对齐契约：类型只允许 "all"，normalize 静默降级历史 any/quorum 为 all，
  // validate 在保存时显式拒绝 any/quorum。运行时始终按 "all" 语义执行。
  {
    // makeGroupWorkflow 默认 joinPolicy 为 "all"
    const workflow = makeGroupWorkflow();
    assert.equal(workflow.groups[0].joinPolicy, "all", "default joinPolicy should be 'all'");

    const graph = createWorkflowGraph(workflow);
    const store = createRuntimeStore({
      graph,
      defaultItemKeys: ["kw-1"],
      runStateFile: join(process.cwd(), ".data", "test-join-all-contract.json"),
      initialRun: seedRunWithItems(graph.getTemplateNodes(), ["kw-1"]),
      getSchedulerState: () => ({ enabled: true, mode: "auto" }),
    });
    const state = createRunStateHelpers({ runtimeStore: store, graph, defaultItemKeys: ["kw-1"] });
    const depState = createDependencyState({ runtimeStore: store, graph, ensureItemRuns: state.ensureItemRuns, getItemRun: state.getItemRun, getGroupItemRun: state.getGroupItemRun });

    graph.syncRunGroupsFromWorkflow(store.getRun());
    const groups = store.getRun().groups ?? [];
    const g1Group = groups.find((g: { id: string }) => g.id === "g1");
    assert.ok(g1Group);
    assert.equal(g1Group.joinPolicy, "all", "joinPolicy in group run state should be 'all'");

    // "all" 语义：任一 member 失败 → group 失败
    state.ensureGroupItemKeyInitialized("kw-1");
    const g1Item = state.getGroupItemRun("g1", "kw-1");
    assert.ok(g1Item);
    g1Item.status = "running";
    g1Item.status = "failed";
    g1Item.finishedAt = new Date().toISOString();
    g1Item.lastError = "member_error";

    depState.markReadyGroupsFromDependencies();
    const updatedGroups = store.getRun().groups ?? [];
    const updatedGroup = updatedGroups.find((g: { id: string }) => g.id === "g1");
    assert.ok(updatedGroup);
    assert.equal(updatedGroup.status, "failed", "all policy: group item failure → group failed");
  }

  // ====== Test 7: TARGET — validate rejects joinPolicy "any"/"quorum" on save ======
  {
    const { validateWorkflowGraph } = await import("../src/pipeline/workflow/validate.js");
    const base = makeGroupWorkflow();
    const workflowWithAny: WorkflowDefinitionRuntime = {
      ...base,
      groups: [{ ...base.groups[0], joinPolicy: "any" as WorkflowGroup["joinPolicy"] }],
    };

    const result = validateWorkflowGraph(workflowWithAny);
    assert.equal(result.ok, false, "validate should reject joinPolicy 'any'");
    assert.equal((result as { error: string }).error, "join_policy_not_supported");
  }

  console.log("pipeline join policy tests passed");
};

void run().catch((error) => {
  console.error("pipeline join policy tests failed", error);
  process.exitCode = 1;
});
