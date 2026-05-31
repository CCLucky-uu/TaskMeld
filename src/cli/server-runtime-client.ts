import { constants, existsSync } from "node:fs";
import { access, mkdir, open, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import WebSocket from "ws";
import { resolveAppContextConfig } from "../app/app-context-env";
import { resolveTaskMeldDataPath } from "../app/data-dir";
import { createWsRuntimeClient } from "./ws-runtime-client";
import type { CliPipelineRunIdentityTarget, CliPipelineSelector } from "./types";
import { CliError } from "./errors";

type ServerRuntimeMetadata = {
  serverId: string | null;
  pid: number;
  port: number;
  endpoint: string;
  startedAt: string;
};

type ServerHealthPayload = {
  ok: true;
  serverId: string | null;
  pid: number;
  port: number;
  endpoint: string;
  startedAt: string;
};

type ServerStatusPayload = {
  ok: true;
  endpoint: string;
  ready: boolean;
  metadataPresent: boolean;
  ownership: "matched" | "metadata_missing" | "metadata_mismatch";
  ownershipMatched: boolean;
  metadataStale: boolean;
  lockStale: boolean;
  pid: number | null;
  pidRunning: boolean;
  startedAt: string | null;
};

type ServerLifecycleResult = {
  ok: true;
  endpoint: string;
  action: "ensured" | "started" | "already_running" | "stopped" | "not_running";
  reused: boolean;
  ownership: "matched" | "metadata_missing" | "metadata_mismatch";
  metadataStale: boolean;
  lockStale: boolean;
  pid: number | null;
  startedAt: string | null;
};


const STARTUP_LOCK_STALE_MS = 15_000;
const STARTUP_LOCK_WAIT_MS = 250;
const STARTUP_TIMEOUT_MS = 15_000;
const STOP_TIMEOUT_MS = 10_000;

const buildApiBaseUrl = (): string => {
  const config = resolveAppContextConfig();
  return `http://127.0.0.1:${config.apiPort}`;
};

const buildWsBaseUrl = (): string => {
  const config = resolveAppContextConfig();
  return `ws://127.0.0.1:${config.apiPort}`;
};

export const resolveRuntimePipelineSelector = (
  selector: string | CliPipelineSelector,
): { pipelineId: string; target?: CliPipelineRunIdentityTarget } => {
  if (typeof selector === "string" && selector.trim()) {
    return { pipelineId: selector.trim() };
  }
  if (!selector || typeof selector === "string") {
    throw new CliError("Missing pipelineId for runtime API selector", {
      code: "INVALID_ARGUMENT",
      exitCode: 2,
      details: {
        runId: null,
        batchRunId: null,
      },
    });
  }
  const pipelineId = typeof selector.pipelineId === "string" ? selector.pipelineId.trim() : "";
  if (!pipelineId) {
    // runtime API 的 status/stop 路由仍是 /api/pipelines/:pipelineId/*，runId/batchRunId 仅用于“精确命中当前 pipeline 运行”。
    throw new CliError("Missing pipelineId for runtime API selector", {
      code: "INVALID_ARGUMENT",
      exitCode: 2,
      details: {
        runId: selector?.runId ?? null,
        batchRunId: selector?.batchRunId ?? null,
      },
    });
  }
  return {
    pipelineId,
    target: {
      runId: selector?.runId,
      batchRunId: selector?.batchRunId,
    },
  };
};

const waitForPipelineWatchSignal = async (
  selector: CliPipelineSelector,
  timeoutMs: number,
): Promise<{ ok: true; source: "ws"; eventType: "bootstrap" | "pipeline.updated" }> => {
  const wsUrl = `${buildWsBaseUrl()}/api/ws`;
  const eventType = await new Promise<"bootstrap" | "pipeline.updated">((resolve, reject) => {
    let settled = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    const ws = new WebSocket(wsUrl);

    const finish = (error?: unknown, payload?: { eventType: "bootstrap" | "pipeline.updated" }) => {
      if (settled) return;
      settled = true;
      if (timeoutHandle) clearTimeout(timeoutHandle);
      try {
        ws.close();
      } catch {
        // Ignore close failure; caller only cares about wake-up semantics.
      }
      if (error) {
        reject(error);
        return;
      }
      resolve(payload?.eventType ?? "pipeline.updated");
    };

    const matchesPipelineUpdated = (payload: Record<string, unknown>): boolean => {
      const eventPipelineId = typeof payload.pipelineId === "string" ? payload.pipelineId.trim() : "";
      const eventRunId = typeof payload.runId === "string" ? payload.runId.trim() : "";
      const runRecord = payload.run && typeof payload.run === "object" ? payload.run as Record<string, unknown> : null;
      const runIdFromRun = typeof runRecord?.id === "string" ? runRecord.id.trim() : "";
      if (selector.pipelineId && selector.pipelineId !== eventPipelineId) return false;
      if (selector.runId) {
        return selector.runId === eventRunId || selector.runId === runIdFromRun;
      }
      // batchRunId 在 pipeline.updated 中没有稳定字段；这里把更新当作“状态可能变化”的唤醒信号，
      // 实际终态判断仍由后续 status 请求完成，避免因为事件字段缺失误判终态。
      if (selector.batchRunId) return true;
      return Boolean(selector.pipelineId);
    };

    const matchesBootstrap = (payload: Record<string, unknown>): boolean => {
      const pipelines = payload.pipelines && typeof payload.pipelines === "object"
        ? payload.pipelines as Record<string, unknown>
        : null;
      if (!pipelines) return false;
      if (selector.pipelineId && pipelines[selector.pipelineId]) return true;
      if (selector.runId) {
        for (const item of Object.values(pipelines)) {
          if (!item || typeof item !== "object") continue;
          const runId = typeof (item as { runId?: unknown }).runId === "string" ? String((item as { runId?: unknown }).runId) : "";
          if (runId && runId === selector.runId) return true;
        }
      }
      return false;
    };

    ws.on("open", () => {
      timeoutHandle = setTimeout(() => {
        finish(new CliError("Pipeline watch event-stream wait timed out", {
          code: "PIPELINE_WATCH_WS_TIMEOUT",
          exitCode: 4,
          details: {
            selector,
            timeoutMs,
            wsUrl,
          },
        }));
      }, timeoutMs);
    });

    ws.on("message", (event) => {
      const raw = typeof event === "string" ? event : event.toString();
      if (!raw) return;
      let parsed: { type?: unknown; payload?: unknown } | null = null;
      try {
        parsed = JSON.parse(raw) as { type?: unknown; payload?: unknown };
      } catch {
        return;
      }
      if (!parsed || typeof parsed.type !== "string") return;
      const payload = parsed.payload && typeof parsed.payload === "object" ? parsed.payload as Record<string, unknown> : null;
      if (!payload) return;
      if (parsed.type === "pipeline.updated" && matchesPipelineUpdated(payload)) {
        finish(undefined, { eventType: "pipeline.updated" });
        return;
      }
      if (parsed.type === "bootstrap" && matchesBootstrap(payload)) {
        finish(undefined, { eventType: "bootstrap" });
      }
    });

    ws.on("error", () => {
      finish(new CliError("Pipeline watch event-stream unavailable", {
        code: "PIPELINE_WATCH_WS_UNAVAILABLE",
        exitCode: 4,
        details: {
          selector,
          wsUrl,
        },
      }));
    });

    ws.on("close", () => {
      if (!settled) {
        finish(new CliError("Pipeline watch event-stream closed", {
          code: "PIPELINE_WATCH_WS_CLOSED",
          exitCode: 4,
          details: {
            selector,
            wsUrl,
          },
        }));
      }
    });
  });
  return { ok: true, source: "ws", eventType };
};

const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
};

const pathExists = async (filePath: string): Promise<boolean> => {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
};

const getWorkspaceRoot = (): string => {
  let current = __dirname;
  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(join(current, "package.json"))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return process.cwd();
};

const getServerRuntimeDir = (): string => {
  const override = process.env.TASKMELD_SERVER_RUNTIME_DIR?.trim();
  if (override) return override;
  return resolveTaskMeldDataPath("server");
};
const getServerRuntimeMetadataPath = (): string => join(getServerRuntimeDir(), "runtime.json");
const getServerStartupLockPath = (): string => join(getServerRuntimeDir(), "startup.lock");

const normalizeOptionalString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const writeRuntimeMetadata = async (metadata: ServerRuntimeMetadata): Promise<void> => {
  await mkdir(getServerRuntimeDir(), { recursive: true });
  await writeFile(getServerRuntimeMetadataPath(), JSON.stringify(metadata, null, 2), "utf8");
};

const readRuntimeMetadata = async (): Promise<ServerRuntimeMetadata | null> => {
  try {
    const raw = await readFile(getServerRuntimeMetadataPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<ServerRuntimeMetadata>;
    if (
      typeof parsed.pid !== "number" ||
      !Number.isFinite(parsed.pid) ||
      typeof parsed.port !== "number" ||
      !Number.isFinite(parsed.port) ||
      typeof parsed.endpoint !== "string" ||
      !parsed.endpoint.trim() ||
      typeof parsed.startedAt !== "string" ||
      !parsed.startedAt.trim()
    ) {
      return null;
    }
    return {
      serverId: normalizeOptionalString(parsed.serverId),
      pid: Math.trunc(parsed.pid),
      port: Math.trunc(parsed.port),
      endpoint: parsed.endpoint.trim(),
      startedAt: parsed.startedAt.trim(),
    };
  } catch {
    return null;
  }
};

const readServerHealth = async (): Promise<ServerHealthPayload | null> => {
  try {
    const response = await fetch(`${buildApiBaseUrl()}/api/health`);
    if (!response.ok) return null;
    const payload = await response.json() as Partial<ServerHealthPayload>;
    if (
      payload.ok !== true ||
      typeof payload.pid !== "number" ||
      !Number.isFinite(payload.pid) ||
      typeof payload.port !== "number" ||
      !Number.isFinite(payload.port) ||
      typeof payload.endpoint !== "string" ||
      !payload.endpoint.trim() ||
      typeof payload.startedAt !== "string" ||
      !payload.startedAt.trim()
    ) {
      return null;
    }
    return {
      ok: true,
      serverId: normalizeOptionalString(payload.serverId),
      pid: Math.trunc(payload.pid),
      port: Math.trunc(payload.port),
      endpoint: payload.endpoint.trim(),
      startedAt: payload.startedAt.trim(),
    };
  } catch {
    return null;
  }
};

const metadataMatchesHealth = (
  metadata: ServerRuntimeMetadata | null,
  health: ServerHealthPayload,
): boolean => {
  if (!metadata) return false;
  if (metadata.pid !== health.pid || metadata.port !== health.port || metadata.endpoint !== health.endpoint) {
    return false;
  }
  if (metadata.serverId && health.serverId) {
    return metadata.serverId === health.serverId;
  }
  // 兼容旧 metadata：早期 runtime.json 不含 serverId，此时退回 pid/port/endpoint 交叉校验。
  return true;
};

const buildMetadataFromHealth = (health: ServerHealthPayload): ServerRuntimeMetadata => ({
  serverId: health.serverId,
  pid: health.pid,
  port: health.port,
  endpoint: health.endpoint,
  startedAt: health.startedAt,
});

type RuntimeOwnershipProbe = {
  endpoint: string;
  expectedPort: number;
  ready: boolean;
  metadataPresent: boolean;
  ownership: "matched" | "metadata_missing" | "metadata_mismatch";
  ownershipMatched: boolean;
  metadataStale: boolean;
  lockStale: boolean;
  pid: number | null;
  pidRunning: boolean;
  startedAt: string | null;
  metadata: ServerRuntimeMetadata | null;
  health: ServerHealthPayload | null;
};

const getExpectedRuntimeOwner = (): { endpoint: string; port: number } => {
  const endpoint = buildApiBaseUrl();
  const parsed = new URL(endpoint);
  return {
    endpoint,
    port: Number(parsed.port),
  };
};

const probeRuntimeOwnership = async (): Promise<RuntimeOwnershipProbe> => {
  const [metadata, health] = await Promise.all([readRuntimeMetadata(), readServerHealth()]);
  const expected = getExpectedRuntimeOwner();
  const pid = metadata?.pid ?? health?.pid ?? null;
  const pidRunning = isPidRunning(pid);
  const metadataMatchesExpected = Boolean(
    metadata && metadata.endpoint === expected.endpoint && metadata.port === expected.port,
  );
  const healthMatchesExpected = Boolean(
    health && health.endpoint === expected.endpoint && health.port === expected.port,
  );
  const metadataMatchesLiveOwner = health ? metadataMatchesHealth(metadata, health) : false;
  const ownership = !metadata
    ? "metadata_missing"
    : metadataMatchesExpected && (!health || metadataMatchesLiveOwner) && (!health || healthMatchesExpected)
      ? "matched"
      : "metadata_mismatch";
  const metadataStale = Boolean(metadata && !pidRunning && !health);
  let lockStale = false;
  try {
    const lockStat = await stat(getServerStartupLockPath());
    lockStale = Date.now() - lockStat.mtimeMs > STARTUP_LOCK_STALE_MS;
  } catch {
    lockStale = false;
  }
  return {
    endpoint: expected.endpoint,
    expectedPort: expected.port,
    ready: health !== null,
    metadataPresent: metadata !== null,
    ownership,
    ownershipMatched: ownership === "matched",
    metadataStale,
    lockStale,
    pid,
    pidRunning,
    startedAt: metadata?.startedAt ?? health?.startedAt ?? null,
    metadata,
    health,
  };
};

const cleanupStaleRuntimeArtifacts = async (probe: RuntimeOwnershipProbe): Promise<void> => {
  if (probe.metadataStale) {
    await rm(getServerRuntimeMetadataPath(), { force: true });
  }
  // startup.lock 是“开始拉起”的互斥标记，不是 owner 证据；只有健康实例不存在且锁超时才允许清理。
  if (!probe.ready && probe.lockStale) {
    await rm(getServerStartupLockPath(), { force: true });
  }
};

const reconcileRuntimeMetadataWithHealth = async (probe: RuntimeOwnershipProbe): Promise<ServerRuntimeMetadata | null> => {
  if (!probe.health) return probe.metadata;
  const nextMetadata = buildMetadataFromHealth(probe.health);
  if (!metadataMatchesHealth(probe.metadata, probe.health)) {
    // health 请求已经命中了当前 CLI 期望的 endpoint；只要这份 owner 信息完整，就应该回填 metadata，
    // 否则 metadata_missing / metadata_mismatch 会在后续 ensure/status/stop 中反复被误判为异常状态。
    await writeRuntimeMetadata(nextMetadata);
    return nextMetadata;
  }
  return nextMetadata;
};

const isPidRunning = (pid: number | null | undefined): boolean => {
  if (typeof pid !== "number" || !Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(Math.trunc(pid), 0);
    return true;
  } catch {
    return false;
  }
};

const isServerHealthy = async (): Promise<boolean> => {
  return (await readServerHealth()) !== null;
};

const waitForHealth = async (timeoutMs: number): Promise<void> => {
  const startAt = Date.now();
  while (Date.now() - startAt <= timeoutMs) {
    if (await isServerHealthy()) return;
    await sleep(250);
  }
  throw new CliError("Local API server failed to become healthy", {
    code: "LOCAL_API_START_TIMEOUT",
    exitCode: 5,
    details: {
      endpoint: buildApiBaseUrl(),
      timeoutMs,
    },
  });
};

const resolveServerLaunchSpec = async (): Promise<{ command: string; args: string[]; cwd: string }> => {
  const workspaceRoot = getWorkspaceRoot();
  const distEntry = join(workspaceRoot, "dist", "src", "index.js");
  if (await pathExists(distEntry)) {
    return {
      command: process.execPath,
      args: [distEntry],
      cwd: workspaceRoot,
    };
  }

  const srcEntry = join(workspaceRoot, "src", "index.ts");
  const tsxCmd = process.platform === "win32"
    ? join(workspaceRoot, "node_modules", ".bin", "tsx.cmd")
    : join(workspaceRoot, "node_modules", ".bin", "tsx");
  if (await pathExists(srcEntry) && await pathExists(tsxCmd)) {
    return {
      command: tsxCmd,
      args: [srcEntry],
      cwd: workspaceRoot,
    };
  }

  throw new CliError("Unable to resolve local API server entry", {
    code: "LOCAL_API_ENTRY_NOT_FOUND",
    exitCode: 5,
    details: {
      workspaceRoot,
      checked: [distEntry, srcEntry, tsxCmd],
    },
  });
};

const acquireStartupLock = async (): Promise<() => Promise<void>> => {
  const lockPath = getServerStartupLockPath();
  await mkdir(getServerRuntimeDir(), { recursive: true });
  const startAt = Date.now();
  while (Date.now() - startAt <= STARTUP_TIMEOUT_MS) {
    try {
      const handle = await open(lockPath, "wx");
      return async () => {
        await handle.close();
        await rm(lockPath, { force: true });
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      if (code !== "EEXIST") {
        throw new CliError("Failed to acquire local API startup lock", {
          code: "LOCAL_API_LOCK_FAILED",
          exitCode: 5,
          details: {
            lockPath,
            error: error instanceof Error ? error.message : String(error),
          },
        });
      }
      if (await isServerHealthy()) {
        const probe = await probeRuntimeOwnership();
        await reconcileRuntimeMetadataWithHealth(probe);
        return async () => {};
      }
      try {
        const lockStat = await stat(lockPath);
        if (Date.now() - lockStat.mtimeMs > STARTUP_LOCK_STALE_MS) {
          await rm(lockPath, { force: true });
          continue;
        }
      } catch {
        continue;
      }
      await sleep(STARTUP_LOCK_WAIT_MS);
    }
  }

  throw new CliError("Timed out waiting for local API startup lock", {
    code: "LOCAL_API_LOCK_TIMEOUT",
    exitCode: 5,
    details: {
      lockPath,
      timeoutMs: STARTUP_TIMEOUT_MS,
    },
  });
};

const startLocalApiServer = async (): Promise<ServerLifecycleResult> => {
  const initialProbe = await probeRuntimeOwnership();
  await cleanupStaleRuntimeArtifacts(initialProbe);
  await reconcileRuntimeMetadataWithHealth(initialProbe);
  if (initialProbe.ready) {
    const verifiedProbe = await probeRuntimeOwnership();
    return {
      ok: true,
      endpoint: buildApiBaseUrl(),
      action: "already_running",
      reused: true,
      ownership: verifiedProbe.ownership,
      metadataStale: verifiedProbe.metadataStale,
      lockStale: verifiedProbe.lockStale,
      pid: verifiedProbe.health?.pid ?? verifiedProbe.metadata?.pid ?? verifiedProbe.pid,
      startedAt: verifiedProbe.health?.startedAt ?? verifiedProbe.metadata?.startedAt ?? verifiedProbe.startedAt,
    };
  }

  const releaseLock = await acquireStartupLock();
  try {
    const lockedProbe = await probeRuntimeOwnership();
    await cleanupStaleRuntimeArtifacts(lockedProbe);
    await reconcileRuntimeMetadataWithHealth(lockedProbe);
    if (lockedProbe.ready) {
      const verifiedProbe = await probeRuntimeOwnership();
      return {
        ok: true,
        endpoint: buildApiBaseUrl(),
        action: "already_running",
        reused: true,
        ownership: verifiedProbe.ownership,
        metadataStale: verifiedProbe.metadataStale,
        lockStale: verifiedProbe.lockStale,
        pid: verifiedProbe.health?.pid ?? verifiedProbe.metadata?.pid ?? verifiedProbe.pid,
        startedAt: verifiedProbe.health?.startedAt ?? verifiedProbe.metadata?.startedAt ?? verifiedProbe.startedAt,
      };
    }

    const launchSpec = await resolveServerLaunchSpec();
    // 后台 daemon 必须脱离当前 CLI 生命周期运行，否则 watch/start 等命令一结束就会把宿主一并带死。
    const child = spawn(launchSpec.command, launchSpec.args, {
      cwd: launchSpec.cwd,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
    await waitForHealth(STARTUP_TIMEOUT_MS);
    const finalProbe = await probeRuntimeOwnership();
    await reconcileRuntimeMetadataWithHealth(finalProbe);
    const verifiedProbe = await probeRuntimeOwnership();
    return {
      ok: true,
      endpoint: buildApiBaseUrl(),
      action: "started",
      reused: false,
      ownership: verifiedProbe.ownership,
      metadataStale: verifiedProbe.metadataStale,
      lockStale: verifiedProbe.lockStale,
      pid: verifiedProbe.health?.pid ?? verifiedProbe.metadata?.pid ?? child.pid ?? null,
      startedAt: verifiedProbe.health?.startedAt ?? verifiedProbe.metadata?.startedAt ?? null,
    };
  } finally {
    await releaseLock();
  }
};

const ensureServerReady = async (): Promise<ServerLifecycleResult> => {
  const probe = await probeRuntimeOwnership();
  await cleanupStaleRuntimeArtifacts(probe);
  await reconcileRuntimeMetadataWithHealth(probe);
  if (probe.ready) {
    const verifiedProbe = await probeRuntimeOwnership();
    return {
      ok: true,
      endpoint: buildApiBaseUrl(),
      action: "ensured",
      reused: true,
      ownership: verifiedProbe.ownership,
      metadataStale: verifiedProbe.metadataStale,
      lockStale: verifiedProbe.lockStale,
      pid: verifiedProbe.health?.pid ?? verifiedProbe.metadata?.pid ?? verifiedProbe.pid,
      startedAt: verifiedProbe.health?.startedAt ?? verifiedProbe.metadata?.startedAt ?? verifiedProbe.startedAt,
    };
  }
  const started = await startLocalApiServer();
  return {
    ...started,
    action: started.action === "already_running" ? "ensured" : started.action,
  };
};

const getServerStatus = async (): Promise<ServerStatusPayload> => {
  const probe = await probeRuntimeOwnership();
  await cleanupStaleRuntimeArtifacts(probe);
  await reconcileRuntimeMetadataWithHealth(probe);
  const verifiedProbe = await probeRuntimeOwnership();
  return {
    ok: true,
    endpoint: buildApiBaseUrl(),
    ready: verifiedProbe.ready,
    metadataPresent: verifiedProbe.metadataPresent,
    ownership: verifiedProbe.ownership,
    ownershipMatched: verifiedProbe.ownershipMatched,
    metadataStale: verifiedProbe.metadataStale,
    lockStale: verifiedProbe.lockStale,
    pid: verifiedProbe.health?.pid ?? verifiedProbe.metadata?.pid ?? null,
    pidRunning: isPidRunning(verifiedProbe.health?.pid ?? verifiedProbe.metadata?.pid ?? null),
    startedAt: verifiedProbe.health?.startedAt ?? verifiedProbe.metadata?.startedAt ?? null,
  };
};

const stopLocalApiServer = async (): Promise<ServerLifecycleResult> => {
  const probe = await probeRuntimeOwnership();
  await cleanupStaleRuntimeArtifacts(probe);
  if (!probe.metadataPresent && !probe.health) {
    return {
      ok: true,
      endpoint: buildApiBaseUrl(),
      action: "not_running",
      reused: false,
      ownership: probe.ownership,
      metadataStale: probe.metadataStale,
      lockStale: probe.lockStale,
      pid: null,
      startedAt: null,
    };
  }

  if (!probe.health) {
    const pid = probe.metadata?.pid ?? null;
    if (!isPidRunning(pid)) {
      await rm(getServerRuntimeMetadataPath(), { force: true });
      return {
        ok: true,
        endpoint: buildApiBaseUrl(),
        action: "not_running",
        reused: false,
        ownership: probe.ownership,
        metadataStale: true,
        lockStale: probe.lockStale,
        pid: pid ?? null,
        startedAt: probe.metadata?.startedAt ?? null,
      };
    }
    throw new CliError("Refusing to stop unverified local API owner", {
      code: "LOCAL_API_OWNER_UNVERIFIED",
      exitCode: 5,
      details: {
        pid,
        endpoint: buildApiBaseUrl(),
        ownership: probe.ownership,
      },
    });
  }

  const verifiedMetadata = await reconcileRuntimeMetadataWithHealth(probe);
  if (!verifiedMetadata) {
    throw new CliError("Refusing to stop: healthy API owner metadata is unavailable", {
      code: "LOCAL_API_OWNER_METADATA_MISSING",
      exitCode: 5,
      details: probe,
    });
  }
  const pid = verifiedMetadata.pid;
  if (!isPidRunning(pid)) {
    await rm(getServerRuntimeMetadataPath(), { force: true });
    return {
      ok: true,
      endpoint: buildApiBaseUrl(),
      action: "not_running",
      reused: false,
      ownership: probe.ownership,
      metadataStale: true,
      lockStale: probe.lockStale,
      pid: pid ?? null,
      startedAt: verifiedMetadata?.startedAt ?? probe.startedAt,
    };
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch (error) {
    throw new CliError("Failed to stop local API server", {
      code: "LOCAL_API_STOP_FAILED",
      exitCode: 5,
      details: {
        pid,
        detail: error instanceof Error ? error.message : String(error),
      },
    });
  }

  const startAt = Date.now();
  while (Date.now() - startAt <= STOP_TIMEOUT_MS) {
    if (!isPidRunning(pid) && !await isServerHealthy()) {
      await rm(getServerRuntimeMetadataPath(), { force: true });
      return {
        ok: true,
        endpoint: buildApiBaseUrl(),
        action: "stopped",
        reused: false,
        ownership: probe.ownership,
        metadataStale: false,
        lockStale: false,
        pid,
        startedAt: verifiedMetadata?.startedAt ?? probe.startedAt,
      };
    }
    await sleep(250);
  }

  throw new CliError("Timed out stopping local API server", {
    code: "LOCAL_API_STOP_TIMEOUT",
    exitCode: 5,
    details: {
      pid,
      endpoint: buildApiBaseUrl(),
      timeoutMs: STOP_TIMEOUT_MS,
    },
  });
};

export const createServerLifecycleClient = () => ({
  ensureServerReady,
  startServer: startLocalApiServer,
  getServerStatus,
  stopServer: stopLocalApiServer,
});

export const createPipelineRuntimeApiClientWs = () => {
  const wsUrl = `${buildWsBaseUrl()}/api/ws`;
  const wsClient = createWsRuntimeClient(wsUrl);

  return {
    ensureServerReady,
    startPipeline: async (pipelineId: string) =>
      wsClient.sendReq("pipeline.run", { pipelineId }),
    getPipelineStatus: async (selector: string | CliPipelineSelector) => {
      const resolved = resolveRuntimePipelineSelector(selector);
      const params: Record<string, unknown> = { pipelineId: resolved.pipelineId };
      if (resolved.target?.runId) params.runId = resolved.target.runId;
      if (resolved.target?.batchRunId) params.batchRunId = resolved.target.batchRunId;
      return wsClient.sendReq("pipeline.status", params);
    },
    stopPipeline: async (selector: string | CliPipelineSelector) => {
      const resolved = resolveRuntimePipelineSelector(selector);
      const params: Record<string, unknown> = { pipelineId: resolved.pipelineId };
      if (resolved.target?.runId) params.runId = resolved.target.runId;
      if (resolved.target?.batchRunId) params.batchRunId = resolved.target.batchRunId;
      return wsClient.sendReq("pipeline.stop", params);
    },
    waitForPipelineWatchSignal,
    diagnoseNode: async (pipelineId: string, nodeId: string, itemKey?: string) => {
      const params: Record<string, unknown> = { pipelineId, nodeId };
      if (itemKey) params.itemKey = itemKey;
      return wsClient.sendReq("pipeline.node.diagnostics", params);
    },
    getOutput: async (pipelineId: string, runId?: string) => {
      const params: Record<string, unknown> = { pipelineId };
      if (runId) params.runId = runId;
      return wsClient.sendReq("pipeline.output.list", params);
    },
    listOutputs: async (pipelineId: string) =>
      wsClient.sendReq("pipeline.output.list", { pipelineId }),
    listLinks: async () =>
      wsClient.sendReq("pipeline.link.list"),
    getQueue: async (pipelineId: string) =>
      wsClient.sendReq("pipeline.queue.list", { pipelineId }),
  };
};
