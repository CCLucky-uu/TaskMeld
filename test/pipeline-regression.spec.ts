import assert from "node:assert/strict";
import { join } from "node:path";
import { createItemBatchController } from "../src/pipeline/item-batch-controller";
import { createWorkflowGraph } from "../src/pipeline/workflow-graph";
import { createRuntimeStore } from "../src/app/runtime-store";
import { createSchedulerService } from "../src/pipeline/scheduler-service";
import { createPipelineService } from "../src/services/pipeline-service";
import { createRunStateHelpers } from "../src/pipeline/execution/run-state-helpers";
import { resolveActiveBatchKeywordsForInstruction } from "../src/pipeline/execution/structured-node-runner";
import { createDependencyState } from "../src/pipeline/scheduler/dependency-state";
import { createRouteItemManager } from "../src/pipeline/execution/route-item-manager";
import { seedRunWithItems } from "../src/pipeline/runtime-model";
import type { WorkflowDefinitionRuntime } from "../src/pipeline/template";

const makeWorkflowWithParallelGroup = (): WorkflowDefinitionRuntime => ({
  version: "3.0",
  scheduler: {
    enabled: true,
    mode: "auto",
    dispatchBy: "item",
    maxConcurrency: 1,
    loopGuard: {
      maxGlobalIterations: 20,
      maxPerItemLoop: 5,
    },
  },
  plugins: [
    { pluginId: 'remote-batch', enabled: false, config: { url: "", startBatch: 1, batchSize: 5, sourceField: "list30" } },
    { pluginId: 'scheduler', enabled: true, config: {} },
  ],
  nodes: [
    {
      id: "n1",
      name: "root",
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
    },
    {
      id: "n2",
      name: "parallel-a",
      type: "task",
      enabled: true,
      isMainline: false,
      lane: "branch",
      parallelGroupId: "g1",
      executor: { agentId: "b", role: "coder", fallbackAgentId: null, sessionId: null },
      inputMode: "single",
      outputMode: "single",
      routePolicy: null,
      retryPolicy: { maxAttempts: 2, backoffMs: 0 },
      outputSpec: { type: "patch.v1", schemaVersion: 1 },
      instruction: "",
      allowReject: false,
      maxRejectCount: 0,
    },
    {
      id: "n3",
      name: "parallel-b",
      type: "task",
      enabled: true,
      isMainline: false,
      lane: "branch",
      parallelGroupId: "g1",
      executor: { agentId: "c", role: "coder", fallbackAgentId: null, sessionId: null },
      inputMode: "single",
      outputMode: "single",
      routePolicy: null,
      retryPolicy: { maxAttempts: 2, backoffMs: 0 },
      outputSpec: { type: "patch.v1", schemaVersion: 1 },
      instruction: "",
      allowReject: false,
      maxRejectCount: 0,
    },
    {
      id: "n4",
      name: "after-group",
      type: "task",
      enabled: true,
      isMainline: true,
      lane: "main",
      parallelGroupId: null,
      executor: { agentId: "d", role: "tester", fallbackAgentId: null, sessionId: null },
      inputMode: "single",
      outputMode: "single",
      routePolicy: null,
      retryPolicy: { maxAttempts: 2, backoffMs: 0 },
      outputSpec: { type: "test-report.v1", schemaVersion: 1 },
      instruction: "",
      allowReject: false,
      maxRejectCount: 0,
    },
  ],
  edges: [
    { from: "n1", to: "g1", when: null },
    { from: "g1", to: "n4", when: null },
  ],
  groups: [
    {
      id: "g1",
      type: "parallel",
      members: ["n2", "n3"],
      joinPolicy: "all",
    },
  ],
});

const makeLinearWorkflow = (): WorkflowDefinitionRuntime => ({
  version: "3.0",
  scheduler: {
    enabled: true,
    mode: "manual",
    dispatchBy: "item",
    maxConcurrency: 1,
    loopGuard: {
      maxGlobalIterations: 20,
      maxPerItemLoop: 5,
    },
  },
  plugins: [
    { pluginId: 'remote-batch', enabled: false, config: { url: "", startBatch: 1, batchSize: 5, sourceField: "list30" } },
    { pluginId: 'scheduler', enabled: true, config: {} },
  ],
  nodes: [
    {
      id: "n1",
      name: "root",
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
    },
    {
      id: "n2",
      name: "downstream",
      type: "task",
      enabled: true,
      isMainline: true,
      lane: "main",
      parallelGroupId: null,
      executor: { agentId: "b", role: "coder", fallbackAgentId: null, sessionId: null },
      inputMode: "single",
      outputMode: "single",
      routePolicy: null,
      retryPolicy: { maxAttempts: 2, backoffMs: 0 },
      outputSpec: { type: "patch.v1", schemaVersion: 1 },
      instruction: "",
      allowReject: false,
      maxRejectCount: 0,
    },
  ],
  edges: [{ from: "n1", to: "n2", when: null }],
  groups: [],
});

const makeLinearWorkflowWithSchedulerPluginDisabled = (): WorkflowDefinitionRuntime => ({
  ...makeLinearWorkflow(),
  plugins: [
    { pluginId: 'remote-batch', enabled: false, config: { url: "", startBatch: 1, batchSize: 5, sourceField: "list30" } },
    { pluginId: 'scheduler', enabled: false, config: {} },
  ],
});

const makeLinearWorkflowWithRemoteBatch = (): WorkflowDefinitionRuntime => ({
  ...makeLinearWorkflow(),
  plugins: [
    { pluginId: 'remote-batch', enabled: true, config: { url: "https://example.test/keywords", startBatch: 2, batchSize: 3, sourceField: "list30" } },
    { pluginId: 'scheduler', enabled: true, config: {} },
  ],
});

const makeAnyDependencyWorkflow = (): WorkflowDefinitionRuntime => ({
  ...makeLinearWorkflow(),
  nodes: [
    {
      ...makeLinearWorkflow().nodes[0],
      id: "n1",
      name: "up-a",
    },
    {
      ...makeLinearWorkflow().nodes[1],
      id: "n2",
      name: "up-b",
    },
    {
      ...makeLinearWorkflow().nodes[1],
      id: "n3",
      name: "join-any",
      dependencyPolicy: "any",
    },
  ],
  edges: [
    { from: "n1", to: "n3", when: null },
    { from: "n2", to: "n3", when: null },
  ],
});

const makeRouteWorkflow = (): WorkflowDefinitionRuntime => ({
  ...makeLinearWorkflow(),
  nodes: [
    {
      ...makeLinearWorkflow().nodes[0],
      id: "n1",
      name: "source",
    },
    {
      ...makeLinearWorkflow().nodes[1],
      id: "n3",
      name: "route-node",
      routePolicy: { allowed: ["yes", "no"] },
    },
    {
      ...makeLinearWorkflow().nodes[1],
      id: "n4",
      name: "yes-branch",
    },
    {
      ...makeLinearWorkflow().nodes[1],
      id: "n10",
      name: "no-branch",
    },
  ],
  edges: [
    { from: "n1", to: "n3", when: null },
    { from: "n3", to: "n4", when: "yes" },
    { from: "n3", to: "n10", when: "no" },
  ],
});

const run = async () => {
  let rejected = false;
  const batchController = createItemBatchController({
    pipelineId: "test-pipeline",
    executeBatch: async () => {
      throw new Error("boom");
    },
  });
  const started = batchController.start(["a", "b"], 1);
  assert.equal(started.ok, true, "batch run should start");
  await new Promise((resolve) => setTimeout(resolve, 20));
  const failedSnapshot = batchController.getSnapshot();
  assert.equal(failedSnapshot.status, "failed", "thrown batch error should close snapshot as failed");
  assert.equal(failedSnapshot.error, "boom");
  const restarted = batchController.start(["c"], 1);
  assert.equal(restarted.ok, true, "controller should accept new batch after handled failure");

  const graph = createWorkflowGraph(makeWorkflowWithParallelGroup());
  const helperStore = createRuntimeStore({
    graph,
    defaultItemKeys: ["kw-1"],
    runStateFile: join(process.cwd(), ".data", "test-run-state-scope.json"),
    initialRun: seedRunWithItems(graph.getTemplateNodes(), ["kw-1"]),
    getSchedulerState: () => ({ enabled: true, mode: "auto" }),
  });
  const stateHelpers = createRunStateHelpers({
    runtimeStore: helperStore,
    graph,
    defaultItemKeys: ["kw-1"],
  });
  const affected = stateHelpers.collectDownstreamSubgraph("n1");
  assert.deepEqual(
    [...affected.nodeIds].sort(),
    ["n1", "n2", "n3", "n4"],
    "replay scope should include parallel members and nodes behind the group",
  );
  assert.deepEqual([...affected.groupIds], ["g1"], "replay scope should preserve parallel group ids");

  const linearGraph = createWorkflowGraph(makeLinearWorkflow());
  const runtimeStore = createRuntimeStore({
    graph: linearGraph,
    defaultItemKeys: ["kw-1"],
    runStateFile: join(process.cwd(), ".data", "test-run-state.json"),
    initialRun: {
      id: "run-test",
      status: "running",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      nodes: linearGraph.getTemplateNodes().map((node) => ({
        id: node.id,
        title: node.title,
        executor: node.executor,
        instruction: node.instruction,
        outputSpec: node.outputSpec,
        allowReject: node.allowReject,
        maxRejectCount: node.maxRejectCount,
        status: node.id === "n1" ? "success" : "failed",
        dependsOn: node.dependsOn,
        artifacts: [],
        rejectFeedbacks: [],
        attempt: 1,
        rejectCount: 0,
        startedAt: null,
        finishedAt: null,
        lastError: null,
      })),
      itemRuns: [
        {
          id: "i1",
          nodeId: "n1",
          itemKey: "kw-1",
          status: "success",
          route: null,
          attempt: 1,
          loopCount: 0,
          wakeAt: null,
          startedAt: null,
          finishedAt: new Date().toISOString(),
          lastError: null,
          artifacts: [],
        },
        {
          id: "i2",
          nodeId: "n2",
          itemKey: "kw-1",
          status: "failed",
          route: null,
          attempt: 1,
          loopCount: 0,
          wakeAt: null,
          startedAt: null,
          finishedAt: new Date().toISOString(),
          lastError: "failed",
          artifacts: [],
        },
      ],
      groups: [],
      groupItemRuns: [],
    },
    getSchedulerState: () => ({ enabled: true, mode: "manual" }),
  });

  const replayScope = {
    getNodeById: (nodeId: string) => runtimeStore.getRun().nodes.find((node) => node.id === nodeId) ?? null,
    getItemRun: (nodeId: string, itemKey: string) =>
      (runtimeStore.getRun().itemRuns ?? []).find((item) => item.nodeId === nodeId && item.itemKey === itemKey) ?? null,
    getGroupItemRun: (groupId: string, itemKey: string) =>
      (runtimeStore.getRun().groupItemRuns ?? []).find((item) => item.groupId === groupId && item.itemKey === itemKey) ?? null,
    getGroupById: (groupId: string) => (runtimeStore.getRun().groups ?? []).find((group) => group.id === groupId) ?? null,
    ensureItemRuns: () => {},
    computeInitialItemStatus: (nodeId: string) => (linearGraph.getIncomingEdges(nodeId).length === 0 ? "queued" : "blocked"),
    computeInitialGroupItemStatus: (groupId: string) => (linearGraph.getIncomingEdges(groupId).length === 0 ? "queued" : "blocked"),
    collectDownstreamSubgraph: (nodeId: string) => {
      assert.equal(nodeId, "n2", "retry should compute downstream from target node");
      return { nodeIds: new Set(["n2"]), groupIds: new Set<string>() };
    },
    resetNodeForReplay: (node: { id: string; status: string; startedAt: string | null; finishedAt: string | null; lastError: string | null; artifacts: unknown[]; rejectFeedbacks: string[] }, opts?: { clearRejectFeedbacks?: boolean }) => {
      node.status = node.id === "n1" ? "success" : "blocked";
      node.startedAt = null;
      node.finishedAt = null;
      node.lastError = null;
      node.artifacts = [];
      if (opts?.clearRejectFeedbacks ?? true) node.rejectFeedbacks = [];
    },
    executeNodeItem: async (item: { nodeId: string; itemKey: string; status: string }) => {
      rejected = true;
      assert.equal(item.nodeId, "n2", "manual retry should immediately execute the now-ready target item");
      return { ok: true, finalStatus: "success", envelope: null };
    },
  };

  const scheduler = createSchedulerService({
    pipelineId: "test-pipeline",
    runtimeStore,
    graph: linearGraph,
    defaultItemKeys: ["kw-1"],
    executionService: replayScope as never,
  });
  scheduler.setSchedulerMode("manual");
  const retryResult = await scheduler.retryNodeExecution("n2", "kw-1");
  assert.equal(retryResult.ok, true, "manual retry should succeed when upstream dependencies are already satisfied");
  assert.equal(rejected, true, "manual retry should invoke executeNodeItem instead of returning node_retry_blocked");

  const explicitRunGraph = createWorkflowGraph(makeLinearWorkflowWithSchedulerPluginDisabled());
  const explicitRunStore = createRuntimeStore({
    graph: explicitRunGraph,
    defaultItemKeys: ["kw-1"],
    runStateFile: join(process.cwd(), ".data", "test-run-state-explicit-run.json"),
    initialRun: seedRunWithItems(explicitRunGraph.getTemplateNodes(), ["kw-1"]),
    getSchedulerState: () => ({ enabled: false, mode: "auto" }),
  });
  const explicitRunExecuted: string[] = [];
  const explicitRunScheduler = createSchedulerService({
    pipelineId: "test-pipeline",
    runtimeStore: explicitRunStore,
    graph: explicitRunGraph,
    defaultItemKeys: ["kw-1"],
    executionService: {
      getNodeById: (nodeId: string) => explicitRunGraph.getWorkflowNodeById(nodeId),
      getParallelGroupByMemberNodeId: (nodeId: string) => explicitRunGraph.getParallelGroupByMemberNodeId(nodeId),
      getItemRun: (nodeId: string, itemKey: string) =>
        (explicitRunStore.getRun().itemRuns ?? []).find((item) => item.nodeId === nodeId && item.itemKey === itemKey) ?? null,
      getGroupItemRun: () => null,
      computeInitialItemStatus: (nodeId: string) => (explicitRunGraph.getIncomingEdges(nodeId).length === 0 ? "queued" : "blocked"),
      computeInitialGroupItemStatus: (groupId: string) => (explicitRunGraph.getIncomingEdges(groupId).length === 0 ? "queued" : "blocked"),
      ensureItemRuns: () => {},
      collectDownstreamSubgraph: () => ({ nodeIds: new Set<string>(), groupIds: new Set<string>() }),
      resetNodeForReplay: () => {},
      executeGroupItem: async () => ({ ok: true, finalStatus: "success" }),
      executeNodeItem: async (item: { nodeId: string; status: string; startedAt?: string | null; finishedAt?: string | null }) => {
        explicitRunExecuted.push(item.nodeId);
        item.status = "success";
        item.startedAt = new Date().toISOString();
        item.finishedAt = new Date().toISOString();
        return { ok: true, finalStatus: "success", envelope: null };
      },
      setActiveBatchKeywordItems: () => {},
      onGatewayFrame: () => {},
      refreshSessionsFromGateway: async () => ({ items: [] }),
      getSessionCache: () => [],
      getExecutorSessionByAgentId: () => new Map(),
    } as never,
  });
  const explicitRunResult = await explicitRunScheduler.drainPipeline("run");
  assert.equal(explicitRunResult.executed, 2, "explicit run should execute even when scheduler plugin is disabled");
  assert.deepEqual(explicitRunExecuted, ["n1", "n2"], "explicit run should traverse the linear workflow in order");

  const batchRunStore = createRuntimeStore({
    graph: explicitRunGraph,
    defaultItemKeys: ["global"],
    runStateFile: join(process.cwd(), ".data", "test-run-state-batch.json"),
    initialRun: seedRunWithItems(explicitRunGraph.getTemplateNodes(), ["global"]),
    getSchedulerState: () => ({ enabled: false, mode: "auto" }),
  });
  const batchRunExecuted: string[] = [];
  const batchRunScheduler = createSchedulerService({
    pipelineId: "test-pipeline",
    runtimeStore: batchRunStore,
    graph: explicitRunGraph,
    defaultItemKeys: ["global"],
    executionService: {
      getNodeById: (nodeId: string) => batchRunStore.getRun().nodes.find((node) => node.id === nodeId) ?? null,
      getParallelGroupByMemberNodeId: (nodeId: string) => explicitRunGraph.getParallelGroupByMemberNodeId(nodeId),
      getItemRun: (nodeId: string, itemKey: string) =>
        (batchRunStore.getRun().itemRuns ?? []).find((item) => item.nodeId === nodeId && item.itemKey === itemKey) ?? null,
      getGroupItemRun: () => null,
      computeInitialItemStatus: (nodeId: string) => (explicitRunGraph.getIncomingEdges(nodeId).length === 0 ? "queued" : "blocked"),
      computeInitialGroupItemStatus: (groupId: string) => (explicitRunGraph.getIncomingEdges(groupId).length === 0 ? "queued" : "blocked"),
      ensureItemRuns: () => {},
      collectDownstreamSubgraph: () => ({ nodeIds: new Set<string>(), groupIds: new Set<string>() }),
      resetNodeForReplay: () => {},
      executeGroupItem: async () => ({ ok: true, finalStatus: "success" }),
      executeNodeItem: async (item: { nodeId: string; itemKey: string; status: string; startedAt?: string | null; finishedAt?: string | null }) => {
        batchRunExecuted.push(`${item.nodeId}#${item.itemKey}`);
        item.status = "success";
        item.startedAt = new Date().toISOString();
        item.finishedAt = new Date().toISOString();
        return { ok: true, finalStatus: "success", envelope: null };
      },
      setActiveBatchKeywordItems: () => {},
      onGatewayFrame: () => {},
      refreshSessionsFromGateway: async () => ({ items: [] }),
      getSessionCache: () => [],
      getExecutorSessionByAgentId: () => new Map(),
      abortRunControllers: () => {},
      getOrCreateDrainSignal: () => new AbortController().signal,
    } as never,
  });
  const batchStarted = batchRunScheduler.startBatchRun(["kw-1"], 1);
  assert.equal(batchStarted.ok, true, "batch run should start with one keyword");
  for (let i = 0; i < 20; i += 1) {
    if (batchRunScheduler.getBatchRunState().status !== "running") break;
    // 批跑控制器异步推进调度，这里轮询收敛即可，不把测试绑死在实现细节的微任务顺序上。
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(batchRunScheduler.getBatchRunState().status, "completed", "batch run should complete after downstream drains");
  assert.deepEqual(
    batchRunExecuted,
    ["n1#batch-1", "n2#batch-1"],
    "batch run should keep dispatching downstream items after the first node succeeds",
  );

  {
    const service = createPipelineService({
      getPipelineRuntime: () => ({
        workflow: { getWorkflow: () => makeLinearWorkflow(), getTemplateNodes: () => [] },
        runtime: { pushTimeline: () => {} },
        pipeline: { startBatchRun: () => ({ ok: true, snapshot: { status: "running" } }) },
      }),
    } as never);
    const disabledRemoteStart = await service.startRemoteBatchRun({ pipelineId: "A" });
    assert.equal(disabledRemoteStart.ok, false, "startRemoteBatchRun should fail when remoteBatch plugin is disabled");
    assert.equal(disabledRemoteStart.ok ? "" : disabledRemoteStart.error, "pipeline_plugin_disabled");
  }

  {
    const remoteBatchRunState = {
      status: "idle",
      batchSize: 10,
      totalItems: 0,
      totalBatches: 0,
      processedItems: 0,
      processedBatches: 0,
      nextBatchIndex: 1,
      startedAt: null,
      finishedAt: null,
      lastBatchItems: [],
      error: null,
      stopRequested: false,
    };
    let seededSingleRun = false;
    let startedRemoteBatch: { items: string[]; batchSize?: number; startIndex?: number } | null = null;
    const remoteBatchRuntime = {
      workflow: {
        getWorkflow: () => makeLinearWorkflowWithRemoteBatch(),
        getTemplateNodes: () => [],
      },
      runtime: {
        seedRun: () => {
          seededSingleRun = true;
          throw new Error("single_run_should_not_start_when_remote_batch_enabled");
        },
        setRun: () => {},
        pushTimeline: () => {},
        emitPipeline: () => {},
        touchRun: () => {},
        getRun: () => ({ id: "run-1" }),
      },
      pipeline: {
        getBatchRunState: () => remoteBatchRunState,
        startBatchRun: (items: string[], batchSize?: number, options?: { startIndex?: number }) => {
          startedRemoteBatch = {
            items: [...items],
            batchSize,
            startIndex: options?.startIndex,
          };
          return {
            ok: true as const,
            snapshot: {
              ...remoteBatchRunState,
              status: "running",
              batchSize: batchSize ?? remoteBatchRunState.batchSize,
              totalItems: items.length,
            },
          };
        },
        drainPipeline: async () => ({ executed: 0, hardFailed: false }),
      },
    };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      ({
        ok: true,
        text: async () => JSON.stringify({ list30: ["k1", "k2", "k3", "k4", "k5"] }),
      }) as Response) as typeof fetch;
    try {
      const service = createPipelineService({
        getPipelineRuntime: (pipelineId: string) => (pipelineId === "A" ? (remoteBatchRuntime as never) : null),
      } as never);
      const result = await service.runPipeline("A");
      assert.equal(result.ok, true, "remote batch enabled pipeline should start successfully");
      assert.equal(result.mode, "remote_batch", "runPipeline should switch to remote batch mode");
      assert.equal(seededSingleRun, false, "remote batch mode should not fall back to single run seeding");
      assert.deepEqual(
        startedRemoteBatch,
        {
          items: ["k1", "k2", "k3", "k4", "k5"],
          batchSize: 3,
          startIndex: 3,
        },
        "remote batch mode should honor plugin batch size and startBatch offset",
      );
      const remoteStartResult = await service.startRemoteBatchRun({
        pipelineId: "A",
        batchSize: 2,
        startBatch: 2,
      });
      assert.equal(remoteStartResult.ok, true, "startRemoteBatchRun should be available for HTTP start-remote path");
      assert.equal(remoteStartResult.ok ? remoteStartResult.totalFetched : 0, 5, "startRemoteBatchRun should expose fetched keyword size");
      assert.deepEqual(
        startedRemoteBatch,
        {
          items: ["k1", "k2", "k3", "k4", "k5"],
          batchSize: 2,
          startIndex: 2,
        },
        "startRemoteBatchRun should honor request-level batch overrides",
      );
      const localStartResult = service.startBatchRun({
        pipelineId: "A",
        items: ["kw-1", "kw-2", "kw-3"],
        batchSize: 2,
        startBatch: 2,
      });
      assert.equal(localStartResult.ok, true, "startBatchRun should start with explicit items");
      assert.deepEqual(
        startedRemoteBatch,
        {
          items: ["kw-1", "kw-2", "kw-3"],
          batchSize: 2,
          startIndex: 2,
        },
        "startBatchRun should map startBatch into startIndex for batch controller",
      );
      const emptyLocalStart = service.startBatchRun({
        pipelineId: "A",
        items: [],
      });
      assert.equal(emptyLocalStart.ok, false, "startBatchRun should reject empty item pools");
      assert.equal(emptyLocalStart.ok ? "" : emptyLocalStart.error, "batch_items_empty");
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  const singleRunKeywords = resolveActiveBatchKeywordsForInstruction(null, true);
  assert.deepEqual(
    singleRunKeywords,
    [],
    "single run should not append batch keywords when no active batch context exists",
  );

  const disabledSourceKeywords = resolveActiveBatchKeywordsForInstruction(["global"], false);
  assert.deepEqual(
    disabledSourceKeywords,
    [],
    "non-source nodes should never inherit batch keywords even if execution context carries item markers",
  );

  const activeBatchKeywords = resolveActiveBatchKeywordsForInstruction([" global ", "global", "foo"], true);
  assert.deepEqual(
    activeBatchKeywords,
    ["global", "foo"],
    "active batch keywords should be trimmed and deduplicated before prompt injection",
  );

  {
    const workflow = makeAnyDependencyWorkflow();
    const graph = createWorkflowGraph(workflow);
    const store = createRuntimeStore({
      graph,
      defaultItemKeys: ["kw-1"],
      runStateFile: join(process.cwd(), ".data", "test-run-state-any-policy.json"),
      initialRun: seedRunWithItems(graph.getTemplateNodes(), ["kw-1"]),
      getSchedulerState: () => ({ enabled: true, mode: "auto" }),
    });
    const state = createRunStateHelpers({
      runtimeStore: store,
      graph,
      defaultItemKeys: ["kw-1"],
    });
    const dependencyState = createDependencyState({
      runtimeStore: store,
      graph,
      ensureItemRuns: state.ensureItemRuns,
      getItemRun: state.getItemRun,
      getGroupItemRun: state.getGroupItemRun,
    });

    const upA = state.getItemRun("n1", "kw-1");
    const upB = state.getItemRun("n2", "kw-1");
    const joinAny = state.getItemRun("n3", "kw-1");
    assert.ok(upA && upB && joinAny);
    if (!upA || !upB || !joinAny) throw new Error("missing items");

    upA.status = "success";
    upB.status = "failed";
    joinAny.status = "blocked";
    dependencyState.markReadyItemsFromDependencies();
    assert.equal(joinAny.status, "queued", "dependencyPolicy:any should queue when at least one dependency succeeds");

    upA.status = "failed";
    upB.status = "failed";
    joinAny.status = "blocked";
    dependencyState.markReadyItemsFromDependencies();
    assert.equal(joinAny.status, "skipped", "dependencyPolicy:any should skip when all dependencies become impossible");
  }

  {
    const workflow = makeRouteWorkflow();
    const graph = createWorkflowGraph(workflow);
    const store = createRuntimeStore({
      graph,
      defaultItemKeys: ["kw-1"],
      runStateFile: join(process.cwd(), ".data", "test-run-state-route-policy.json"),
      initialRun: seedRunWithItems(graph.getTemplateNodes(), ["kw-1"]),
      getSchedulerState: () => ({ enabled: true, mode: "auto" }),
    });
    const state = createRunStateHelpers({
      runtimeStore: store,
      graph,
      defaultItemKeys: ["kw-1"],
    });
    const routeItemManager = createRouteItemManager({
      runtimeStore: store,
      graph,
      state,
    });
    const dependencyState = createDependencyState({
      runtimeStore: store,
      graph,
      ensureItemRuns: state.ensureItemRuns,
      getItemRun: state.getItemRun,
      getGroupItemRun: state.getGroupItemRun,
    });

    const source = state.getItemRun("n3", "kw-1");
    const yesBase = state.getItemRun("n4", "kw-1");
    assert.ok(source && yesBase);
    if (!source || !yesBase) throw new Error("missing route items");

    source.status = "success";
    source.route = null;
    source.finishedAt = new Date().toISOString();
    source.artifacts = [];
    await routeItemManager.applyEnvelopeOutcomeToItem(source, {
      version: "2.0",
      runId: "run-route",
      nodeId: "n3",
      requestId: "req-route",
      sessionId: "agent:router:main",
      status: "success",
      artifacts: [
        {
          type: "route.v1",
          schemaVersion: 1,
          name: "route",
          content: [{ route: "yes" }],
          meta: {},
        },
      ],
      control: { sleepUntil: null, retryFromNodeId: null },
      logs: [],
      error: null,
    });

    dependencyState.markReadyItemsFromDependencies();
    const yesDerived = state.getItemRun("n4", "kw-1::n3:yes");
    assert.ok(yesDerived, "yes route should spawn derived downstream item");
    assert.equal(yesDerived?.status, "queued", "n3=yes should queue n4 exactly on yes-derived key");
    assert.equal(yesBase.status, "skipped", "base key should not be routed to n4 after route split");

    source.status = "success";
    source.route = null;
    source.finishedAt = new Date().toISOString();
    await routeItemManager.applyEnvelopeOutcomeToItem(source, {
      version: "2.0",
      runId: "run-route",
      nodeId: "n3",
      requestId: "req-route-2",
      sessionId: "agent:router:main",
      status: "success",
      artifacts: [
        {
          type: "route.v1",
          schemaVersion: 1,
          name: "route",
          content: [{ route: "no" }],
          meta: {},
        },
      ],
      control: { sleepUntil: null, retryFromNodeId: null },
      logs: [],
      error: null,
    });
    dependencyState.markReadyItemsFromDependencies();
    const noDerivedForN4 = state.getItemRun("n4", "kw-1::n3:no");
    assert.equal(noDerivedForN4?.status, "skipped", "n3!=yes should keep n4 out of execution path");
  }

  console.log("pipeline regression tests passed");
};

void run().catch((error) => {
  console.error("pipeline regression tests failed", error);
  process.exitCode = 1;
});
