import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../src/cli";
import { resolveHelpHint, resolveHelpHintByRouteKey } from "../src/cli/help";
import { CLI_ROUTES } from "../src/cli/router";
import type { CliBootstrap } from "../src/cli/types";

const createMemoryStream = () => {
  let content = "";
  return {
    stream: {
      write(chunk: string | Uint8Array) {
        content += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
        return true;
      },
    } as unknown as NodeJS.WritableStream,
    read: () => content,
  };
};

const createMockServerService = () => ({
  ensureServerReady: async () => ({ ok: true, action: "ensured", endpoint: "http://127.0.0.1:54320", reused: true, pid: 123, startedAt: "2026-05-08T00:00:00.000Z" }),
  startServer: async () => ({ ok: true, action: "started", endpoint: "http://127.0.0.1:54320", reused: false, pid: 123, startedAt: "2026-05-08T00:00:00.000Z" }),
  getServerStatus: async () => ({ ok: true, endpoint: "http://127.0.0.1:54320", ready: true, metadataPresent: true, pid: 123, pidRunning: true, startedAt: "2026-05-08T00:00:00.000Z" }),
  stopServer: async () => ({ ok: true, action: "stopped", endpoint: "http://127.0.0.1:54320", reused: false, pid: 123, startedAt: "2026-05-08T00:00:00.000Z" }),
});

const serverRuntimeDir = join(tmpdir(), "taskmeld-cli-spec-server-runtime");
const serverRuntimeMetadataPath = join(serverRuntimeDir, "runtime.json");
process.env.TASKMELD_SERVER_RUNTIME_DIR = serverRuntimeDir;
const { createPipelineRuntimeApiClientWs: createPipelineRuntimeApiClient, createServerLifecycleClient } = require("../src/cli/server-runtime-client") as typeof import("../src/cli/server-runtime-client");

const createReadonlyBootstrap = (): CliBootstrap => {
  return async () => ({
    app: {
      systemService: {
        getSnapshot: async () => ({
          generatedAt: "2026-05-08T00:00:00.000Z",
          pipelines: [{ id: "A", title: "流水线 DAG-A" }],
        }),
      },
      serverService: createMockServerService(),
      pipelineService: {
        listPipelines: async () => [{ id: "A", title: "流水线 DAG-A" }],
        getPipelineById: async (pipelineId: string) => (pipelineId === "A" ? { pipelineId } : null),
        startPipeline: async (pipelineId: string) => ({ ok: true, mode: "single", pipelineId, accepted: true, runId: "run-1", run: { id: "run-1", status: "running" } }),
        getPipelineStatus: async (pipelineId: string) => ({
          ok: true,
          pipelineId,
          running: false,
          message: "no active pipeline run",
          lastCompletedAt: "2026-05-08T00:00:00.000Z",
        }),
        stopPipeline: async (pipelineId: string) => ({ ok: false, pipelineId, error: "batch_run_not_running" }),
        runPipeline: async (pipelineId: string) => ({ ok: true, pipelineId }),
        retryNode: async () => ({ ok: true }),
        diagnoseNode: async () => ({ diagnostics: [] }),
        getOutput: async () => null,
        listOutputs: async () => [],
        listLinks: async () => [],
        getQueue: async () => [],
      },
      agentService: {
        listAgents: async () => [
          {
            id: "validator",
            raw: {
              id: "validator",
              name: "validator",
              workspace: "/home/cclucky/.openclaw/workspace-validator",
              agentRuntime: {
                id: "pi",
                source: "implicit",
              },
              model: {
                primary: "minimax/MiniMax-M2.7",
                fallbacks: [
                  "xiaomi/mimo-v2-pro",
                  "minimax/MiniMax-M2.7",
                  "xiaomi/mimo-v2.5",
                  "xiaomi/mimo-v2.5-pro",
                ],
              },
            },
            lastActiveAtMs: 1778226657400,
            lastActiveAt: "2026-05-08T01:02:03.000Z",
          },
        ],
        listSessions: async () => [],
        filterSessionsByAgent: async () => [],
        sendMessage: async () => ({ ok: true }), getSessionHistory: async () => [], sendMessageAndWaitForReply: async () => ({ sent: {}, reply: null }),
      },
      sessionService: {
        listSessions: async () => [],
        sendMessage: async () => ({ ok: true }),
      },
      artifactService: {
        listArtifacts: async () => ({ items: [] }), getArtifactContent: async () => null, exportArtifacts: async () => ({}), planCleanup: async () => ({ files: [], totalSizeBytes: 0, oldestDate: null, newestDate: null }), executeCleanup: async () => ({ deleted: 0, failed: 0, warnings: [] }), rebuildIndex: async () => ({ indexed: 0, skipped: 0, warnings: [] }),
      },
      schedulerService: {
        toggleScheduler: async () => ({ ok: true }),
        setSchedulerMode: async () => ({ ok: true }),
      },
    },
  });
};

const assertHelpOutput = (text: string, expectedHints: RegExp[]) => {
  assert.ok(text.trim().length > 0, "帮助文本不应为空");
  for (const hint of expectedHints) {
    assert.ok(hint.test(text), `帮助文本应包含提示: ${hint.source}`);
  }
};

const run = async () => {
  {
    const out = createMemoryStream();
    const err = createMemoryStream();
    const exitCode = await runCli(
      { bootstrap: createReadonlyBootstrap() },
      {
        argv: ["pipeline", "list", "--format", "json", "--envelope"],
        stdout: out.stream,
        stderr: err.stream,
      },
    );
    assert.equal(exitCode, 0, "format json + envelope 成功命令应返回 exitCode=0");
    assert.equal(err.read(), "", "format json + envelope 成功命令不应输出 stderr");
    const payload = JSON.parse(out.read()) as {
      ok: boolean;
      command: string;
      data: Array<{ ID: string; Title: string }>;
      meta: { ts: string };
    };
    assert.equal(payload.ok, true, "format json + envelope 应包含 ok=true");
    assert.equal(payload.command, "pipeline.list", "format json + envelope 应包含命令名");
    assert.ok(Array.isArray(payload.data), "format json + envelope data 应保留业务数据");
    assert.equal(payload.data[0]?.ID, "A", "format json + envelope 应保留业务数据内容");
    assert.ok(typeof payload.meta?.ts === "string", "format json + envelope 应包含时间戳");
  }

  {
    const out = createMemoryStream();
    const err = createMemoryStream();
    const exitCode = await runCli(
      { bootstrap: createReadonlyBootstrap() },
      {
        argv: ["agent", "list", "--format", "md"],
        stdout: out.stream,
        stderr: err.stream,
      },
    );
    assert.equal(exitCode, 0, "agent list --format md 成功命令应返回 exitCode=0");
    assert.equal(err.read(), "", "agent list --format md 成功命令不应输出 stderr");
    const md = out.read();
    assert.match(md, /^# Agent List/m, "agent list --format md 标题应稳定");
    assert.match(md, /\| Agent ID \| Name \| Workspace \| Runtime \| Model Primary \| Last Active At \|/m, "agent list --format md 表头应包含扩展字段");
  }

  {
    const out = createMemoryStream();
    const err = createMemoryStream();
    const exitCode = await runCli(
      { bootstrap: createReadonlyBootstrap() },
      {
        argv: ["agent", "list", "--format", "md"],
        stdout: out.stream,
        stderr: err.stream,
      },
    );
    assert.equal(exitCode, 0, "agent list markdown 成功命令应返回 exitCode=0");
    assert.equal(err.read(), "", "agent list markdown 成功命令不应输出 stderr");
    const md = out.read();
    assert.match(md, /^# Agent List/m, "agent list markdown 标题应稳定");
    assert.match(md, /\| Agent ID \| Name \| Workspace \| Runtime \| Model Primary \| Last Active At \|/m, "agent list markdown 表头应包含扩展字段");
    assert.match(md, /validator/, "agent list markdown 应保留 agent id 和 name");
    assert.match(md, /workspace-validator/, "agent list markdown 应显示 workspace");
    assert.match(md, /minimax\/MiniMax-M2.7/, "agent list markdown 应显示主模型");
  }

  {
    const out = createMemoryStream();
    const err = createMemoryStream();
    const exitCode = await runCli(
      { bootstrap: createReadonlyBootstrap() },
      {
        argv: ["pipeline", "start", "A", "--format", "json"],
        stdout: out.stream,
        stderr: err.stream,
      },
    );
    assert.equal(exitCode, 0, "pipeline start 单跑应返回 exitCode=0");
    assert.equal(err.read(), "", "pipeline start 成功不应输出 stderr");
    const payload = JSON.parse(out.read()) as { ok?: boolean; command?: string; data?: { basic?: Record<string, unknown> }; basic?: Record<string, unknown>; meta?: { ts: string } };
    const basic = payload.data?.basic ?? payload.basic ?? {};
    assert.equal(basic["Pipeline ID"], "A", "pipeline start 应保留 pipelineId");
    assert.equal(basic["Run ID"], "run-1", "pipeline start 应返回顶层 runId");
    assert.equal(basic["Status"], "running", "pipeline start 应返回 run status");
  }

  {
    // WS 客户端 selector 解析测试：selector 参数在调用前即转换为 params，
    // 不涉及 WebSocket 实际连接，因此可以直接测试 selector 解析逻辑。
    const { resolveRuntimePipelineSelector } = require("../src/cli/server-runtime-client") as typeof import("../src/cli/server-runtime-client");
    {
      const { pipelineId, target } = resolveRuntimePipelineSelector({ pipelineId: "A", runId: "run-42" });
      assert.equal(pipelineId, "A", "应正确提取 pipelineId");
      assert.equal(target?.runId, "run-42", "应正确提取 runId");
      assert.equal(target?.batchRunId, undefined, "batchRunId 应为 undefined");
    }
    {
      const { pipelineId, target } = resolveRuntimePipelineSelector({ pipelineId: "A", batchRunId: "batch-42" });
      assert.equal(pipelineId, "A", "应正确提取 pipelineId");
      assert.equal(target?.batchRunId, "batch-42", "应正确提取 batchRunId");
      assert.equal(target?.runId, undefined, "runId 应为 undefined");
    }
    {
      const { pipelineId, target } = resolveRuntimePipelineSelector("A");
      assert.equal(pipelineId, "A", "字符串 selector 应回退为 pipelineId");
      assert.equal(target, undefined, "字符串 selector 不应产生 target");
    }
  }

  {
    const { resolveRuntimePipelineSelector } = require("../src/cli/server-runtime-client") as typeof import("../src/cli/server-runtime-client");
    assert.throws(
      () => resolveRuntimePipelineSelector({ runId: "run-42" }),
      /Missing pipelineId for runtime API selector/,
      "runtime api 在缺失 pipelineId 时应给出明确参数错误",
    );
    assert.throws(
      () => resolveRuntimePipelineSelector({ batchRunId: "batch-42" }),
      /Missing pipelineId for runtime API selector/,
      "runtime api stop 在缺失 pipelineId 时应给出明确参数错误",
    );
  }

  {
    const originalFetch = globalThis.fetch;
    await mkdir(serverRuntimeDir, { recursive: true });
    await writeFile(serverRuntimeMetadataPath, JSON.stringify({
      serverId: "stale-owner",
      pid: 777,
      port: 54320,
      endpoint: "http://127.0.0.1:54320",
      startedAt: "2026-05-01T00:00:00.000Z",
    }, null, 2));
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({
        ok: true,
        serverId: "live-owner",
        pid: 123,
        port: 54320,
        endpoint: "http://127.0.0.1:54320",
        startedAt: "2026-05-09T00:00:00.000Z",
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch;
    try {
      const lifecycleClient = createServerLifecycleClient();
      const result = await lifecycleClient.ensureServerReady();
      assert.equal(result.action, "ensured", "server ensure 遇到健康 owner 时应直接复用现有实例");
      assert.equal(result.pid, 123, "server ensure 应返回健康 owner pid");
      const rewritten = JSON.parse(await readFile(serverRuntimeMetadataPath, "utf8")) as { serverId?: string; pid?: number };
      assert.equal(rewritten.serverId, "live-owner", "server ensure 应把陈旧 metadata 重写为健康 owner");
      assert.equal(rewritten.pid, 123, "server ensure 应把 pid 修正为健康 owner");
    } finally {
      globalThis.fetch = originalFetch;
      await rm(serverRuntimeMetadataPath, { force: true });
    }
  }

  {
    const originalFetch = globalThis.fetch;
    const originalKill = process.kill;
    await mkdir(serverRuntimeDir, { recursive: true });
    await writeFile(serverRuntimeMetadataPath, JSON.stringify({
      serverId: "stale-owner",
      pid: 456,
      port: 54320,
      endpoint: "http://127.0.0.1:54320",
      startedAt: "2026-05-08T00:00:00.000Z",
    }, null, 2));
    globalThis.fetch = (async () => {
      throw new Error("unavailable");
    }) as typeof fetch;
    process.kill = (((pid: number, signal?: NodeJS.Signals | number) => {
      if (signal === 0 && pid === 456) {
        const error = Object.assign(new Error("not running"), { code: "ESRCH" });
        throw error;
      }
      return true;
    }) as typeof process.kill);
    try {
      const lifecycleClient = createServerLifecycleClient();
      const result = await lifecycleClient.stopServer();
      assert.equal(result.action, "not_running", "server stop 遇到 stale metadata 时应视为未运行");
      assert.equal(result.pid, 456, "server stop stale metadata 清理时应保留原 pid 供排障");
      await assert.rejects(readFile(serverRuntimeMetadataPath, "utf8"), /ENOENT/, "server stop 应清理 stale metadata");
    } finally {
      globalThis.fetch = originalFetch;
      process.kill = originalKill;
      await rm(serverRuntimeMetadataPath, { force: true });
    }
  }

  {
    const originalFetch = globalThis.fetch;
    const originalKill = process.kill;
    await mkdir(serverRuntimeDir, { recursive: true });
    await writeFile(serverRuntimeMetadataPath, JSON.stringify({
      serverId: "stale-owner",
      pid: 456,
      port: 54320,
      endpoint: "http://127.0.0.1:54320",
      startedAt: "2026-05-08T00:00:00.000Z",
    }, null, 2));
    globalThis.fetch = (async () => {
      throw new Error("unavailable");
    }) as typeof fetch;
    process.kill = (((pid: number, signal?: NodeJS.Signals | number) => {
      if (signal === 0 && pid === 456) return true;
      return true;
    }) as typeof process.kill);
    try {
      const lifecycleClient = createServerLifecycleClient();
      await assert.rejects(
        lifecycleClient.stopServer(),
        /Refusing to stop unverified local API owner/,
        "server stop 不应在 owner 未验证时误杀仍存活 pid",
      );
    } finally {
      globalThis.fetch = originalFetch;
      process.kill = originalKill;
      await rm(serverRuntimeMetadataPath, { force: true });
    }
  }

  {
    const out = createMemoryStream();
    const err = createMemoryStream();
    const exitCode = await runCli(
      { bootstrap: createReadonlyBootstrap() },
      {
        argv: ["server", "status", "--format", "json"],
        stdout: out.stream,
        stderr: err.stream,
      },
    );
    assert.equal(exitCode, 0, "server status 应返回 exitCode=0");
    assert.equal(err.read(), "", "server status 成功不应输出 stderr");
    const payload = JSON.parse(out.read()) as {
      summary?: { Ready?: boolean; PID?: number };
      data?: { summary?: { Ready?: boolean; PID?: number } };
    };
    const summary = payload.data?.summary ?? payload.summary ?? {};
    assert.equal(summary.Ready, true, "server status 应返回 Ready=true");
    assert.equal(summary.PID, 123, "server status 应返回 PID");
  }

  {
    const out = createMemoryStream();
    const err = createMemoryStream();
    const exitCode = await runCli(
      { bootstrap: createReadonlyBootstrap() },
      {
        argv: ["server", "ensure", "--format", "json"],
        stdout: out.stream,
        stderr: err.stream,
      },
    );
    assert.equal(exitCode, 0, "server ensure 应返回 exitCode=0");
    assert.equal(err.read(), "", "server ensure 成功不应输出 stderr");
    const payload = JSON.parse(out.read()) as { summary?: { Action?: string } };
    assert.equal(payload.summary?.Action, "ensured", "server ensure 应返回 ensured 动作");
  }

  {
    const out = createMemoryStream();
    const err = createMemoryStream();
    const exitCode = await runCli(
      { bootstrap: createReadonlyBootstrap() },
      {
        argv: ["pipeline", "status", "A", "--format", "json"],
        stdout: out.stream,
        stderr: err.stream,
      },
    );
    assert.equal(exitCode, 0, "pipeline status 应返回 exitCode=0");
    assert.equal(err.read(), "", "pipeline status 成功不应输出 stderr");
    const payload = JSON.parse(out.read()) as { running?: boolean; message?: string; lastCompletedAt?: string | null };
    assert.equal(payload.running, undefined, "pipeline status idle 应为空 JSON (custom sections skip JSON)");
    assert.equal(typeof payload.message, "undefined", "pipeline status idle 应为空 JSON");
    assert.equal(typeof payload.lastCompletedAt, "undefined", "pipeline status idle 应为空 JSON");
  }

  {
    let capturedSelector: unknown = null;
    const out = createMemoryStream();
    const err = createMemoryStream();
    const selectorBootstrap: CliBootstrap = async () => ({
      app: {
        systemService: { getSnapshot: async () => ({}) },
        serverService: createMockServerService(),
        pipelineService: {
          listPipelines: async () => [],
          getPipelineById: async () => ({ pipelineId: "A" }),
          startPipeline: async () => ({ ok: true, mode: "single", pipelineId: "A", accepted: true, runId: "run-1" }),
          getPipelineStatus: async (selector: unknown) => {
            capturedSelector = selector;
            return { ok: true, running: false, status: { running: false, runStatus: "success" } };
          },
          stopPipeline: async () => ({ ok: false, pipelineId: "A", error: "batch_run_not_running" }),
          runPipeline: async () => ({ ok: true }),
          retryNode: async () => ({ ok: true }),
        diagnoseNode: async () => ({ diagnostics: [] }),
        getOutput: async () => null,
        listOutputs: async () => [],
        listLinks: async () => [],
        getQueue: async () => [],
        },
        agentService: { listAgents: async () => [], listSessions: async () => [], filterSessionsByAgent: async () => [], sendMessage: async () => ({ ok: true }), getSessionHistory: async () => [], sendMessageAndWaitForReply: async () => ({ sent: {}, reply: null }) },
        sessionService: { listSessions: async () => [], sendMessage: async () => ({ ok: true }) },
        artifactService: { listArtifacts: async () => ({ items: [] }), getArtifactContent: async () => null, exportArtifacts: async () => ({}), planCleanup: async () => ({ files: [], totalSizeBytes: 0, oldestDate: null, newestDate: null }), executeCleanup: async () => ({ deleted: 0, failed: 0, warnings: [] }), rebuildIndex: async () => ({ indexed: 0, skipped: 0, warnings: [] }), },
        schedulerService: { toggleScheduler: async () => ({ ok: true }), setSchedulerMode: async () => ({ ok: true }) },
      },
    });
    const exitCode = await runCli(
      { bootstrap: selectorBootstrap },
      {
        argv: ["pipeline", "status", "--run-id", "run-42", "--format", "json"],
        stdout: out.stream,
        stderr: err.stream,
      },
    );
    assert.equal(exitCode, 0, "pipeline status runId 选择器应返回 exitCode=0");
    assert.equal(err.read(), "", "pipeline status runId 选择器成功不应输出 stderr");
    assert.deepEqual(
      capturedSelector,
      { pipelineId: undefined, runId: "run-42", batchRunId: undefined },
      "pipeline status 应把 runId selector 透传给 service",
    );
  }

  {
    const out = createMemoryStream();
    const err = createMemoryStream();
    const runningStatusBootstrap: CliBootstrap = async () => ({
      app: {
        systemService: { getSnapshot: async () => ({}) },
        serverService: createMockServerService(),
        pipelineService: {
          listPipelines: async () => [],
          getPipelineById: async () => ({ pipelineId: "A" }),
          startPipeline: async () => ({ ok: true, mode: "remote_batch", pipelineId: "A", accepted: true, batchRunId: "batch:A:2026-05-08T00:00:00.000Z" }),
          getPipelineStatus: async () => ({
            ok: true,
            status: {
              pipelineId: "A",
              mode: "remote_batch",
              running: true,
              runId: "run-batch-1",
              runStatus: "running",
              activeNodeIds: ["n2"],
              pendingNodeIds: ["n3", "n4"],
              scheduler: { enabled: true, mode: "auto" },
              batchRun: {
                status: "running",
                batchSize: 5,
                totalItems: 10,
                processedItems: 5,
                processedBatches: 1,
                totalBatches: 2,
                nextBatchIndex: 2,
                currentBatchIndex: 2,
                currentBatchItemKey: "batch-2",
                currentBatchItems: ["kw-6", "kw-7"],
              },
              currentBatch: {
                index: 2,
                itemKey: "batch-2",
                items: ["kw-6", "kw-7"],
                runningNodeIds: ["n2"],
                pendingNodeIds: ["n3", "n4"],
                completedNodeIds: ["n1"],
                failedNodeIds: [],
              },
              lastError: null,
              updatedAt: "2026-05-08T00:01:00.000Z",
            },
          }),
          stopPipeline: async () => ({ ok: false, pipelineId: "A", error: "batch_run_not_running" }),
          runPipeline: async () => ({ ok: true, pipelineId: "A" }),
          retryNode: async () => ({ ok: true }),
        diagnoseNode: async () => ({ diagnostics: [] }),
        getOutput: async () => null,
        listOutputs: async () => [],
        listLinks: async () => [],
        getQueue: async () => [],
        },
        agentService: { listAgents: async () => [], listSessions: async () => [], filterSessionsByAgent: async () => [], sendMessage: async () => ({ ok: true }), getSessionHistory: async () => [], sendMessageAndWaitForReply: async () => ({ sent: {}, reply: null }) },
        sessionService: { listSessions: async () => [], sendMessage: async () => ({ ok: true }) },
        artifactService: { listArtifacts: async () => ({ items: [] }), getArtifactContent: async () => null, exportArtifacts: async () => ({}), planCleanup: async () => ({ files: [], totalSizeBytes: 0, oldestDate: null, newestDate: null }), executeCleanup: async () => ({ deleted: 0, failed: 0, warnings: [] }), rebuildIndex: async () => ({ indexed: 0, skipped: 0, warnings: [] }), },
        schedulerService: { toggleScheduler: async () => ({ ok: true }), setSchedulerMode: async () => ({ ok: true }) },
      },
    });
    const exitCode = await runCli(
      { bootstrap: runningStatusBootstrap },
      {
        argv: ["pipeline", "status", "A", "--format", "json"],
        stdout: out.stream,
        stderr: err.stream,
      },
    );
    assert.equal(exitCode, 0, "pipeline status 运行态应返回 exitCode=0");
    assert.equal(err.read(), "", "pipeline status 运行态成功不应输出 stderr");
    const payload = JSON.parse(out.read()) as { data?: { summary?: Record<string, unknown> }; summary?: Record<string, unknown> };
    const statusSummary = payload.data?.summary ?? payload.summary ?? {};
    assert.equal(statusSummary.Mode, "remote_batch", "pipeline status 运行态应返回 Mode=remote_batch");
    assert.equal(statusSummary.Running, true, "pipeline status 运行态应返回 Running=true");
  }

  {
    const out = createMemoryStream();
    const err = createMemoryStream();
    const exitCode = await runCli(
      { bootstrap: createReadonlyBootstrap() },
      {
        argv: ["pipeline", "status", "A", "--format", "md"],
        stdout: out.stream,
        stderr: err.stream,
      },
    );
    assert.equal(exitCode, 0, "pipeline status markdown 非运行态应返回 exitCode=0");
    assert.equal(err.read(), "", "pipeline status markdown 非运行态成功不应输出 stderr");
    const md = out.read();
    assert.match(md, /^# Pipeline Status/m, "pipeline status markdown 标题应稳定");
    assert.match(md, /No active pipeline run\./m, "pipeline status markdown 非运行态应直接提示无活动运行");
    assert.match(md, /Last completed at: 2026-05-08T00:00:00.000Z/m, "pipeline status markdown 非运行态应显示 lastCompletedAt");
    assert.doesNotMatch(md, /\| Status \| Batch Size \|/m, "pipeline status markdown 非运行态不应输出空批跑表格");
    assert.doesNotMatch(md, /\| Index \| Item Key \|/m, "pipeline status markdown 非运行态不应输出空当前批次表格");
  }

  {
    const out = createMemoryStream();
    const err = createMemoryStream();
    const noHistoryBootstrap: CliBootstrap = async () => ({
      app: {
        systemService: { getSnapshot: async () => ({}) },
        serverService: createMockServerService(),
        pipelineService: {
          listPipelines: async () => [],
          getPipelineById: async () => ({ pipelineId: "A" }),
          startPipeline: async () => ({ ok: true, mode: "single", pipelineId: "A", accepted: true, runId: "run-1", run: { id: "run-1", status: "running" } }),
          getPipelineStatus: async () => ({ ok: true, pipelineId: "A", running: false, message: "no active pipeline run", lastCompletedAt: null }),
          stopPipeline: async () => ({ ok: false, pipelineId: "A", error: "batch_run_not_running" }),
          runPipeline: async () => ({ ok: true }),
          retryNode: async () => ({ ok: true }),
        diagnoseNode: async () => ({ diagnostics: [] }),
        getOutput: async () => null,
        listOutputs: async () => [],
        listLinks: async () => [],
        getQueue: async () => [],
        },
        agentService: { listAgents: async () => [], listSessions: async () => [], filterSessionsByAgent: async () => [], sendMessage: async () => ({ ok: true }), getSessionHistory: async () => [], sendMessageAndWaitForReply: async () => ({ sent: {}, reply: null }) },
        sessionService: { listSessions: async () => [], sendMessage: async () => ({ ok: true }) },
        artifactService: { listArtifacts: async () => ({ items: [] }), getArtifactContent: async () => null, exportArtifacts: async () => ({}), planCleanup: async () => ({ files: [], totalSizeBytes: 0, oldestDate: null, newestDate: null }), executeCleanup: async () => ({ deleted: 0, failed: 0, warnings: [] }), rebuildIndex: async () => ({ indexed: 0, skipped: 0, warnings: [] }), },
        schedulerService: { toggleScheduler: async () => ({ ok: true }), setSchedulerMode: async () => ({ ok: true }) },
      },
    });
    const exitCode = await runCli(
      { bootstrap: noHistoryBootstrap },
      {
        argv: ["pipeline", "status", "A", "--format", "md"],
        stdout: out.stream,
        stderr: err.stream,
      },
    );
    assert.equal(exitCode, 0, "pipeline status markdown 无历史场景应返回 exitCode=0");
    assert.equal(err.read(), "", "pipeline status markdown 无历史场景成功不应输出 stderr");
    const md = out.read();
    assert.match(md, /No active pipeline run\./m, "pipeline status markdown 无历史场景仍应提示无活动运行");
    assert.doesNotMatch(md, /Last completed at:/m, "pipeline status markdown 无历史场景不应伪造 lastCompletedAt");
  }

  {
    let capturedSelector: unknown = null;
    const out = createMemoryStream();
    const err = createMemoryStream();
    const watchBootstrap: CliBootstrap = async () => ({
      app: {
        systemService: { getSnapshot: async () => ({}) },
        serverService: createMockServerService(),
        pipelineService: {
          listPipelines: async () => [],
          getPipelineById: async () => ({ pipelineId: "A" }),
          startPipeline: async () => ({ ok: true, mode: "remote_batch", pipelineId: "A", accepted: true, batchRunId: "batch-42" }),
          getPipelineStatus: async (selector: unknown) => {
            capturedSelector = selector;
            return { ok: true, running: false, status: { running: false, batchRun: { status: "completed" } } };
          },
          stopPipeline: async () => ({ ok: false, pipelineId: "A", error: "batch_run_not_running" }),
          runPipeline: async () => ({ ok: true }),
          retryNode: async () => ({ ok: true }),
        diagnoseNode: async () => ({ diagnostics: [] }),
        getOutput: async () => null,
        listOutputs: async () => [],
        listLinks: async () => [],
        getQueue: async () => [],
        },
        agentService: { listAgents: async () => [], listSessions: async () => [], filterSessionsByAgent: async () => [], sendMessage: async () => ({ ok: true }), getSessionHistory: async () => [], sendMessageAndWaitForReply: async () => ({ sent: {}, reply: null }) },
        sessionService: { listSessions: async () => [], sendMessage: async () => ({ ok: true }) },
        artifactService: { listArtifacts: async () => ({ items: [] }), getArtifactContent: async () => null, exportArtifacts: async () => ({}), planCleanup: async () => ({ files: [], totalSizeBytes: 0, oldestDate: null, newestDate: null }), executeCleanup: async () => ({ deleted: 0, failed: 0, warnings: [] }), rebuildIndex: async () => ({ indexed: 0, skipped: 0, warnings: [] }), },
        schedulerService: { toggleScheduler: async () => ({ ok: true }), setSchedulerMode: async () => ({ ok: true }) },
      },
    });
    const exitCode = await runCli(
      { bootstrap: watchBootstrap },
      {
        argv: ["pipeline", "watch", "--batch-run-id", "batch-42", "--format", "json"],
        stdout: out.stream,
        stderr: err.stream,
      },
    );
    assert.equal(exitCode, 0, "pipeline watch batchRunId 选择器应返回 exitCode=0");
    assert.equal(err.read(), "", "pipeline watch batchRunId 选择器成功不应输出 stderr");
    assert.deepEqual(
      capturedSelector,
      { pipelineId: undefined, runId: undefined, batchRunId: "batch-42" },
      "pipeline watch 应把 batchRunId selector 透传给 service",
    );
  }

  {
    let waitSignalCalls = 0;
    let statusCalls = 0;
    const out = createMemoryStream();
    const err = createMemoryStream();
    const daemonWatchBootstrap: CliBootstrap = async () => ({
      app: {
        systemService: { getSnapshot: async () => ({}) },
        serverService: createMockServerService(),
        pipelineService: {
          listPipelines: async () => [],
          getPipelineById: async () => ({ pipelineId: "A" }),
          startPipeline: async () => ({ ok: true, mode: "single", pipelineId: "A", accepted: true, runId: "run-1" }),
          getPipelineStatus: async () => {
            statusCalls += 1;
            if (statusCalls === 1) {
              return { ok: true, running: true, status: { running: true, runStatus: "running" } };
            }
            return { ok: true, running: false, status: { running: false, runStatus: "success" } };
          },
          stopPipeline: async () => ({ ok: false, pipelineId: "A", error: "batch_run_not_running" }),
          waitForPipelineWatchSignal: async () => {
            waitSignalCalls += 1;
            return { ok: true, source: "ws", eventType: "pipeline.updated" };
          },
          runPipeline: async () => ({ ok: true }),
          retryNode: async () => ({ ok: true }),
        diagnoseNode: async () => ({ diagnostics: [] }),
        getOutput: async () => null,
        listOutputs: async () => [],
        listLinks: async () => [],
        getQueue: async () => [],
        },
        agentService: { listAgents: async () => [], listSessions: async () => [], filterSessionsByAgent: async () => [], sendMessage: async () => ({ ok: true }), getSessionHistory: async () => [], sendMessageAndWaitForReply: async () => ({ sent: {}, reply: null }) },
        sessionService: { listSessions: async () => [], sendMessage: async () => ({ ok: true }) },
        artifactService: { listArtifacts: async () => ({ items: [] }), getArtifactContent: async () => null, exportArtifacts: async () => ({}), planCleanup: async () => ({ files: [], totalSizeBytes: 0, oldestDate: null, newestDate: null }), executeCleanup: async () => ({ deleted: 0, failed: 0, warnings: [] }), rebuildIndex: async () => ({ indexed: 0, skipped: 0, warnings: [] }), },
        schedulerService: { toggleScheduler: async () => ({ ok: true }), setSchedulerMode: async () => ({ ok: true }) },
      },
    });
    const exitCode = await runCli(
      { bootstrap: daemonWatchBootstrap },
      {
        argv: ["pipeline", "watch", "A", "--interval", "10", "--format", "json"],
        stdout: out.stream,
        stderr: err.stream,
      },
    );
    assert.equal(exitCode, 0, "daemon watch 事件流可用场景应返回 exitCode=0");
    assert.equal(err.read(), "", "daemon watch 事件流可用场景不应输出 stderr");
    assert.equal(waitSignalCalls > 0, true, "daemon watch 应优先尝试事件流唤醒");
    assert.equal(statusCalls, 2, "daemon watch 事件流唤醒后应再次确认状态并结束");
  }

  {
    let waitSignalCalls = 0;
    let statusCalls = 0;
    const out = createMemoryStream();
    const err = createMemoryStream();
    const daemonWatchFallbackBootstrap: CliBootstrap = async () => ({
      app: {
        systemService: { getSnapshot: async () => ({}) },
        serverService: createMockServerService(),
        pipelineService: {
          listPipelines: async () => [],
          getPipelineById: async () => ({ pipelineId: "A" }),
          startPipeline: async () => ({ ok: true, mode: "single", pipelineId: "A", accepted: true, runId: "run-1" }),
          getPipelineStatus: async () => {
            statusCalls += 1;
            if (statusCalls === 1) {
              return { ok: true, running: true, status: { running: true, runStatus: "running" } };
            }
            return { ok: true, running: false, status: { running: false, runStatus: "success" } };
          },
          stopPipeline: async () => ({ ok: false, pipelineId: "A", error: "batch_run_not_running" }),
          waitForPipelineWatchSignal: async () => {
            waitSignalCalls += 1;
            throw new Error("ws unavailable");
          },
          runPipeline: async () => ({ ok: true }),
          retryNode: async () => ({ ok: true }),
        diagnoseNode: async () => ({ diagnostics: [] }),
        getOutput: async () => null,
        listOutputs: async () => [],
        listLinks: async () => [],
        getQueue: async () => [],
        },
        agentService: { listAgents: async () => [], listSessions: async () => [], filterSessionsByAgent: async () => [], sendMessage: async () => ({ ok: true }), getSessionHistory: async () => [], sendMessageAndWaitForReply: async () => ({ sent: {}, reply: null }) },
        sessionService: { listSessions: async () => [], sendMessage: async () => ({ ok: true }) },
        artifactService: { listArtifacts: async () => ({ items: [] }), getArtifactContent: async () => null, exportArtifacts: async () => ({}), planCleanup: async () => ({ files: [], totalSizeBytes: 0, oldestDate: null, newestDate: null }), executeCleanup: async () => ({ deleted: 0, failed: 0, warnings: [] }), rebuildIndex: async () => ({ indexed: 0, skipped: 0, warnings: [] }), },
        schedulerService: { toggleScheduler: async () => ({ ok: true }), setSchedulerMode: async () => ({ ok: true }) },
      },
    });
    const exitCode = await runCli(
      { bootstrap: daemonWatchFallbackBootstrap },
      {
        argv: ["pipeline", "watch", "A", "--interval", "5", "--format", "json"],
        stdout: out.stream,
        stderr: err.stream,
      },
    );
    assert.equal(exitCode, 0, "daemon watch 事件流不可用时应退回轮询并成功");
    assert.equal(err.read(), "", "daemon watch 事件流不可用时不应输出 stderr");
    assert.equal(waitSignalCalls, 1, "事件流失败后应停止重复订阅并回退轮询");
    assert.equal(statusCalls, 2, "回退轮询后应继续状态检查直到终态");
  }

  {
    const out = createMemoryStream();
    const err = createMemoryStream();
    const exitCode = await runCli(
      { bootstrap: createReadonlyBootstrap() },
      {
        argv: ["-h"],
        stdout: out.stream,
        stderr: err.stream,
      },
    );
    assert.equal(exitCode, 0, "根命令 -h 应返回 exitCode=0");
    assert.equal(err.read(), "", "帮助文本应写入 stdout 而非 stderr");
    assertHelpOutput(out.read(), [/usage/i, /pipeline/i, /system/i]);
  }

  {
    const out = createMemoryStream();
    const err = createMemoryStream();
    const exitCode = await runCli(
      { bootstrap: createReadonlyBootstrap() },
      {
        argv: ["pipeline", "list", "--format", "md"],
        stdout: out.stream,
        stderr: err.stream,
      },
    );
    assert.equal(exitCode, 0, "format md 成功命令应返回 exitCode=0");
    assert.equal(err.read(), "", "format md 成功命令不应输出 stderr");
    const md = out.read();
    assert.match(md, /^# Pipeline List/m, "format md 应输出 markdown");
    assert.match(md, /\| ID \| Title \|/m, "format md 表头应稳定");
  }

  {
    const out = createMemoryStream();
    const err = createMemoryStream();
    const exitCode = await runCli(
      { bootstrap: createReadonlyBootstrap() },
      {
        argv: ["pipeline", "start", "A", "--format", "json"],
        stdout: out.stream,
        stderr: err.stream,
      },
    );
    assert.equal(exitCode, 0, "pipeline start --format json 应返回 exitCode=0");
    assert.equal(err.read(), "", "pipeline start --format json 成功不应输出 stderr");
    const payload2 = JSON.parse(out.read()) as { ok?: boolean; command?: string; data?: { basic?: Record<string, unknown> }; basic?: Record<string, unknown>; meta?: { ts: string } };
    const basic2 = payload2.data?.basic ?? payload2.basic ?? {};
    assert.equal(basic2["Pipeline ID"], "A", "pipeline start --format json 应保留 pipelineId");
    assert.equal(basic2["Run ID"], "run-1", "pipeline start --format json 应返回顶层 runId");
    assert.equal(basic2["Status"], "running", "pipeline start --format json 应返回 run status");
  }

  {
    const out = createMemoryStream();
    const err = createMemoryStream();
    const exitCode = await runCli(
      { bootstrap: createReadonlyBootstrap() },
      {
        argv: ["pipeline", "list", "--json"],
        stdout: out.stream,
        stderr: err.stream,
      },
    );
    assert.equal(exitCode, 2, "--json 应返回参数错误");
    assert.equal(out.read(), "", "--json 不应输出 stdout");
    assert.match(err.read(), /Deprecated output flags/i, "--json 应提示使用 --format");
  }

  {
    const out = createMemoryStream();
    const err = createMemoryStream();
    const exitCode = await runCli(
      { bootstrap: createReadonlyBootstrap() },
      {
        argv: ["--help"],
        stdout: out.stream,
        stderr: err.stream,
      },
    );
    assert.equal(exitCode, 0, "根命令 --help 应返回 exitCode=0");
    assert.equal(err.read(), "", "根命令 --help 帮助文本应写入 stdout");
    assertHelpOutput(out.read(), [/usage/i, /pipeline/i, /system/i]);
  }

  {
    let runCompatCalled = false;
    const out = createMemoryStream();
    const err = createMemoryStream();
    const compatBootstrap: CliBootstrap = async () => ({
      app: {
        systemService: { getSnapshot: async () => ({}) },
        serverService: createMockServerService(),
        pipelineService: {
          listPipelines: async () => [],
          getPipelineById: async () => ({ pipelineId: "A" }),
          startPipeline: async (pipelineId: string) => ({ ok: true, mode: "single", pipelineId, accepted: true, runId: "run-compat", run: { id: "run-compat", status: "running" } }),
          getPipelineStatus: async () => ({ ok: true, pipelineId: "A", running: false, message: "no active pipeline run", lastCompletedAt: "2026-05-08T00:00:00.000Z" }),
          stopPipeline: async () => ({ ok: false, pipelineId: "A", error: "batch_run_not_running" }),
          runPipeline: async () => {
            runCompatCalled = true;
            return { ok: true };
          },
          retryNode: async () => ({ ok: true }),
        diagnoseNode: async () => ({ diagnostics: [] }),
        getOutput: async () => null,
        listOutputs: async () => [],
        listLinks: async () => [],
        getQueue: async () => [],
        },
        agentService: { listAgents: async () => [], listSessions: async () => [], filterSessionsByAgent: async () => [], sendMessage: async () => ({ ok: true }), getSessionHistory: async () => [], sendMessageAndWaitForReply: async () => ({ sent: {}, reply: null }) },
        sessionService: { listSessions: async () => [], sendMessage: async () => ({ ok: true }) },
        artifactService: { listArtifacts: async () => ({ items: [] }), getArtifactContent: async () => null, exportArtifacts: async () => ({}), planCleanup: async () => ({ files: [], totalSizeBytes: 0, oldestDate: null, newestDate: null }), executeCleanup: async () => ({ deleted: 0, failed: 0, warnings: [] }), rebuildIndex: async () => ({ indexed: 0, skipped: 0, warnings: [] }), },
        schedulerService: { toggleScheduler: async () => ({ ok: true }), setSchedulerMode: async () => ({ ok: true }) },
      },
    });
    const exitCode = await runCli(
      { bootstrap: compatBootstrap },
      {
        argv: ["pipeline", "run", "A", "--format", "json"],
        stdout: out.stream,
        stderr: err.stream,
      },
    );
    assert.equal(exitCode, 2, "pipeline run 已不可用，应返回 UNKNOWN_COMMAND");
    assert.equal(runCompatCalled, false, "pipeline run 不应走到旧 runPipeline");
  }

  {
    const out = createMemoryStream();
    const err = createMemoryStream();
    const stopBootstrap: CliBootstrap = async () => ({
      app: {
        systemService: { getSnapshot: async () => ({}) },
        serverService: createMockServerService(),
        pipelineService: {
          listPipelines: async () => [],
          getPipelineById: async () => ({ pipelineId: "A" }),
          startPipeline: async () => ({ ok: true, mode: "single", pipelineId: "A", accepted: true, runId: "run-1", run: { id: "run-1", status: "running" } }),
          getPipelineStatus: async () => ({ ok: true, status: { pipelineId: "A", mode: "remote_batch", running: true, runId: "run-2", runStatus: "running", activeNodeIds: ["n1"], scheduler: { enabled: true, mode: "auto" }, batchRun: { status: "running", batchSize: 5, totalItems: 10, processedItems: 0, processedBatches: 0, totalBatches: 2, nextBatchIndex: 1 }, lastError: null, updatedAt: "2026-05-08T00:00:00.000Z" } }),
          stopPipeline: async () => ({ ok: true, pipelineId: "A", mode: "remote_batch", stopped: { ok: true }, status: { pipelineId: "A", mode: "remote_batch", running: true, runId: "run-2", runStatus: "running", activeNodeIds: [], scheduler: { enabled: true, mode: "auto" }, batchRun: { status: "running", batchSize: 5, totalItems: 10, processedItems: 5, processedBatches: 1, totalBatches: 2, nextBatchIndex: 2 }, lastError: null, updatedAt: "2026-05-08T00:00:00.000Z" } }),
          runPipeline: async () => ({ ok: true }),
          retryNode: async () => ({ ok: true }),
        diagnoseNode: async () => ({ diagnostics: [] }),
        getOutput: async () => null,
        listOutputs: async () => [],
        listLinks: async () => [],
        getQueue: async () => [],
        },
        agentService: { listAgents: async () => [], listSessions: async () => [], filterSessionsByAgent: async () => [], sendMessage: async () => ({ ok: true }), getSessionHistory: async () => [], sendMessageAndWaitForReply: async () => ({ sent: {}, reply: null }) },
        sessionService: { listSessions: async () => [], sendMessage: async () => ({ ok: true }) },
        artifactService: { listArtifacts: async () => ({ items: [] }), getArtifactContent: async () => null, exportArtifacts: async () => ({}), planCleanup: async () => ({ files: [], totalSizeBytes: 0, oldestDate: null, newestDate: null }), executeCleanup: async () => ({ deleted: 0, failed: 0, warnings: [] }), rebuildIndex: async () => ({ indexed: 0, skipped: 0, warnings: [] }), },
        schedulerService: { toggleScheduler: async () => ({ ok: true }), setSchedulerMode: async () => ({ ok: true }) },
      },
    });
    const exitCode = await runCli(
      { bootstrap: stopBootstrap },
      {
        argv: ["pipeline", "stop", "A", "--format", "json"],
        stdout: out.stream,
        stderr: err.stream,
      },
    );
    assert.equal(exitCode, 0, "pipeline stop 批跑场景应返回 exitCode=0");
    assert.equal(err.read(), "", "pipeline stop 成功不应输出 stderr");
    const payload = JSON.parse(out.read()) as { data?: { basic?: Record<string, unknown> }; basic?: Record<string, unknown> };
    const stopBasic = payload.data?.basic ?? payload.basic ?? {};
    assert.equal(stopBasic["Pipeline ID"], "A", "pipeline stop 应返回 Pipeline ID");
  }

  {
    let capturedSelector: unknown = null;
    const out = createMemoryStream();
    const err = createMemoryStream();
    const stopSelectorBootstrap: CliBootstrap = async () => ({
      app: {
        systemService: { getSnapshot: async () => ({}) },
        serverService: createMockServerService(),
        pipelineService: {
          listPipelines: async () => [],
          getPipelineById: async () => ({ pipelineId: "A" }),
          startPipeline: async () => ({ ok: true, mode: "remote_batch", pipelineId: "A", accepted: true, batchRunId: "batch-42" }),
          getPipelineStatus: async () => ({ ok: true, status: { pipelineId: "A", running: true, batchRun: { status: "running" } } }),
          stopPipeline: async (selector: unknown) => {
            capturedSelector = selector;
            return { ok: true, stopped: { ok: true } };
          },
          runPipeline: async () => ({ ok: true }),
          retryNode: async () => ({ ok: true }),
        diagnoseNode: async () => ({ diagnostics: [] }),
        getOutput: async () => null,
        listOutputs: async () => [],
        listLinks: async () => [],
        getQueue: async () => [],
        },
        agentService: { listAgents: async () => [], listSessions: async () => [], filterSessionsByAgent: async () => [], sendMessage: async () => ({ ok: true }), getSessionHistory: async () => [], sendMessageAndWaitForReply: async () => ({ sent: {}, reply: null }) },
        sessionService: { listSessions: async () => [], sendMessage: async () => ({ ok: true }) },
        artifactService: { listArtifacts: async () => ({ items: [] }), getArtifactContent: async () => null, exportArtifacts: async () => ({}), planCleanup: async () => ({ files: [], totalSizeBytes: 0, oldestDate: null, newestDate: null }), executeCleanup: async () => ({ deleted: 0, failed: 0, warnings: [] }), rebuildIndex: async () => ({ indexed: 0, skipped: 0, warnings: [] }), },
        schedulerService: { toggleScheduler: async () => ({ ok: true }), setSchedulerMode: async () => ({ ok: true }) },
      },
    });
    const exitCode = await runCli(
      { bootstrap: stopSelectorBootstrap },
      {
        argv: ["pipeline", "stop", "--batch-run-id", "batch-42", "--format", "json"],
        stdout: out.stream,
        stderr: err.stream,
      },
    );
    assert.equal(exitCode, 0, "pipeline stop batchRunId 选择器应返回 exitCode=0");
    assert.equal(err.read(), "", "pipeline stop batchRunId 选择器成功不应输出 stderr");
    assert.deepEqual(
      capturedSelector,
      { pipelineId: undefined, runId: undefined, batchRunId: "batch-42" },
      "pipeline stop 应把 batchRunId selector 透传给 service",
    );
  }

  {
    const out = createMemoryStream();
    const err = createMemoryStream();
    const exitCode = await runCli(
      { bootstrap: createReadonlyBootstrap() },
      {
        argv: ["pipeline", "-h"],
        stdout: out.stream,
        stderr: err.stream,
      },
    );
    assert.equal(exitCode, 0, "二级命令 -h 应返回 exitCode=0");
    assert.equal(err.read(), "", "二级命令帮助文本应写入 stdout");
    assertHelpOutput(out.read(), [/usage/i, /pipeline/i, /get/i, /list/i]);
  }

  {
    const out = createMemoryStream();
    const err = createMemoryStream();
    const exitCode = await runCli(
      { bootstrap: createReadonlyBootstrap() },
      {
        argv: ["pipeline", "list", "--format", "md", "--envelope"],
        stdout: out.stream,
        stderr: err.stream,
      },
    );
    assert.equal(exitCode, 2, "非 json format 与 --envelope 并用应返回参数错误");
    assert.equal(out.read(), "", "非 json format 与 --envelope 并用不应输出 stdout");
    assert.match(err.read(), /requires --format json/i, "非 json format 与 --envelope 并用应提示格式限制");
  }

  {
    const out = createMemoryStream();
    const err = createMemoryStream();
    const exitCode = await runCli(
      { bootstrap: createReadonlyBootstrap() },
      {
        argv: ["pipeline", "--help"],
        stdout: out.stream,
        stderr: err.stream,
      },
    );
    assert.equal(exitCode, 0, "二级命令 --help 应返回 exitCode=0");
    assert.equal(err.read(), "", "二级命令 --help 帮助文本应写入 stdout");
    assertHelpOutput(out.read(), [/usage/i, /pipeline/i, /get/i, /list/i]);
  }

  {
    const out = createMemoryStream();
    const err = createMemoryStream();
    const exitCode = await runCli(
      { bootstrap: createReadonlyBootstrap() },
      {
        argv: ["pipeline", "get", "-h"],
        stdout: out.stream,
        stderr: err.stream,
      },
    );
    assert.equal(exitCode, 0, "三级命令 -h 应返回 exitCode=0");
    assert.equal(err.read(), "", "三级命令帮助文本应写入 stdout");
    assertHelpOutput(out.read(), [/usage/i, /pipeline get/i, /<id>/i]);
  }

  {
    const out = createMemoryStream();
    const err = createMemoryStream();
    const exitCode = await runCli(
      { bootstrap: createReadonlyBootstrap() },
      {
        argv: ["pipeline", "get", "--help"],
        stdout: out.stream,
        stderr: err.stream,
      },
    );
    assert.equal(exitCode, 0, "三级命令 --help 应返回 exitCode=0");
    assert.equal(err.read(), "", "三级命令 --help 帮助文本应写入 stdout");
    assertHelpOutput(out.read(), [/usage/i, /pipeline get/i, /<id>/i]);
  }

  {
    const out = createMemoryStream();
    const err = createMemoryStream();
    const exitCode = await runCli(
      { bootstrap: createReadonlyBootstrap() },
      {
        argv: ["pipeline", "status", "-h"],
        stdout: out.stream,
        stderr: err.stream,
      },
    );
    assert.equal(exitCode, 0, "pipeline status -h 应返回 exitCode=0");
    assert.equal(err.read(), "", "pipeline status 帮助文本应写入 stdout");
    assertHelpOutput(out.read(), [/Usage:/i, /Description:/i, /Arguments:/i, /Options:/i, /Examples:/i, /Common Options:/i, /--run-id/i, /--batch-run-id/i, /--format/i]);
  }

  {
    const out = createMemoryStream();
    const err = createMemoryStream();
    const exitCode = await runCli(
      { bootstrap: createReadonlyBootstrap() },
      {
        argv: ["server", "-h"],
        stdout: out.stream,
        stderr: err.stream,
      },
    );
    assert.equal(exitCode, 0, "server -h 应返回 exitCode=0");
    assert.equal(err.read(), "", "server -h 帮助文本应写入 stdout");
    assertHelpOutput(out.read(), [/usage/i, /server/i, /ensure/i, /status/i, /stop/i]);
  }

  {
    const out = createMemoryStream();
    const err = createMemoryStream();
    const exitCode = await runCli(
      { bootstrap: createReadonlyBootstrap() },
      {
        argv: ["pipeline", "watch", "-h"],
        stdout: out.stream,
        stderr: err.stream,
      },
    );
    assert.equal(exitCode, 0, "pipeline watch -h 应返回 exitCode=0");
    assert.equal(err.read(), "", "pipeline watch 帮助文本应写入 stdout");
    assertHelpOutput(out.read(), [/Usage:/i, /Options:/i, /Examples:/i, /--timeout/i, /--interval/i]);
  }

  {
    const out = createMemoryStream();
    const err = createMemoryStream();
    const exitCode = await runCli(
      { bootstrap: createReadonlyBootstrap() },
      {
        argv: ["pipeline", "stop", "-h"],
        stdout: out.stream,
        stderr: err.stream,
      },
    );
    assert.equal(exitCode, 0, "pipeline stop -h 应返回 exitCode=0");
    assert.equal(err.read(), "", "pipeline stop 帮助文本应写入 stdout");
    assertHelpOutput(out.read(), [/Usage:/i, /Options:/i, /--batch-run-id/i]);
  }

  {
    const out = createMemoryStream();
    const err = createMemoryStream();
    const exitCode = await runCli(
      { bootstrap: createReadonlyBootstrap() },
      {
        argv: ["pipeline", "start", "-h"],
        stdout: out.stream,
        stderr: err.stream,
      },
    );
    assert.equal(exitCode, 0, "pipeline start -h 应返回 exitCode=0");
    assert.equal(err.read(), "", "pipeline start 帮助文本应写入 stdout");
    assertHelpOutput(out.read(), [/Usage:/i, /Arguments:/i, /Options:/i, /--watch/i, /--timeout/i, /--interval/i]);
  }

  {
    const out = createMemoryStream();
    const err = createMemoryStream();
    const exitCode = await runCli(
      { bootstrap: createReadonlyBootstrap() },
      {
        argv: ["pipeline", "run", "-h"],
        stdout: out.stream,
        stderr: err.stream,
      },
    );
    assert.equal(exitCode, 2, "pipeline run 已不可用，应返回 UNKNOWN_COMMAND");
    const errText = err.read();
    assert.ok(errText.includes("UNKNOWN_COMMAND"), "pipeline run 应给出提示");
  }

  {
    const out = createMemoryStream();
    const err = createMemoryStream();
    const exitCode = await runCli(
      { bootstrap: createReadonlyBootstrap() },
      {
        argv: ["server", "ensure", "-h"],
        stdout: out.stream,
        stderr: err.stream,
      },
    );
    assert.equal(exitCode, 0, "server ensure -h 应返回 exitCode=0");
    assert.equal(err.read(), "", "server ensure 帮助文本应写入 stdout");
    assertHelpOutput(out.read(), [/Usage:/i, /Description:/i, /daemon/i]);
  }

  {
    const out = createMemoryStream();
    const err = createMemoryStream();
    const exitCode = await runCli(
      { bootstrap: createReadonlyBootstrap() },
      {
        argv: ["agent", "send", "-h"],
        stdout: out.stream,
        stderr: err.stream,
      },
    );
    assert.equal(exitCode, 0, "agent send -h 应返回 exitCode=0");
    assert.equal(err.read(), "", "agent send 帮助文本应写入 stdout");
    assertHelpOutput(out.read(), [/Usage:/i, /Arguments:/i, /Options:/i, /--format/i]);
  }

  {
    const out = createMemoryStream();
    const err = createMemoryStream();
    const exitCode = await runCli(
      { bootstrap: createReadonlyBootstrap() },
      {
        argv: ["scheduler", "toggle", "-h"],
        stdout: out.stream,
        stderr: err.stream,
      },
    );
    assert.equal(exitCode, 0, "scheduler toggle -h 应返回 exitCode=0");
    assert.equal(err.read(), "", "scheduler toggle 帮助文本应写入 stdout");
    assertHelpOutput(out.read(), [/Usage:/i, /Arguments:/i, /Options:/i, /--enabled/i]);
  }

  {
    const unknownCommandHint = resolveHelpHint(CLI_ROUTES, ["pipeline", "oops"]);
    assert.equal(unknownCommandHint, "Use: taskmeld pipeline -h", "未知 action 的 help hint 应回退到 group 帮助");
    const fallbackHint = resolveHelpHint(CLI_ROUTES, []);
    assert.equal(fallbackHint, "Use: taskmeld -h", "空命令 hint 应指向根帮助");
    const byRouteKeyHint = resolveHelpHintByRouteKey(CLI_ROUTES, "scheduler.mode");
    assert.equal(byRouteKeyHint, "Use: taskmeld scheduler mode -h", "route key hint 应输出稳定命令路径");
  }

  {
    const out = createMemoryStream();
    const err = createMemoryStream();
    const exitCode = await runCli(
      { bootstrap: createReadonlyBootstrap() },
      {
        argv: ["pipeline", "oops"],
        stdout: out.stream,
        stderr: err.stream,
      },
    );
    assert.equal(exitCode, 2, "未知命令应返回 exitCode=2");
    assert.equal(out.read(), "", "未知命令不应输出 stdout");
    const errorText = err.read();
    assert.ok(errorText.length > 0, "未知命令应输出错误信息");
    assert.match(errorText, /Unknown command/i, "未知命令错误应包含 Unknown command");
    assert.match(errorText, /Use:\s*taskmeld pipeline -h/i, "未知命令错误应包含 group 级 help hint");
  }

  {
    const out = createMemoryStream();
    const err = createMemoryStream();
    const exitCode = await runCli(
      { bootstrap: createReadonlyBootstrap() },
      {
        argv: ["pipeline", "run"],
        stdout: out.stream,
        stderr: err.stream,
      },
    );
    assert.equal(exitCode, 2, "pipeline run 已不可用，缺参应返回 exitCode=2");
    assert.equal(out.read(), "", "缺参错误不应输出到 stdout");
    const errorText = err.read();
    assert.ok(errorText.length > 0, "缺参错误应输出错误信息");
    assert.match(errorText, /-h|--help/i, "缺参错误应提示使用 -h 或 --help");
  }

  {
    const out = createMemoryStream();
    const err = createMemoryStream();
    const exitCode = await runCli(
      { bootstrap: createReadonlyBootstrap() },
      {
        argv: ["pipeline", "status", "--format", "json"],
        stdout: out.stream,
        stderr: err.stream,
      },
    );
    assert.equal(exitCode, 2, "pipeline status 缺少 selector 应返回 exitCode=2");
    assert.equal(out.read(), "", "pipeline status 缺少 selector 不应输出 stdout");
    assert.match(err.read(), /<pipelineId>|--run-id|--batch-run-id/i, "pipeline status 缺少 selector 应提示合法入口");
  }

  const successOut = createMemoryStream();
  const successErr = createMemoryStream();
  const successExitCode = await runCli(
    { bootstrap: createReadonlyBootstrap() },
    {
      argv: ["pipeline", "list", "--format", "json"],
      stdout: successOut.stream,
      stderr: successErr.stream,
    },
  );
  assert.equal(successExitCode, 0, "成功命令应返回 exitCode=0");
  assert.equal(successErr.read(), "", "成功命令不应输出 stderr");
  const successPayload = JSON.parse(successOut.read()) as Array<{ ID: string; Title: string }>;
  assert.ok(Array.isArray(successPayload), "成功输出应直接返回业务数据数组");
  assert.equal(successPayload[0]?.ID, "A", "成功输出应保留业务数据");

  {
    const out = createMemoryStream();
    const err = createMemoryStream();
    const exitCode = await runCli(
      { bootstrap: createReadonlyBootstrap() },
      {
        argv: ["pipeline", "list"],
        stdout: out.stream,
        stderr: err.stream,
      },
    );
    assert.equal(exitCode, 0, "默认输出模式应返回成功退出码");
    assert.equal(err.read(), "", "默认输出模式成功命令不应输出 stderr");
    const md = out.read();
    assert.match(md, /^# Pipeline List/m, "默认输出模式应为 markdown");
  }

  {
    const out = createMemoryStream();
    const err = createMemoryStream();
    const exitCode = await runCli(
      { bootstrap: createReadonlyBootstrap() },
      {
        argv: ["pipeline", "list", "--format", "json", "--envelope"],
        stdout: out.stream,
        stderr: err.stream,
      },
    );
    assert.equal(exitCode, 0, "json envelope 成功命令应返回 exitCode=0");
    assert.equal(err.read(), "", "json envelope 成功命令不应输出 stderr");
    const payload = JSON.parse(out.read()) as {
      ok: boolean;
      command: string;
      data: Array<{ ID: string; Title: string }>;
      meta: { ts: string };
    };
    assert.equal(payload.ok, true, "json envelope 应包含 ok=true");
    assert.equal(payload.command, "pipeline.list", "json envelope 应包含命令名");
    assert.ok(Array.isArray(payload.data), "json envelope data 应保留业务数据");
    assert.equal(payload.data[0]?.ID, "A", "json envelope 应保留业务数据内容");
    assert.ok(typeof payload.meta?.ts === "string", "json envelope 应包含时间戳");
  }

  {
    const out = createMemoryStream();
    const err = createMemoryStream();
    const exitCode = await runCli(
      { bootstrap: createReadonlyBootstrap() },
      {
        argv: ["pipeline", "list", "--format", "md"],
        stdout: out.stream,
        stderr: err.stream,
      },
    );
    assert.equal(exitCode, 0, "markdown 成功命令应返回 exitCode=0");
    assert.equal(err.read(), "", "markdown 成功命令不应输出 stderr");
    const md = out.read();
    assert.match(md, /^# Pipeline List/m, "pipeline list markdown 标题应稳定");
    assert.match(md, /\| ID \| Title \|/m, "pipeline list markdown 表头应稳定");
  }

  {
    const out = createMemoryStream();
    const err = createMemoryStream();
    const exitCode = await runCli(
      { bootstrap: createReadonlyBootstrap() },
      {
        argv: ["pipeline", "get", "A", "--format", "md"],
        stdout: out.stream,
        stderr: err.stream,
      },
    );
    assert.equal(exitCode, 0, "pipeline get markdown 成功命令应返回 exitCode=0");
    assert.equal(err.read(), "", "pipeline get markdown 成功命令不应输出 stderr");
    const md = out.read();
    assert.match(md, /^# Pipeline Detail/m, "pipeline get markdown 标题应稳定");
    assert.match(md, /## Basic/m, "pipeline get markdown 结构应稳定");
    assert.match(md, /## Basic/m, "pipeline get markdown 基本信息小节应稳定");
    assert.match(md, /\| ID \|/m, "pipeline get markdown 基本信息应包含 ID");
  }

  {
    const out = createMemoryStream();
    const err = createMemoryStream();
    const exitCode = await runCli(
      { bootstrap: createReadonlyBootstrap() },
      {
        argv: ["system", "snapshot", "--format", "md"],
        stdout: out.stream,
        stderr: err.stream,
      },
    );
    assert.equal(exitCode, 0, "system snapshot markdown 成功命令应返回 exitCode=0");
    assert.equal(err.read(), "", "system snapshot markdown 成功命令不应输出 stderr");
    const md = out.read();
    assert.match(md, /^# System Snapshot/m, "system snapshot markdown 标题应稳定");
    assert.match(md, /## Summary/m, "system snapshot markdown 结构应稳定");
  }

  {
    const out = createMemoryStream();
    const err = createMemoryStream();
    const exitCode = await runCli(
      { bootstrap: createReadonlyBootstrap() },
      {
        argv: ["agent", "session", "--format", "md"],
        stdout: out.stream,
        stderr: err.stream,
      },
    );
    assert.equal(exitCode, 0, "agent session markdown 成功命令应返回 exitCode=0");
    assert.equal(err.read(), "", "agent session markdown 成功命令不应输出 stderr");
    const md = out.read();
    assert.match(md, /^# Session List/m, "agent session markdown 标题应稳定");
  }

  {
    const out = createMemoryStream();
    const err = createMemoryStream();
    const exitCode = await runCli(
      { bootstrap: createReadonlyBootstrap() },
      {
        argv: ["artifact", "list", "--format", "md"],
        stdout: out.stream,
        stderr: err.stream,
      },
    );
    assert.equal(exitCode, 0, "artifact list markdown 应返回成功退出码");
    assert.equal(err.read(), "", "artifact list markdown 成功命令不应输出 stderr");
    const md = out.read();
    assert.match(md, /^# Artifact List/m, "artifact list markdown 标题应稳定");
    assert.match(md, /\(none\)/m, "artifact list 空结果应输出专属空态文本");
  }

  let capturedArtifactFilter: Record<string, unknown> | null = null;
  const artifactOut = createMemoryStream();
  const artifactErr = createMemoryStream();
  const artifactBootstrap: CliBootstrap = async () => ({
    app: {
      systemService: {
        getSnapshot: async () => ({ generatedAt: "2026-05-08T00:00:00.000Z" }),
      },
      serverService: createMockServerService(),
      pipelineService: {
        listPipelines: async () => [],
        getPipelineById: async () => null,
        startPipeline: async () => ({ ok: false, pipelineId: "missing", error: "pipeline_not_found" }),
        getPipelineStatus: async () => ({ ok: false, pipelineId: "missing", error: "pipeline_not_found" }),
        stopPipeline: async () => ({ ok: false, pipelineId: "missing", error: "pipeline_not_found" }),
        runPipeline: async () => ({ ok: true }),
        retryNode: async () => ({ ok: true }),
        diagnoseNode: async () => ({ diagnostics: [] }),
        getOutput: async () => null,
        listOutputs: async () => [],
        listLinks: async () => [],
        getQueue: async () => [],
      },
      agentService: {
        listAgents: async () => [],
        listSessions: async () => [],
        filterSessionsByAgent: async () => [],
        sendMessage: async () => ({ ok: true }), getSessionHistory: async () => [], sendMessageAndWaitForReply: async () => ({ sent: {}, reply: null }),
      },
      sessionService: {
        listSessions: async () => [],
        sendMessage: async () => ({ ok: true }),
      },
      artifactService: {
        listArtifacts: async (filter) => {
          capturedArtifactFilter = filter;
          return { items: [] };
        },
        getArtifactContent: async () => null,
        exportArtifacts: async () => ({}), planCleanup: async () => ({ files: [], totalSizeBytes: 0, oldestDate: null, newestDate: null }), executeCleanup: async () => ({ deleted: 0, failed: 0, warnings: [] }), rebuildIndex: async () => ({ indexed: 0, skipped: 0, warnings: [] }),
      },
      schedulerService: {
        toggleScheduler: async () => ({ ok: true }),
        setSchedulerMode: async () => ({ ok: true }),
      },
    },
  });
  const artifactExitCode = await runCli(
    { bootstrap: artifactBootstrap },
    {
      argv: ["artifact", "list", "--pipeline", "A", "--node", "n2"],
      stdout: artifactOut.stream,
      stderr: artifactErr.stream,
    },
  );
  assert.equal(artifactExitCode, 0, "artifact list 应返回成功退出码");
  const filterObj = (capturedArtifactFilter ?? {}) as Record<string, unknown>;
  assert.equal(filterObj.pipelineId, "A", "artifact list 应透传 pipelineId");
  assert.equal(filterObj.nodeId, "n2", "artifact list 应透传 nodeId");
  assert.equal(artifactErr.read(), "", "artifact list 成功时不应输出 stderr");

  const failureOut = createMemoryStream();
  const failureErr = createMemoryStream();
  const failureBootstrap: CliBootstrap = async () => ({
    app: {
      systemService: {
        getSnapshot: async () => ({ generatedAt: "2026-05-08T00:00:00.000Z" }),
      },
      serverService: createMockServerService(),
      pipelineService: {
        listPipelines: async () => [],
        getPipelineById: async () => null,
        startPipeline: async () => ({ ok: false, pipelineId: "missing", error: "pipeline_not_found" }),
        getPipelineStatus: async () => ({ ok: false, pipelineId: "missing", error: "pipeline_not_found" }),
        stopPipeline: async () => ({ ok: false, pipelineId: "missing", error: "pipeline_not_found" }),
        runPipeline: async () => ({ ok: true }),
        retryNode: async () => ({ ok: true }),
        diagnoseNode: async () => ({ diagnostics: [] }),
        getOutput: async () => null,
        listOutputs: async () => [],
        listLinks: async () => [],
        getQueue: async () => [],
      },
      agentService: {
        listAgents: async () => [],
        listSessions: async () => [],
        filterSessionsByAgent: async () => [],
        sendMessage: async () => ({ ok: true }), getSessionHistory: async () => [], sendMessageAndWaitForReply: async () => ({ sent: {}, reply: null }),
      },
      sessionService: {
        listSessions: async () => [],
        sendMessage: async () => ({ ok: true }),
      },
      artifactService: {
        listArtifacts: async () => ({ items: [] }), getArtifactContent: async () => null, exportArtifacts: async () => ({}), planCleanup: async () => ({ files: [], totalSizeBytes: 0, oldestDate: null, newestDate: null }), executeCleanup: async () => ({ deleted: 0, failed: 0, warnings: [] }), rebuildIndex: async () => ({ indexed: 0, skipped: 0, warnings: [] }),
      },
      schedulerService: {
        toggleScheduler: async () => ({ ok: true }),
        setSchedulerMode: async () => ({ ok: true }),
      },
    },
  });
  const failureExitCode = await runCli(
    { bootstrap: failureBootstrap },
    {
      argv: ["pipeline", "get", "missing", "--format", "json"],
      stdout: failureOut.stream,
      stderr: failureErr.stream,
    },
  );
  assert.equal(failureExitCode, 3, "不存在资源应返回 exitCode=3");
  assert.equal(failureOut.read(), "", "失败命令不应污染 stdout");
  const failurePayload = JSON.parse(failureErr.read()) as {
    ok: boolean;
    command: string;
    error: { code: string; details?: { pipelineId?: string } };
  };
  assert.equal(failurePayload.ok, false, "错误输出应带 ok=false");
  assert.equal(failurePayload.command, "pipeline.get", "错误输出应带命令名");
  assert.equal(failurePayload.error.code, "PIPELINE_NOT_FOUND", "错误输出应保留稳定错误码");
  assert.equal(failurePayload.error.details?.pipelineId, "missing", "错误输出应保留上下文详情");

  console.log("taskmeld cli phase-2 contract tests passed");
};

void run().catch((error) => {
  console.error("taskmeld cli smoke tests failed", error);
  process.exitCode = 1;
});
