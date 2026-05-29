import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

const createGatewayClientStub = () =>
  ({
    connect: async () => ({ ok: true }),
    close: () => {},
    sendReq: async () => ({}),
    onEvent: () => () => {},
    getStatus: () => ({ status: "idle", protocol: null, scopes: [], lastError: null }),
    getSocket: () => null,
  }) as const;

const requestJson = async <T>(baseUrl: string, path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`${baseUrl}${path}`, init);
  const body = (await response.json().catch(() => null)) as T | { error?: string } | null;
  if (!response.ok) {
    throw new Error(`request_failed:${path}:${JSON.stringify(body)}`);
  }
  return body as T;
};

const run = async () => {
  const prevCwd = process.cwd();
  const workspace = mkdtempSync(join(tmpdir(), "openclaw-pipeline-management-"));
  process.chdir(workspace);

  // 先切工作目录再加载模块，保证 pipeline-config 里的 cwd 相关常量指向临时工作区。
  const { createApiHandler } = require("../src/server/api-handler");
  const { createPipelineRegistry } = require("../src/app/pipeline-registry");
  const { loadWorkflowDefinitionWithStorage, saveWorkflowDefinitionWithStorage } = require("../src/pipeline/template");
  const normalizeForRuntimeShape = (workflow: Record<string, unknown>) => ({
    ...workflow,
    edges: Array.isArray(workflow.edges)
      ? workflow.edges.map((edge) => {
          const record = edge as Record<string, unknown>;
          if (typeof record.kind === "string") {
            return {
              from: String(record.from ?? ""),
              to: String(record.to ?? ""),
              when: record.kind === "dependency" ? null : String(record.route ?? ""),
            };
          }
          return record;
        })
      : [],
  });
  const readBroadcastPipelines = (payload: unknown): Record<string, { title?: string }> => {
    const record = payload && typeof payload === "object" ? (payload as { pipelines?: Record<string, { title?: string }> }) : null;
    return record?.pipelines ?? {};
  };

  const app = createPipelineRegistry({
    client: createGatewayClientStub() as never,
    webOrigin: "*",
    defaultItemKeys: ["global"],
  });
  await app.initialize();
  const wsEvents: Array<{ type?: string; payload?: unknown }> = [];
  app.runtime.setBroadcast((payload: unknown) => {
    wsEvents.push(payload as { type?: string; payload?: unknown });
  });

  const sourceDefinition = app.getPipelineDefinition("A");
  assert.ok(sourceDefinition, "默认流水线 A 应存在");
  const sourceWorkflow = loadWorkflowDefinitionWithStorage({ workflowFilePath: sourceDefinition.workflowFilePath });
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
  ];
  saveWorkflowDefinitionWithStorage(sourceWorkflow, { workflowFilePath: sourceDefinition.workflowFilePath });

  const server = createServer(
    createApiHandler({
      apiPort: 0,
      webOrigin: "*",
      app,
      serverRuntimeIdentity: {
        serverId: "test-server",
        pid: 1,
        port: 0,
        endpoint: "http://127.0.0.1:0",
        startedAt: "2026-05-09T00:00:00.000Z",
      },
    }),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const runtimeA = app.getPipelineRuntime("A");
    assert.ok(runtimeA, "默认流水线 A 应存在运行时");
    runtimeA.workflow.setWorkflow(sourceWorkflow);
    const runningRun = runtimeA.runtime.seedRun(runtimeA.workflow.getTemplateNodes());
    runtimeA.runtime.setRun({
      ...runningRun,
      status: "running",
      nodes: runningRun.nodes.map((node: { status: string }, index: number) => (index === 0 ? { ...node, status: "running" } : node)),
    });
    const singleStop = await requestJson<{ ok: boolean; mode?: string; status?: { runStatus?: string } }>(
      baseUrl,
      "/api/pipelines/A/stop",
      {
        method: "POST",
      },
    );
    assert.equal(singleStop.ok, true, "单跑运行中应支持统一停止");
    assert.equal(singleStop.mode, "single", "单跑停止应返回 single 模式");
    assert.equal(singleStop.status?.runStatus, "stopped", "单跑停止后状态应进入 stopped");

    const created = await requestJson<{ ok: boolean; item?: { id: string; title: string } }>(baseUrl, "/api/pipelines", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "C",
        title: "流水线 DAG-C",
        cloneFrom: "A",
      }),
    });
    assert.equal(created.ok, true, "克隆创建应成功");
    assert.equal(created.item?.id, "C");
    const createBootstrapEvent = wsEvents.at(-1);
    assert.equal(createBootstrapEvent?.type, "bootstrap", "新增流水线后应广播 bootstrap 全量快照");
    assert.equal(Boolean(readBroadcastPipelines(createBootstrapEvent?.payload).C), true, "新增流水线广播中应包含新流水线 C");

    const clonedDefinition = app.getPipelineDefinition("C");
    assert.ok(clonedDefinition, "新建流水线 C 应已注册");
    const clonedWorkflowFromApi = await requestJson<{ workflow?: unknown }>(baseUrl, "/api/pipelines/C/workflow");
    const clonedWorkflow = JSON.parse(readFileSync(clonedDefinition.workflowFilePath, "utf8")) as unknown;
    const currentSourceWorkflow = JSON.parse(readFileSync(sourceDefinition.workflowFilePath, "utf8")) as Record<string, unknown>;
    assert.deepEqual(clonedWorkflow, currentSourceWorkflow, "cloneFrom 应复制源 workflow");
    assert.deepEqual(
      clonedWorkflowFromApi.workflow,
      normalizeForRuntimeShape(currentSourceWorkflow),
      "cloneFrom 后 runtime 读取到的 workflow 应与源图语义一致",
    );
    const roundtripResponse = await fetch(`${baseUrl}/api/pipelines/C/workflow`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workflow: clonedWorkflowFromApi.workflow,
      }),
    });
    assert.equal(roundtripResponse.status, 200, "GET /workflow 的响应应可直接 POST 回写");
    const roundtripDiskWorkflow = JSON.parse(readFileSync(clonedDefinition.workflowFilePath, "utf8")) as { edges?: unknown[] };
    assert.equal(
      Array.isArray(roundtripDiskWorkflow.edges) && roundtripDiskWorkflow.edges.every((edge) => {
        const record = edge as Record<string, unknown>;
        return typeof record.kind === "string";
      }),
      true,
      "roundtrip 保存后磁盘仍应保持 v3 kind/route 形状",
    );

    const mixedEdgeWorkflowResponse = await fetch(`${baseUrl}/api/pipelines/C/workflow`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workflow: {
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
        },
      }),
    });
    assert.equal(mixedEdgeWorkflowResponse.status, 400, "危险混合出边保存应失败");
    const mixedEdgeWorkflowBody = (await mixedEdgeWorkflowResponse.json()) as { error?: string; detail?: string };
    assert.equal(mixedEdgeWorkflowBody.error, "mixed_outgoing_edge_kinds_forbidden");
    assert.equal(typeof mixedEdgeWorkflowBody.detail, "string", "失败响应应透传可操作 detail");

    const v2WorkflowResponse = await fetch(`${baseUrl}/api/pipelines/C/workflow`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workflow: {
          ...currentSourceWorkflow,
          version: "2.0",
        },
      }),
    });
    assert.equal(v2WorkflowResponse.status, 400, "Phase 4 应要求先执行 v2->v3 迁移");
    const v2WorkflowBody = (await v2WorkflowResponse.json()) as { error?: string };
    assert.equal(v2WorkflowBody.error, "workflow_migration_required");

    writeFileSync(clonedDefinition.workflowFilePath, "{invalid-json", "utf8");
    const repairWorkflowResponse = await fetch(`${baseUrl}/api/pipelines/C/workflow`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workflow: currentSourceWorkflow,
      }),
    });
    assert.equal(repairWorkflowResponse.status, 400, "坏盘场景应返回结构化 400 而非未捕获异常");
    const repairWorkflowBody = (await repairWorkflowResponse.json()) as { error?: string; detail?: string; pipelineId?: string };
    assert.equal(repairWorkflowBody.error, "invalid_persisted_workflow_definition");
    assert.equal(typeof repairWorkflowBody.detail, "string", "坏盘场景应透传 detail");
    assert.equal(repairWorkflowBody.pipelineId, "C", "坏盘场景应透传 pipelineId");
    writeFileSync(clonedDefinition.workflowFilePath, JSON.stringify(currentSourceWorkflow, null, 2), "utf8");

    const renamed = await requestJson<{ ok: boolean; item?: { id: string; title: string } }>(baseUrl, "/api/pipelines/C", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "流水线 DAG-C-重命名",
      }),
    });
    assert.equal(renamed.ok, true, "标题修改应成功");
    assert.equal(renamed.item?.title, "流水线 DAG-C-重命名");
    const renameBootstrapEvent = wsEvents.at(-1);
    assert.equal(renameBootstrapEvent?.type, "bootstrap", "重命名流水线后应广播 bootstrap 全量快照");
    assert.equal(
      readBroadcastPipelines(renameBootstrapEvent?.payload).C?.title,
      "流水线 DAG-C-重命名",
      "重命名广播中应包含最新标题",
    );

    const listAfterRename = await requestJson<{ items: Array<{ id: string; title: string }> }>(baseUrl, "/api/pipelines");
    assert.equal(
      listAfterRename.items.find((item) => item.id === "C")?.title,
      "流水线 DAG-C-重命名",
      "标题修改后列表应立即可见",
    );

    const deleted = await requestJson<{ ok: boolean; pipelineId?: string }>(baseUrl, "/api/pipelines/C", {
      method: "DELETE",
    });
    assert.equal(deleted.ok, true, "删除流水线应成功");
    assert.equal(deleted.pipelineId, "C");
    const deleteBootstrapEvent = wsEvents.at(-1);
    assert.equal(deleteBootstrapEvent?.type, "bootstrap", "删除流水线后应广播 bootstrap 全量快照");
    assert.equal(Boolean(readBroadcastPipelines(deleteBootstrapEvent?.payload).C), false, "删除流水线广播中不应再包含 C");

    const listAfterDelete = await requestJson<{ items: Array<{ id: string; title: string }> }>(baseUrl, "/api/pipelines");
    assert.equal(
      listAfterDelete.items.some((item) => item.id === "C"),
      false,
      "删除后 definitions 列表中不应再包含 C",
    );

    const archivedDirs = readdirSync(join(workspace, ".data", "pipelines", "_deleted"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith("C-"))
      .map((entry) => entry.name);
    assert.ok(archivedDirs.length > 0, "删除后应生成 C 的归档目录");

    const archivedWorkflow = join(workspace, ".data", "pipelines", "_deleted", archivedDirs[0], "workflow.json");
    const archivedWorkflowContent = JSON.parse(readFileSync(archivedWorkflow, "utf8")) as unknown;
    assert.deepEqual(archivedWorkflowContent, currentSourceWorkflow, "归档目录应保留删除前 workflow");

    console.log("pipeline management tests passed");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    app.dispose();
    process.chdir(prevCwd);
  }
};

void run().catch((error) => {
  console.error("pipeline management tests failed", error);
  process.exitCode = 1;
});
