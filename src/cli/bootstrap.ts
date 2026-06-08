import { createAppContext } from "../app/create-app-context"
import type { AppContext } from "../app/create-app-context"
import { resolveGatewayConfig } from "../app/user-config"
import { createPipelineRuntimeApiClientWs, createServerLifecycleClient } from "./server-runtime-client"
import { CliError } from "./errors"
import type { CliAppContext, CliBootstrap, CliPipelineSelector } from "./types"

const normalizePipelineSelector = (selector: string | CliPipelineSelector): CliPipelineSelector => {
  if (typeof selector === "string") {
    return { pipelineId: selector.trim() || undefined }
  }
  return {
    pipelineId:
      typeof selector.pipelineId === "string" && selector.pipelineId.trim() ? selector.pipelineId.trim() : undefined,
    runId: typeof selector.runId === "string" && selector.runId.trim() ? selector.runId.trim() : undefined,
    batchRunId:
      typeof selector.batchRunId === "string" && selector.batchRunId.trim() ? selector.batchRunId.trim() : undefined,
  }
}

const requirePipelineId = (selector: CliPipelineSelector): string => {
  if (selector.pipelineId) return selector.pipelineId
  // The embedded runtime service can only locate a pipeline instance by pipelineId; runId/batchRunId at this layer is only used for secondary matching.
  throw new CliError("Missing pipelineId for local runtime selector", {
    code: "INVALID_ARGUMENT",
    exitCode: 2,
    details: {
      runId: selector.runId ?? null,
      batchRunId: selector.batchRunId ?? null,
    },
  })
}

const buildCliAppContext = (appContext: AppContext): CliAppContext => {
  const { readonly: readonlyServices, writable: writableServices } = appContext.services
  const serverLifecycleClient = createServerLifecycleClient()
  return {
    systemService: {
      getSnapshot: async () => readonlyServices.system.getSnapshot(),
    },
    serverService: {
      ensureServerReady: async () => serverLifecycleClient.ensureServerReady(),
      startServer: async () => serverLifecycleClient.startServer(),
      getServerStatus: async () => serverLifecycleClient.getServerStatus(),
      stopServer: async () => serverLifecycleClient.stopServer(),
    },
    pipelineService: {
      listPipelines: async () => readonlyServices.pipeline.listPipelines(),
      getPipelineById: async (pipelineId: string) => readonlyServices.pipeline.getPipeline(pipelineId),
      startPipeline: async (pipelineId: string) => writableServices.pipeline.startPipeline(pipelineId),
      getPipelineStatus: async (selector) => {
        const normalized = normalizePipelineSelector(selector)
        const pipelineId = requirePipelineId(normalized)
        return writableServices.pipeline.getPipelineExecutionStatus(pipelineId, {
          runId: normalized.runId,
          batchRunId: normalized.batchRunId,
        })
      },
      stopPipeline: async (selector) => {
        const normalized = normalizePipelineSelector(selector)
        const pipelineId = requirePipelineId(normalized)
        return writableServices.pipeline.stopPipeline(pipelineId, {
          runId: normalized.runId,
          batchRunId: normalized.batchRunId,
        })
      },
      runPipeline: async (pipelineId: string) => writableServices.pipeline.runPipeline(pipelineId),
      retryNode: async (input) => writableServices.pipeline.retryNode(input),
      diagnoseNode: async (input) => {
        const runtimeApiClient = createPipelineRuntimeApiClientWs()
        return runtimeApiClient.diagnoseNode(input.pipelineId, input.nodeId, input.itemKey)
      },
      getOutput: async (pipelineId: string, runId?: string) => writableServices.pipeline.getOutput(pipelineId, runId),
      listOutputs: async (pipelineId: string) => writableServices.pipeline.listOutputs(pipelineId),
      listLinks: async () => writableServices.pipeline.listLinks(),
      getQueue: (pipelineId: string) => writableServices.pipeline.getQueue(pipelineId),
    },
    agentService: {
      listAgents: async () => readonlyServices.agent.listAgents(),
      listSessions: async () => readonlyServices.session.listSessions(),
      filterSessionsByAgent: async (agentId: string) => {
        const raw = await readonlyServices.session.listSessions()
        const sessions = Array.isArray(raw) ? raw : []
        return sessions.filter((s) => {
          const id = typeof s?.id === "string" ? s.id : ""
          const parts = id.split(":")
          return parts.length >= 3 && parts[0] === "agent" && parts[1] === agentId
        })
      },
      sendMessage: async (input) => writableServices.session.sendMessage(input),
      getSessionHistory: async (sessionId: string) => readonlyServices.session.getSessionHistory(sessionId),
      sendMessageAndWaitForReply: async (input, options) =>
        writableServices.session.sendMessageAndWaitForReply(input, options),
      createAgent: async (params) => writableServices.agent.createAgent(params),
      updateAgent: async (params) => writableServices.agent.updateAgent(params),
      deleteAgent: async (params) => writableServices.agent.deleteAgent(params),
    },
    sessionService: {
      listSessions: async () => readonlyServices.session.listSessions(),
      sendMessage: async (input) => writableServices.session.sendMessage(input),
    },
    artifactService: {
      planCleanup: async (pipelineId, options) =>
        readonlyServices.artifact.planCleanup(pipelineId, (options ?? {}) as never),
      executeCleanup: async (pipelineId, plan) => readonlyServices.artifact.executeCleanup(pipelineId, plan as never),
      rebuildIndex: async (pipelineId) => readonlyServices.artifact.rebuildIndex(pipelineId),
      listArtifacts: async (filter) =>
        readonlyServices.artifact.listArtifacts({
          pipelineIds: filter.pipelineId ? [filter.pipelineId] : undefined,
          nodeIds: filter.nodeId ? [filter.nodeId] : undefined,
          statuses: filter.status
            ? filter.status
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
            : undefined,
          kinds: filter.kind
            ? filter.kind
                .split(",")
                .map((k) => k.trim())
                .filter(Boolean)
            : undefined,
          batchRunId: filter.batchRunId,
          runId: filter.runId,
          cursor: filter.cursor,
        }),
      getArtifactContent: async (filter) =>
        readonlyServices.artifact.getArtifactContent({
          pipelineId: filter.pipelineId,
          relativePath: filter.relativePath,
        }),
      exportArtifacts: async (filter) =>
        readonlyServices.artifact.exportArtifactContents({
          pipelineIds: filter.pipelineId ? [filter.pipelineId] : undefined,
          nodeIds: filter.nodeId ? [filter.nodeId] : undefined,
          statuses: filter.status
            ? filter.status
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
            : undefined,
          kinds: filter.kind
            ? filter.kind
                .split(",")
                .map((k) => k.trim())
                .filter(Boolean)
            : undefined,
          batchRunId: filter.batchRunId,
          dateFrom: filter.dateFrom,
          dateTo: filter.dateTo,
          limit: filter.limit,
        }),
    },
    schedulerService: {
      toggleScheduler: async (pipelineId, enabled) => writableServices.scheduler.toggleScheduler(pipelineId, enabled),
      setSchedulerMode: async (pipelineId, mode) => writableServices.scheduler.setSchedulerMode(pipelineId, mode),
    },
  }
}

const buildRuntimeApiOnlyContext = (): CliAppContext => {
  const runtimeApiClient = createPipelineRuntimeApiClientWs()
  const serverLifecycleClient = createServerLifecycleClient()
  const unsupported = async (): Promise<never> => {
    throw new Error("unsupported_cli_runtime_api_context")
  }
  return {
    systemService: {
      getSnapshot: unsupported,
    },
    serverService: {
      ensureServerReady: async () => serverLifecycleClient.ensureServerReady(),
      startServer: async () => serverLifecycleClient.startServer(),
      getServerStatus: async () => serverLifecycleClient.getServerStatus(),
      stopServer: async () => serverLifecycleClient.stopServer(),
    },
    pipelineService: {
      listPipelines: unsupported,
      getPipelineById: unsupported,
      startPipeline: async (pipelineId: string) => runtimeApiClient.startPipeline(pipelineId),
      getPipelineStatus: async (selector) => runtimeApiClient.getPipelineStatus(selector),
      stopPipeline: async (selector) => runtimeApiClient.stopPipeline(selector),
      waitForPipelineWatchSignal: async (selector, timeoutMs) =>
        runtimeApiClient.waitForPipelineWatchSignal(selector, timeoutMs),
      runPipeline: async (pipelineId: string) => runtimeApiClient.startPipeline(pipelineId),
      retryNode: unsupported,
      diagnoseNode: async (input) => runtimeApiClient.diagnoseNode(input.pipelineId, input.nodeId, input.itemKey),
      getOutput: async (pipelineId: string, runId?: string) => runtimeApiClient.getOutput(pipelineId, runId),
      listOutputs: async (pipelineId: string) => runtimeApiClient.listOutputs(pipelineId),
      listLinks: async () => runtimeApiClient.listLinks(),
      getQueue: async (pipelineId: string) => runtimeApiClient.getQueue(pipelineId),
    },
    agentService: {
      listAgents: unsupported,
      listSessions: unsupported,
      filterSessionsByAgent: unsupported,
      sendMessage: unsupported,
      getSessionHistory: unsupported,
      sendMessageAndWaitForReply: unsupported,
      createAgent: unsupported,
      updateAgent: unsupported,
      deleteAgent: unsupported,
    },
    sessionService: {
      listSessions: unsupported,
      sendMessage: unsupported,
    },
    artifactService: {
      listArtifacts: unsupported,
      getArtifactContent: unsupported,
      exportArtifacts: unsupported,
      planCleanup: unsupported,
      executeCleanup: unsupported,
      rebuildIndex: unsupported,
    },
    schedulerService: {
      toggleScheduler: unsupported,
      setSchedulerMode: unsupported,
    },
  }
}

export const createMainCliBootstrap = (): CliBootstrap => {
  return async ({ route }) => {
    const bootstrap = route.bootstrap
    if (bootstrap?.runtimeApiOnly) {
      // runtime-api-only routes must reuse the daemon-provided API semantics to avoid incorrectly falling to the embedded service path.
      if (bootstrap.ensureServerReady) {
        const serverLifecycleClient = createServerLifecycleClient()
        // Run-class commands must bind to a persistent execution host first, to avoid the CLI temporary process inadvertently acting as the daemon host.
        await serverLifecycleClient.ensureServerReady()
      }
      return {
        app: buildRuntimeApiOnlyContext(),
      }
    }

    const gatewayConfig = await resolveGatewayConfig()
    const appContext = createAppContext({
      gatewayUrl: gatewayConfig.url ?? undefined,
      gatewayToken: gatewayConfig.token ?? undefined,
    })
    await appContext.initialize()

    if (bootstrap?.gateway === "required") {
      await appContext.gateway.connect()
    } else if (bootstrap?.gateway === "warmup") {
      // For system snapshots, try connecting first; fall back to cached state on failure so read-only commands aren't completely blocked.
      try {
        await appContext.gateway.connect()
      } catch {
        // Allow read-only commands to degrade gracefully.
      }
    }

    return {
      app: buildCliAppContext(appContext),
      dispose: () => {
        appContext.dispose()
      },
    }
  }
}
