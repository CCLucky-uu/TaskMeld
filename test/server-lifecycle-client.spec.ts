import assert from "node:assert/strict"
import { mkdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const serverRuntimeDir = join(tmpdir(), "taskmeld-server-lifecycle-test")
const runtimeMetadataPath = join(serverRuntimeDir, "runtime.json")
const startupLockPath = join(serverRuntimeDir, "startup.lock")
process.env.TASKMELD_SERVER_RUNTIME_DIR = serverRuntimeDir
const { createServerLifecycleClient } =
  require("../src/cli/server-runtime-client") as typeof import("../src/cli/server-runtime-client")

type FileSnapshot = { exists: boolean; content: string | null; mtimeMs: number | null }

const readSnapshot = async (filePath: string): Promise<FileSnapshot> => {
  try {
    const content = await readFile(filePath, "utf8")
    const fileStat = await stat(filePath)
    return { exists: true, content, mtimeMs: fileStat.mtimeMs }
  } catch {
    return { exists: false, content: null, mtimeMs: null }
  }
}

const restoreSnapshot = async (filePath: string, snapshot: FileSnapshot): Promise<void> => {
  if (!snapshot.exists) {
    await rm(filePath, { force: true })
    return
  }
  await mkdir(serverRuntimeDir, { recursive: true })
  await writeFile(filePath, snapshot.content ?? "", "utf8")
  if (typeof snapshot.mtimeMs === "number") {
    const ts = new Date(snapshot.mtimeMs)
    await utimes(filePath, ts, ts)
  }
}

type MockHealthPayload =
  | false
  | {
      serverId?: string | null
      pid?: number
      port?: number
      endpoint?: string
      startedAt?: string
    }

const setHealthResponses = (responses: MockHealthPayload[]) => {
  const originalFetch = globalThis.fetch
  let cursor = 0
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
    if (!url.includes("/api/health")) {
      return new Response(JSON.stringify({ ok: false, error: "unexpected_url" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      })
    }
    const picked = responses[Math.min(cursor, responses.length - 1)] ?? false
    cursor += 1
    if (picked === false) {
      throw new Error("health unavailable")
    }
    return new Response(
      JSON.stringify({
        ok: true,
        serverId: picked.serverId ?? "test-server",
        pid: picked.pid ?? 123,
        port: picked.port ?? 54320,
        endpoint: picked.endpoint ?? "http://127.0.0.1:54320",
        startedAt: picked.startedAt ?? "2026-05-09T00:00:00.000Z",
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    )
  }) as typeof fetch
  return () => {
    globalThis.fetch = originalFetch
  }
}

const setKillBehavior = (handler: typeof process.kill) => {
  const originalKill = process.kill
  ;(process as { kill: typeof process.kill }).kill = handler
  return () => {
    ;(process as { kill: typeof process.kill }).kill = originalKill
  }
}

const run = async () => {
  await mkdir(serverRuntimeDir, { recursive: true })
  const runtimeSnapshot = await readSnapshot(runtimeMetadataPath)
  const lockSnapshot = await readSnapshot(startupLockPath)
  const client = createServerLifecycleClient()

  try {
    {
      await rm(runtimeMetadataPath, { force: true })
      const restoreFetch = setHealthResponses([{}, {}, {}])
      try {
        const missingMetadata = await client.getServerStatus()
        assert.equal(missingMetadata.ready, true, "health 存活时 status 应返回 ready=true")
        assert.equal(missingMetadata.metadataPresent, true, "health 存活时 status 应回填 metadata")

        // runtime metadata 解析失败时必须降级为空，避免 stop/ensure 误用损坏 pid。
        await writeFile(runtimeMetadataPath, "{not-json", "utf8")
        const brokenMetadata = await client.getServerStatus()
        assert.equal(brokenMetadata.metadataPresent, true, "metadata 损坏时 status 应以健康 owner 自动回填")
        const ensured = await client.ensureServerReady()
        assert.equal(ensured.action, "ensured", "health 存活时 ensure 应走复用语义")
        assert.equal(ensured.pid, 123, "metadata 损坏时 ensure 应回填并暴露健康 owner pid")
      } finally {
        restoreFetch()
      }
    }

    {
      await writeFile(
        runtimeMetadataPath,
        JSON.stringify({
          pid: 999999,
          port: 3199,
          endpoint: "http://127.0.0.1:3199",
          startedAt: "2026-05-09T00:00:00.000Z",
        }),
        "utf8",
      )
      const restoreFetch = setHealthResponses([
        { serverId: "live-owner", pid: 123, port: 54320, endpoint: "http://127.0.0.1:54320" },
        { serverId: "live-owner", pid: 123, port: 54320, endpoint: "http://127.0.0.1:54320" },
      ])
      const restoreKill = setKillBehavior(((pid: number, signal?: NodeJS.Signals | number) => {
        if (signal === 0) {
          const error = new Error(`kill ESRCH ${pid}`) as NodeJS.ErrnoException
          error.code = "ESRCH"
          throw error
        }
        return true
      }) as typeof process.kill)
      try {
        // ownership mismatch: metadata 仍指向旧 owner，但本地 health 已存活，应以 health owner 回填。
        const ensured = await client.ensureServerReady()
        assert.equal(ensured.action, "ensured", "health 存活时 ownership mismatch 不应触发重启")
        assert.equal(ensured.reused, true, "ownership mismatch 应保留复用语义")
        const status = await client.getServerStatus()
        assert.equal(status.ready, true, "ownership mismatch 不应影响 health 检查")
        assert.equal(status.metadataPresent, true, "ownership mismatch 场景应保留 metadata 可见性")
        assert.equal(status.pid, 123, "ownership mismatch 场景应回填为健康 owner pid")
        assert.equal(status.ownershipMatched, true, "ownership mismatch 回填后应收敛为 matched")
      } finally {
        restoreKill()
        restoreFetch()
      }
    }

    {
      await writeFile(
        runtimeMetadataPath,
        JSON.stringify({
          pid: 999999,
          port: 54320,
          endpoint: "http://127.0.0.1:54320",
          startedAt: "2026-05-09T00:00:00.000Z",
        }),
        "utf8",
      )
      const restoreFetch = setHealthResponses([false])
      const restoreKill = setKillBehavior(((pid: number, signal?: NodeJS.Signals | number) => {
        if (signal === 0) {
          const error = new Error(`kill ESRCH ${pid}`) as NodeJS.ErrnoException
          error.code = "ESRCH"
          throw error
        }
        return true
      }) as typeof process.kill)
      try {
        const stopped = await client.stopServer()
        assert.equal(stopped.action, "not_running", "stale metadata stop 应降级为 not_running")
        await assert.rejects(
          readFile(runtimeMetadataPath, "utf8"),
          /ENOENT/,
          "stop 遇到 stale metadata 时应主动清理 runtime metadata",
        )
      } finally {
        restoreKill()
        restoreFetch()
      }
    }

    {
      await rm(runtimeMetadataPath, { force: true })
      await mkdir(serverRuntimeDir, { recursive: true })
      await writeFile(startupLockPath, "stale-lock", "utf8")
      const staleTs = new Date(Date.now() - 60_000)
      await utimes(startupLockPath, staleTs, staleTs)
      const restoreFetch = setHealthResponses([false, false, false, {}])
      try {
        // stale lock 清理后应继续 acquire + 二次 health，避免把锁超时误判成不可恢复故障。
        const ensured = await client.ensureServerReady()
        assert.equal(ensured.action, "started", "stale lock 恢复后若健康实例在拉起阶段才出现，应返回 started")
        assert.equal(ensured.reused, false, "stale lock 恢复后若需要进入拉起流程，不应伪装成已复用现有实例")
        await assert.rejects(readFile(startupLockPath, "utf8"), /ENOENT/, "恢复完成后 startup lock 应被释放")
      } finally {
        restoreFetch()
      }
    }

    console.log("server lifecycle client ownership/recovery tests passed")
  } finally {
    await restoreSnapshot(runtimeMetadataPath, runtimeSnapshot)
    await restoreSnapshot(startupLockPath, lockSnapshot)
  }
}

void run().catch((error) => {
  console.error("server lifecycle client ownership/recovery tests failed", error)
  process.exitCode = 1
})
