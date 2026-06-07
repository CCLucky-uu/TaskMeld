import assert from "node:assert/strict"
import { runCli } from "../src/cli"
import type { CliBootstrap } from "../src/cli/types"

const createMemoryStream = () => {
  let content = ""
  return {
    stream: {
      write(chunk: string | Uint8Array) {
        content += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8")
        return true
      },
    } as unknown as NodeJS.WritableStream,
    read: () => content,
  }
}

const createReadonlyBootstrap = (): CliBootstrap => {
  return async () => ({
    app: {
      systemService: { getSnapshot: async () => ({}) },
      serverService: {
        ensureServerReady: async () => ({ ok: true }),
        startServer: async () => ({ ok: true }),
        getServerStatus: async () => ({ ok: true }),
        stopServer: async () => ({ ok: true }),
      },
      pipelineService: {
        listPipelines: async () => [{ id: "A", title: "流水线 DAG-A" }],
        getPipelineById: async () => null,
        startPipeline: async () => ({ ok: true }),
        getPipelineStatus: async () => ({ ok: true }),
        stopPipeline: async () => ({ ok: true }),
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
        sendMessage: async () => ({ ok: true }),
        getSessionHistory: async () => [],
        sendMessageAndWaitForReply: async () => ({ sent: {}, reply: null }),
        createAgent: async () => ({}),
        updateAgent: async () => ({}),
        deleteAgent: async () => ({}),
      },
      sessionService: { listSessions: async () => [], sendMessage: async () => ({ ok: true }) },
      artifactService: {
        listArtifacts: async () => ({ items: [] }),
        getArtifactContent: async () => null,
        exportArtifacts: async () => ({}),
        planCleanup: async () => ({ files: [], totalSizeBytes: 0, oldestDate: null, newestDate: null }),
        executeCleanup: async () => ({ deleted: 0, failed: 0, warnings: [] }),
        rebuildIndex: async () => ({ indexed: 0, skipped: 0, warnings: [] }),
      },
      schedulerService: { toggleScheduler: async () => ({ ok: true }), setSchedulerMode: async () => ({ ok: true }) },
    },
  })
}

const run = async () => {
  {
    const out = createMemoryStream()
    const err = createMemoryStream()
    const exitCode = await runCli(
      { bootstrap: createReadonlyBootstrap() },
      { argv: ["pipeline", "list", "--md"], stdout: out.stream, stderr: err.stream },
    )
    assert.equal(exitCode, 2, "--md 应返回参数错误")
    assert.equal(out.read(), "", "--md 不应写 stdout")
    assert.match(err.read(), /Deprecated output flags/i, "--md 应提示使用 --format")
  }

  {
    const out = createMemoryStream()
    const err = createMemoryStream()
    const exitCode = await runCli(
      { bootstrap: createReadonlyBootstrap() },
      { argv: ["pipeline", "list", "--format", "md", "--envelope"], stdout: out.stream, stderr: err.stream },
    )
    // 统一以当前 CLI 实际契约为准，避免旧文案与新文案并存导致门禁抖动。
    assert.equal(exitCode, 2, "--format md 与 --envelope 并用应返回参数错误")
    assert.equal(out.read(), "", "非 json format 非法组合不应写 stdout")
    assert.match(err.read(), /requires --format json/i, "非 json format 与 --envelope 并用应返回明确错误")
  }

  {
    const out = createMemoryStream()
    const err = createMemoryStream()
    const exitCode = await runCli(
      { bootstrap: createReadonlyBootstrap() },
      { argv: ["pipeline", "list", "--help", "--format", "md", "--envelope"], stdout: out.stream, stderr: err.stream },
    )
    assert.equal(exitCode, 0, "help 与输出参数并用时应优先返回帮助")
    assert.equal(err.read(), "", "help 输出不应写入 stderr")
    assert.match(out.read(), /Usage:/i, "help 输出应包含 usage")
  }

  console.log("taskmeld cli error-contract tests passed")
}

void run().catch((error) => {
  console.error("taskmeld cli error-contract tests failed", error)
  process.exitCode = 1
})
