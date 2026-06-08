import assert from "node:assert/strict"
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const createGatewayClientStub = () =>
  ({
    connect: async () => ({ ok: true }),
    close: () => {},
    sendReq: async () => ({}),
    onEvent: () => () => {},
    getStatus: () => ({ status: "idle", protocol: null, scopes: [], lastError: null }),
    getSocket: () => null,
  }) as const

const run = async () => {
  const prevCwd = process.cwd()
  const workspace = mkdtempSync(join(tmpdir(), "openclaw-pipeline-management-"))
  process.chdir(workspace)

  const { createPipelineRegistry } = require("../src/app/pipeline-registry")
  const { loadWorkflowDefinitionWithStorage, saveWorkflowDefinitionWithStorage } = require("../src/pipeline/template")
  const { createPipelineService } = require("../src/services/pipeline-service")
  const { createSchedulerService } = require("../src/services/scheduler-service")
  const normalizeForRuntimeShape = (workflow: Record<string, unknown>) => ({
    ...workflow,
    edges: Array.isArray(workflow.edges)
      ? workflow.edges.map((edge) => {
          const record = edge as Record<string, unknown>
          if (typeof record.kind === "string") {
            return {
              from: String(record.from ?? ""),
              to: String(record.to ?? ""),
              when: record.kind === "dependency" ? null : String(record.route ?? ""),
            }
          }
          return record
        })
      : [],
  })
  const readBroadcastPipelines = (payload: unknown): Record<string, { title?: string }> => {
    const record =
      payload && typeof payload === "object" ? (payload as { pipelines?: Record<string, { title?: string }> }) : null
    return record?.pipelines ?? {}
  }

  const app = createPipelineRegistry({
    client: createGatewayClientStub() as never,
    webOrigin: "*",
    defaultItemKeys: ["global"],
  })
  await app.initialize()
  const wsEvents: Array<{ type?: string; payload?: unknown }> = []
  app.runtime.setBroadcast((payload: unknown) => {
    wsEvents.push(payload as { type?: string; payload?: unknown })
  })

  const pipelineService = createPipelineService(app)
  const schedulerService = createSchedulerService(app)

  // No default pipelines — create one explicitly for testing
  await app.createPipeline({ id: "A", title: "Pipeline A" })

  const sourceDefinition = app.getPipelineDefinition("A")
  assert.ok(sourceDefinition, "显式创建的流水线 A 应存在")
  const sourceWorkflow = loadWorkflowDefinitionWithStorage({ workflowFilePath: sourceDefinition.workflowFilePath })
  sourceWorkflow.nodes = [
    {
      id: "clone-source",
      name: "clone-source-node",
      type: "task",
      enabled: true,
      isMainline: true,
      lane: "main",
      parallelGroupId: null,
      executor: { agentId: "agent-a", role: "coder", fallbackAgentId: null, sessionId: null },
      inputMode: "single",
      outputMode: "single",
      dependencyPolicy: "all",
      routePolicy: null,
      retryPolicy: { maxAttempts: 1, backoffMs: 0 },
      outputSpec: { type: "patch.v1", schemaVersion: 1 },
      instruction: "用于克隆测试的显式工作流节点",
      allowReject: false,
      maxRejectCount: 0,
    },
  ]
  saveWorkflowDefinitionWithStorage(sourceWorkflow, { workflowFilePath: sourceDefinition.workflowFilePath })

  try {
    const runtimeA = app.getPipelineRuntime("A")
    assert.ok(runtimeA, "默认流水线 A 应存在运行时")
    runtimeA.workflow.setWorkflow(sourceWorkflow)
    const runningRun = runtimeA.runtime.seedRun(runtimeA.workflow.getTemplateNodes())
    runtimeA.runtime.setRun({
      ...runningRun,
      status: "running",
      nodes: runningRun.nodes.map((node: { status: string }, index: number) =>
        index === 0 ? { ...node, status: "running" } : node,
      ),
    })
    // 通过内部 API 停止运行
    const stopped = pipelineService.stopPipeline("A")
    assert.equal(stopped.ok, true, "单跑运行中应支持统一停止")
    assert.equal(stopped.mode, "single", "单跑停止应返回 single 模式")
    assert.equal(stopped.status?.runStatus, "stopped", "单跑停止后状态应进入 stopped")

    // 克隆创建
    const created = await app.createPipeline({
      id: "C",
      title: "流水线 DAG-C",
      cloneFrom: "A",
    })
    assert.equal(created.id, "C")
    const createBootstrapEvent = wsEvents.at(-1)
    assert.equal(createBootstrapEvent?.type, "bootstrap", "新增流水线后应广播 bootstrap 全量快照")
    assert.equal(
      Boolean(readBroadcastPipelines(createBootstrapEvent?.payload).C),
      true,
      "新增流水线广播中应包含新流水线 C",
    )

    const clonedDefinition = app.getPipelineDefinition("C")
    assert.ok(clonedDefinition, "新建流水线 C 应已注册")
    const clonedWorkflow = JSON.parse(readFileSync(clonedDefinition.workflowFilePath, "utf8")) as unknown
    const currentSourceWorkflow = JSON.parse(readFileSync(sourceDefinition.workflowFilePath, "utf8")) as Record<
      string,
      unknown
    >
    assert.deepEqual(clonedWorkflow, currentSourceWorkflow, "cloneFrom 应复制源 workflow")

    // 通过 runtime 读取 workflow
    const clonedRuntime = app.getPipelineRuntime("C")
    assert.ok(clonedRuntime, "克隆流水线应有运行时")
    const clonedWorkflowFromApi = clonedRuntime.workflow.getWorkflow()
    assert.deepEqual(
      clonedWorkflowFromApi,
      normalizeForRuntimeShape(currentSourceWorkflow),
      "cloneFrom 后 runtime 读取到的 workflow 应与源图语义一致",
    )

    // roundtrip 保存
    const {
      readWorkflowDefinitionFromRawDetailed,
      normalizeWorkflowFallbacksWithStorage,
    } = require("../src/pipeline/template")
    const { validateWorkflowGraph } = require("../src/pipeline/workflow/validate")
    const parseResult = readWorkflowDefinitionFromRawDetailed(clonedWorkflowFromApi)
    assert.equal(parseResult.ok, true, "GET workflow 结果应可解析")
    const normalized = normalizeWorkflowFallbacksWithStorage(parseResult.workflow, {
      workflowFilePath: clonedDefinition.workflowFilePath,
    })
    const validation = validateWorkflowGraph(normalized)
    assert.equal(validation.ok, true, "GET workflow 结果验证应通过")
    clonedRuntime.workflow.setWorkflow(normalized)
    saveWorkflowDefinitionWithStorage(normalized, { workflowFilePath: clonedDefinition.workflowFilePath })
    const roundtripDiskWorkflow = JSON.parse(readFileSync(clonedDefinition.workflowFilePath, "utf8")) as {
      edges?: unknown[]
    }
    assert.equal(
      Array.isArray(roundtripDiskWorkflow.edges) &&
        roundtripDiskWorkflow.edges.every((edge) => {
          const record = edge as Record<string, unknown>
          return typeof record.kind === "string"
        }),
      true,
      "roundtrip 保存后磁盘仍应保持 v3 kind/route 形状",
    )

    // 危险混合出边 — parser no longer validates graph structure (L2), only L1 data integrity
    const mixedParseResult = readWorkflowDefinitionFromRawDetailed({
      ...currentSourceWorkflow,
      nodes: [
        {
          ...(currentSourceWorkflow.nodes as Array<Record<string, unknown>>)[0],
          id: "n1",
          name: "mixed-source",
          routePolicy: null,
        },
        {
          ...(currentSourceWorkflow.nodes as Array<Record<string, unknown>>)[0],
          id: "n2",
          name: "mixed-dependency-target",
        },
        {
          ...(currentSourceWorkflow.nodes as Array<Record<string, unknown>>)[0],
          id: "n3",
          name: "mixed-route-target",
          lane: "branch",
        },
      ],
      edges: [
        { from: "n1", to: "n2", kind: "dependency" },
        { from: "n1", to: "n3", kind: "route", route: "yes" },
      ],
    })
    assert.equal(mixedParseResult.ok, true, "混合出边数据应能正常解析 (L1 通过)")
    const mixedValidation = validateWorkflowGraph(mixedParseResult.workflow)
    assert.equal(mixedValidation.ok, false, "危险混合出边应被 L2 图校验拒绝")
    assert.equal(mixedValidation.error, "mixed_outgoing_edge_kinds_forbidden")

    // v2 workflow 迁移
    const v2ParseResult = readWorkflowDefinitionFromRawDetailed({
      ...currentSourceWorkflow,
      version: "2.0",
    })
    assert.equal(v2ParseResult.ok, false, "Phase 4 应拒绝 v2 版本")
    assert.equal(v2ParseResult.error, "workflow_migration_required")

    // 坏盘场景
    writeFileSync(clonedDefinition.workflowFilePath, "{invalid-json", "utf8")
    const badParseResult = readWorkflowDefinitionFromRawDetailed(currentSourceWorkflow)
    assert.equal(badParseResult.ok, true, "从内存参数读取应成功")
    let badNormalized
    try {
      badNormalized = normalizeWorkflowFallbacksWithStorage(badParseResult.workflow, {
        workflowFilePath: clonedDefinition.workflowFilePath,
      })
    } catch (error) {
      const err = error as Error & { detail?: string }
      assert.equal(err.message, "invalid_persisted_workflow_definition", "坏盘场景应返回结构化错误")
      assert.equal(typeof err.detail, "string", "坏盘场景应透传 detail")
    }
    writeFileSync(clonedDefinition.workflowFilePath, JSON.stringify(currentSourceWorkflow, null, 2), "utf8")

    // 重命名
    const renamed = app.renamePipeline("C", "流水线 DAG-C-重命名")
    assert.equal(renamed.title, "流水线 DAG-C-重命名")
    const renameBootstrapEvent = wsEvents.at(-1)
    assert.equal(renameBootstrapEvent?.type, "bootstrap", "重命名流水线后应广播 bootstrap 全量快照")
    assert.equal(
      readBroadcastPipelines(renameBootstrapEvent?.payload).C?.title,
      "流水线 DAG-C-重命名",
      "重命名广播中应包含最新标题",
    )

    const listAfterRename = app.listPipelines()
    assert.equal(
      listAfterRename.find((item: { id: string; title: string }) => item.id === "C")?.title,
      "流水线 DAG-C-重命名",
      "标题修改后列表应立即可见",
    )

    // 删除
    const deleted = app.deletePipeline("C")
    assert.equal(deleted.pipelineId, "C")
    const deleteBootstrapEvent = wsEvents.at(-1)
    assert.equal(deleteBootstrapEvent?.type, "bootstrap", "删除流水线后应广播 bootstrap 全量快照")
    assert.equal(
      Boolean(readBroadcastPipelines(deleteBootstrapEvent?.payload).C),
      false,
      "删除流水线广播中不应再包含 C",
    )

    const listAfterDelete = app.listPipelines()
    assert.equal(
      listAfterDelete.some((item: { id: string }) => item.id === "C"),
      false,
      "删除后 definitions 列表中不应再包含 C",
    )

    const archivedDirs = readdirSync(join(workspace, ".data", "pipelines", "_deleted"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith("C-"))
      .map((entry) => entry.name)
    assert.ok(archivedDirs.length > 0, "删除后应生成 C 的归档目录")

    const archivedWorkflow = join(workspace, ".data", "pipelines", "_deleted", archivedDirs[0], "workflow.json")
    const archivedWorkflowContent = JSON.parse(readFileSync(archivedWorkflow, "utf8")) as unknown
    assert.deepEqual(archivedWorkflowContent, currentSourceWorkflow, "归档目录应保留删除前 workflow")

    console.log("pipeline management tests passed")
  } finally {
    app.dispose()
    process.chdir(prevCwd)
  }
}

void run().catch((error) => {
  console.error("pipeline management tests failed", error)
  process.exitCode = 1
})
