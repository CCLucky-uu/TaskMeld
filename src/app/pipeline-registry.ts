import type { GatewayClient, GatewayConnectionInfo, GatewayFrame } from "../gateway";
import { existsSync, mkdirSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadWorkflowDefinitionWithStorage, saveWorkflowDefinitionWithStorage } from "../pipeline/template";
import type { TimelineItem } from "../pipeline/runtime-model";
import {
  createPipelineDefinition,
  getDeletedPipelineRootDir,
  getDefaultPipelineId,
  loadPipelineDefinitionsDocument,
  loadPipelineDefinitions,
  savePipelineDefinitions,
  isValidPipelineId,
  type PipelineDefinition,
  type PipelineId,
} from "./pipeline-config";
import { createPipelineRuntime, type PipelineRuntime } from "./pipeline-runtime";
import { createPipelineOutputStore, type PipelineOutputStore } from "../pipeline/output/pipeline-output-store";
import { resolvePipelineOutput } from "../pipeline/output/pipeline-output-resolver";
import { createPipelineLinkStore, type PipelineLinkStore } from "../pipeline/dispatch/pipeline-link-store";
import { createPipelineInboundQueue, type PipelineInboundQueue } from "../pipeline/dispatch/pipeline-inbound-queue";
import { createPipelineLinkDispatcher } from "../pipeline/dispatch/pipeline-link-dispatcher";
import { createPipelineQueueDrainer } from "../pipeline/dispatch/pipeline-queue-drainer";

type CreatePipelineRegistryOptions = {
  client: GatewayClient;
  webOrigin: string;
  defaultItemKeys: string[];
};

type PipelineUpdatedBroadcastPayload = {
  pipelineId: PipelineId;
  run?: ReturnType<PipelineRuntime["runtime"]["getRun"]>;
  runId?: string;
  nodes?: ReturnType<PipelineRuntime["runtime"]["getRun"]>["nodes"];
  scheduler?: ReturnType<PipelineRuntime["pipeline"]["getSchedulerState"]>;
};

const sortCombinedTimeline = (items: TimelineItem[]) =>
  [...items].sort((a, b) => {
    const aTs = Date.parse(a.ts);
    const bTs = Date.parse(b.ts);
    return Number.isFinite(aTs) && Number.isFinite(bTs) ? aTs - bTs : 0;
  });

const isPipelineRuntimeBusy = (runtime: PipelineRuntime) => {
  const run = runtime.runtime.getRun();
  const batchRunState = runtime.pipeline.getBatchRunState();
  return (
    batchRunState.status === "running" ||
    run.nodes.some((node) => node.status === "running" || (Boolean(node.startedAt) && !node.finishedAt)) ||
    (run.groups ?? []).some((group) => group.status === "running" || (Boolean(group.startedAt) && !group.finishedAt))
  );
};

const createArchivedPipelineDirName = (pipelineId: PipelineId) =>
  `${pipelineId}-${new Date().toISOString().replace(/[:.]/g, "-")}`;

const buildArchivedPipelineDirPath = (pipelineId: PipelineId) => {
  const deletedRootDir = getDeletedPipelineRootDir();
  mkdirSync(deletedRootDir, { recursive: true });
  let archiveDirPath = join(deletedRootDir, createArchivedPipelineDirName(pipelineId));
  let suffix = 1;
  // 归档目录需要保证唯一，避免同秒内重复删除时互相覆盖。
  while (existsSync(archiveDirPath)) {
    archiveDirPath = join(deletedRootDir, `${createArchivedPipelineDirName(pipelineId)}-${suffix}`);
    suffix += 1;
  }
  return archiveDirPath;
};

export const createPipelineRegistry = (options: CreatePipelineRegistryOptions) => {
  const pipelineDefinitions = loadPipelineDefinitions();
  const pipelineDefinitionById = new Map<PipelineId, PipelineDefinition>(
    pipelineDefinitions.map((definition) => [definition.id, definition]),
  );

  // Create output stores per pipeline
  const outputStoreById = new Map<PipelineId, PipelineOutputStore>(
    pipelineDefinitions.map((definition) => [
      definition.id,
      createPipelineOutputStore(definition.id),
    ]),
  );

  // Create global dispatch infrastructure
  const linkStore = createPipelineLinkStore();
  const inboundQueue = createPipelineInboundQueue();

  let drainer: ReturnType<typeof createPipelineQueueDrainer> | null = null;

  const pipelineExists = (id: PipelineId) => pipelineDefinitionById.has(id);

  const dispatcher = createPipelineLinkDispatcher({
    linkStore,
    inboundQueue,
    pipelineExists,
  });

  const onRunCompleted = async (run: ReturnType<PipelineRuntime["runtime"]["getRun"]>) => {
    if (run.status !== "success") return;

    // Find the source pipeline by run id
    let sourcePipelineId: string | null = null;
    let sourceRuntime: PipelineRuntime | null = null;
    for (const [id, rt] of runtimeById) {
      if (rt.runtime.getRun().id === run.id) {
        sourcePipelineId = id;
        sourceRuntime = rt;
        break;
      }
    }
    if (!sourcePipelineId || !sourceRuntime) return;

    const workflow = sourceRuntime.workflow.getWorkflow();
    const definition = pipelineDefinitionById.get(sourcePipelineId);
    const artifactDir = definition?.artifactDir ?? "";
    const batchRunState = sourceRuntime.pipeline.getBatchRunState();

    const output = await resolvePipelineOutput(
      workflow,
      run,
      artifactDir,
      sourcePipelineId,
      batchRunState.batchRunId,
    );

    if (!output) return;

    const outputStore = outputStoreById.get(sourcePipelineId);
    if (!outputStore) return;

    const appended = await outputStore.append(output);
    if (!appended) return; // Duplicate

    // Update run output
    run.output = output;

    // Dispatch to downstream pipelines
    const dispatchResult = await dispatcher.dispatch(output);

    // Request drain for each downstream pipeline
    const links = await linkStore.list();
    const downstreamIds = new Set(
      links
        .filter((l) => l.enabled && l.fromPipelineId === sourcePipelineId)
        .map((l) => l.toPipelineId),
    );
    for (const downstreamId of downstreamIds) {
      drainer?.requestDrainInboundQueue(downstreamId);
    }
  };

  // Create runtimes with onRunCompleted
  const runtimeById = new Map<PipelineId, PipelineRuntime>(
    pipelineDefinitions.map((definition) => [
      definition.id,
      createPipelineRuntime({
        pipelineId: definition.id,
        client: options.client,
        webOrigin: options.webOrigin,
        defaultItemKeys: options.defaultItemKeys,
        workflowFilePath: definition.workflowFilePath,
        runStateFile: definition.runStateFile,
        artifactDir: definition.artifactDir,
        outputStore: outputStoreById.get(definition.id)!,
        onRunCompleted,
      }),
    ]),
  );

  // Create drainer (needs runtime access)
  drainer = createPipelineQueueDrainer({
    inboundQueue,
    linkStore,
    isPipelineBusy: (pipelineId: string) => {
      const runtime = runtimeById.get(pipelineId);
      if (!runtime) return false;
      return isPipelineRuntimeBusy(runtime);
    },
    executeInboundJob: async ({ jobId, linkId, upstreamOutput }) => {
      const job = inboundQueue.getJobById(jobId);
      if (!job) return { ok: false, runId: null, error: "job_not_found" };

      const toPipelineId = job.toPipelineId;
      const runtime = runtimeById.get(toPipelineId);
      if (!runtime) return { ok: false, runId: null, error: "pipeline_not_found" };
      if (isPipelineRuntimeBusy(runtime)) return { ok: false, runId: null, error: "pipeline_busy" };

      const now = new Date().toISOString();
      const nextRun = runtime.runtime.seedRun(
        runtime.workflow.getTemplateNodes(),
        runtime.pipeline.getItemRuns().length > 0 ? undefined : options.defaultItemKeys,
      );

      // Set pipeline_link input on the new run
      nextRun.input = {
        trigger: "pipeline_link",
        inboundJobId: jobId,
        linkId,
        upstreamOutput,
      };

      runtime.runtime.setRun(nextRun);
      runtime.workflow.getWorkflow(); // sync
      runtime.runtime.emitPipeline();

      // Mark job as running
      await inboundQueue.appendEvent({
        type: "job.running",
        at: now,
        jobId,
        targetRunId: nextRun.id,
      });

      // Start draining the pipeline
      const drainSignal = runtime.pipeline.getOrCreateDrainSignal(nextRun.id);
      const drainResult = await runtime.pipeline.drainPipeline(`pipeline_link:${jobId}`, drainSignal);

      return {
        ok: !drainResult.hardFailed,
        runId: nextRun.id,
        error: drainResult.hardFailed ? "pipeline_execution_failed" : undefined,
      };
    },
  });
  const defaultPipelineId = getDefaultPipelineId();
  let broadcast: (payload: unknown) => void = () => {};

  const bindRuntimeBroadcast = (definition: PipelineDefinition, runtime: PipelineRuntime) => {
    runtime.runtime.setBroadcast((payload) => {
      const event = payload as { type?: string; payload?: unknown };
      if (!event?.type) return;

      if (event.type === "pipeline.updated") {
        broadcast({
          type: "pipeline.updated",
          payload: {
            ...(event.payload as Record<string, unknown> | undefined),
            pipelineId: definition.id,
          } satisfies PipelineUpdatedBroadcastPayload,
        });
        return;
      }

      if (event.type === "timeline.updated") {
        broadcast({
          type: "timeline.updated",
          payload: { item: (event.payload as Record<string, unknown>).item, pipelineId: definition.id },
        });
        return;
      }

      // 网关状态/握手是全局共享事件，只透传主流水线的一份，避免前端收到重复广播。
      if (
        (event.type === "gateway.status" || event.type === "gateway.ready" || event.type === "gateway.frame") &&
        definition.id !== getPrimaryPipelineId()
      ) {
        return;
      }
      broadcast(payload);
    });
  };

  const getPipelineRuntime = (pipelineId: string): PipelineRuntime | null => runtimeById.get(pipelineId) ?? null;

  const getPrimaryRuntime = () => {
    const preferredRuntime = runtimeById.get(defaultPipelineId);
    if (preferredRuntime) return preferredRuntime;
    const fallbackRuntime = runtimeById.values().next().value;
    if (fallbackRuntime) return fallbackRuntime;
    throw new Error("pipeline_registry_empty");
  };

  const getPrimaryPipelineId = () => {
    if (runtimeById.has(defaultPipelineId)) return defaultPipelineId;
    const fallbackDefinition = pipelineDefinitions[0];
    if (fallbackDefinition) return fallbackDefinition.id;
    throw new Error("pipeline_registry_empty");
  };

  const getCombinedTimeline = () =>
    sortCombinedTimeline(
      pipelineDefinitions.flatMap((definition) => {
        const runtime = runtimeById.get(definition.id);
        return runtime ? runtime.runtime.getTimeline() : [];
      }),
    );

  const getBootstrapPayload = () => {
    const pipelines: Record<
      string,
      {
        pipelineId: PipelineId;
        title: string;
        run: ReturnType<PipelineRuntime["runtime"]["getRun"]>;
        pipeline: ReturnType<PipelineRuntime["runtime"]["getRun"]>["nodes"];
        runId: string;
        scheduler: ReturnType<PipelineRuntime["pipeline"]["getSchedulerState"]>;
        batchRunState: ReturnType<PipelineRuntime["pipeline"]["getBatchRunState"]>;
      }
    > = {};
    for (const definition of pipelineDefinitions) {
      const runtime = runtimeById.get(definition.id);
      if (!runtime) continue;
      const run = runtime.runtime.getRun();
      pipelines[definition.id] = {
        pipelineId: definition.id,
        title: definition.title,
        run: { ...run, nodes: run.nodes },
        pipeline: run.nodes,
        runId: run.id,
        scheduler: runtime.pipeline.getSchedulerState(),
        batchRunState: runtime.pipeline.getBatchRunState(),
      };
    }
    const primaryPipelineId = getPrimaryPipelineId();
    const primary = pipelines[primaryPipelineId];
    const MAX_BOOTSTRAP_TIMELINE = 50;
    const combined = getCombinedTimeline();
    return {
      pipelines,
      timeline: combined.slice(0, MAX_BOOTSTRAP_TIMELINE),
      timelineHasMore: combined.length > MAX_BOOTSTRAP_TIMELINE,
      status: getPrimaryRuntime().gateway.getLatestStatus() ?? options.client.getStatus(),
      hello: getPrimaryRuntime().gateway.getLatestHello(),
      // 保留旧字段兜底，避免前端分阶段改造时直接失效。
      run: primary?.run,
      pipeline: primary?.pipeline,
      runId: primary?.runId,
      scheduler: primary?.scheduler,
    };
  };

  const broadcastBootstrapPayload = () => {
    // 流水线资源发生新增、删除、重命名时，直接广播完整 bootstrap；
    // 这样已连接前端可以一次性拿到最新 definitions + 运行态快照，避免自己拼补丁遗漏字段。
    broadcast({
      type: "bootstrap",
      payload: getBootstrapPayload(),
    });
  };

  for (const definition of pipelineDefinitions) {
    const runtime = runtimeById.get(definition.id);
    if (!runtime) continue;
    bindRuntimeBroadcast(definition, runtime);
  }

  const createRuntimeForDefinition = (definition: PipelineDefinition) =>
    createPipelineRuntime({
      pipelineId: definition.id,
      client: options.client,
      webOrigin: options.webOrigin,
      defaultItemKeys: options.defaultItemKeys,
      workflowFilePath: definition.workflowFilePath,
      runStateFile: definition.runStateFile,
      artifactDir: definition.artifactDir,
      outputStore: outputStoreById.get(definition.id) ?? createPipelineOutputStore(definition.id),
      onRunCompleted,
    });

  const persistDefinitions = (items: Array<{ id: PipelineId; title: string }>, defaultPipelineId?: PipelineId) => {
    const currentDocument = loadPipelineDefinitionsDocument();
    return savePipelineDefinitions({
      ...currentDocument,
      defaultPipelineId:
        defaultPipelineId && items.some((item) => item.id === defaultPipelineId)
          ? defaultPipelineId
          : items[0]?.id ?? currentDocument.defaultPipelineId,
      items,
    });
  };

  const initializePipelineWorkflowFile = (definition: PipelineDefinition, cloneFrom?: PipelineDefinition) => {
    if (cloneFrom) {
      // 克隆只复制 workflow 定义，运行态和产物目录仍由新流水线独立初始化。
      const sourceWorkflow = loadWorkflowDefinitionWithStorage({ workflowFilePath: cloneFrom.workflowFilePath });
      saveWorkflowDefinitionWithStorage(sourceWorkflow, { workflowFilePath: definition.workflowFilePath });
      return;
    }
    const defaultWorkflow = loadWorkflowDefinitionWithStorage({ workflowFilePath: definition.workflowFilePath });
    saveWorkflowDefinitionWithStorage(defaultWorkflow, { workflowFilePath: definition.workflowFilePath });
  };

  const archivePipelineDirectory = (definition: PipelineDefinition) => {
    const pipelineDir = dirname(definition.workflowFilePath);
    if (!existsSync(pipelineDir)) return;
    const archivedDirPath = buildArchivedPipelineDirPath(definition.id);
    renameSync(pipelineDir, archivedDirPath);
  };

  return {
    initialize: async () => {
      await inboundQueue.initialize();
      for (const definition of pipelineDefinitions) {
        const runtime = runtimeById.get(definition.id);
        if (!runtime) continue;
        await runtime.initialize();
      }
      // 启动时扫描所有流水线，对已有 pending job 的队列触发 drain
      for (const definition of pipelineDefinitions) {
        const pendingCount = inboundQueue.getPendingCount(definition.id);
        if (pendingCount > 0) {
          drainer?.requestDrainInboundQueue(definition.id);
        }
      }
    },
    dispose: () => {
      for (const runtime of runtimeById.values()) {
        runtime.dispose();
      }
    },
    runtime: {
      setBroadcast: (nextBroadcast: (payload: unknown) => void) => {
        broadcast = nextBroadcast;
      },
      getCombinedTimeline,
    },
    gateway: {
      client: options.client,
      getLatestStatus: () => getPrimaryRuntime().gateway.getLatestStatus(),
      getLatestHello: () => getPrimaryRuntime().gateway.getLatestHello(),
      getLastFrame: () => getPrimaryRuntime().gateway.getLastFrame(),
      refreshSessionsFromGateway: () => getPrimaryRuntime().gateway.refreshSessionsFromGateway(),
      getSessionCache: () => getPrimaryRuntime().gateway.getSessionCache(),
      pickArray: getPrimaryRuntime().gateway.pickArray,
    },
    getBootstrapPayload,
    listPipelines: () => [...pipelineDefinitions],
    createPipeline: async (input: { id: PipelineId; title?: string; cloneFrom?: PipelineId }) => {
      const nextPipelineId = input.id.trim();
      if (!isValidPipelineId(nextPipelineId)) {
        throw new Error("pipeline_id_invalid");
      }
      if (pipelineDefinitionById.has(nextPipelineId)) {
        throw new Error("pipeline_already_exists");
      }
      const cloneSourceDefinition = input.cloneFrom ? pipelineDefinitionById.get(input.cloneFrom) ?? null : null;
      if (input.cloneFrom && !cloneSourceDefinition) {
        throw new Error("pipeline_clone_source_not_found");
      }
      const definition = createPipelineDefinition(nextPipelineId, input.title);
      const currentDocument = loadPipelineDefinitionsDocument();
      persistDefinitions([...currentDocument.items, { id: definition.id, title: definition.title }], currentDocument.defaultPipelineId);
      let runtime: PipelineRuntime | null = null;

      try {
        // 先把目标流水线的 workflow 文件初始化到位，再创建 runtime；
        // 否则 runtime 构造阶段会先读到默认 workflow，导致“磁盘已克隆、内存仍是默认”的假克隆问题。
        initializePipelineWorkflowFile(definition, cloneSourceDefinition ?? undefined);
        runtime = createRuntimeForDefinition(definition);
        bindRuntimeBroadcast(definition, runtime);
        await runtime.initialize();
        pipelineDefinitions.push(definition);
        pipelineDefinitionById.set(definition.id, definition);
        runtimeById.set(definition.id, runtime);
        outputStoreById.set(definition.id, createPipelineOutputStore(definition.id));
        broadcastBootstrapPayload();
        return definition;
      } catch (error) {
        runtime?.dispose();
        savePipelineDefinitions(currentDocument);
        throw error;
      }
    },
    renamePipeline: (pipelineId: PipelineId, title: string) => {
      const definition = pipelineDefinitionById.get(pipelineId);
      if (!definition) {
        throw new Error("pipeline_not_found");
      }
      const normalizedTitle = title.trim();
      if (!normalizedTitle) {
        throw new Error("pipeline_title_invalid");
      }

      const currentDocument = loadPipelineDefinitionsDocument();
      const nextItems = currentDocument.items.map((item) =>
        item.id === pipelineId
          ? {
            ...item,
            title: normalizedTitle,
          }
          : item,
      );
      persistDefinitions(nextItems, currentDocument.defaultPipelineId);
      definition.title = normalizedTitle;
      broadcastBootstrapPayload();
      return { ...definition };
    },
    deletePipeline: (pipelineId: PipelineId) => {
      const definitionIndex = pipelineDefinitions.findIndex((definition) => definition.id === pipelineId);
      if (definitionIndex < 0) {
        throw new Error("pipeline_not_found");
      }
      if (pipelineDefinitions.length <= 1) {
        throw new Error("pipeline_delete_last_forbidden");
      }
      const runtime = runtimeById.get(pipelineId);
      if (!runtime) {
        throw new Error("pipeline_not_found");
      }
      if (isPipelineRuntimeBusy(runtime)) {
        throw new Error("pipeline_delete_running_forbidden");
      }

      const currentDocument = loadPipelineDefinitionsDocument();
      const nextItems = currentDocument.items.filter((item) => item.id !== pipelineId);
      const fallbackPipelineId = nextItems[0]?.id ?? currentDocument.defaultPipelineId;
      persistDefinitions(
        nextItems,
        currentDocument.defaultPipelineId === pipelineId ? fallbackPipelineId : currentDocument.defaultPipelineId,
      );
      try {
        archivePipelineDirectory(pipelineDefinitions[definitionIndex]);
      } catch (error) {
        // 归档失败时立即回滚 definitions，避免页面列表先把流水线删掉但目录仍保持原位。
        savePipelineDefinitions(currentDocument);
        throw error;
      }
      runtime.dispose();
      runtimeById.delete(pipelineId);
      pipelineDefinitionById.delete(pipelineId);
      pipelineDefinitions.splice(definitionIndex, 1);
      broadcastBootstrapPayload();
      return { pipelineId };
    },
    getPipelineRuntime,
    getPrimaryRuntime,
    getPipelineDefinition: (pipelineId: PipelineId) => pipelineDefinitionById.get(pipelineId) ?? null,
    dispatch: {
      listLinks: linkStore.list.bind(linkStore),
      getLinkById: linkStore.getById.bind(linkStore),
      createLink: linkStore.create.bind(linkStore),
      updateLink: linkStore.update.bind(linkStore),
      deleteLink: linkStore.remove.bind(linkStore),
      getQueue: (pipelineId: string) => inboundQueue.getJobs(pipelineId),
      getPendingJobs: (pipelineId: string) => inboundQueue.getPendingJobs(pipelineId),
      getRunningJob: (pipelineId: string) => inboundQueue.getRunningJob(pipelineId),
      cancelJob: inboundQueue.cancelJob.bind(inboundQueue),
      retryJob: async (jobId: string) => {
        const result = await inboundQueue.retryJob(jobId);
        if (result.ok) {
          drainer?.requestDrainInboundQueue(result.job.toPipelineId);
        }
        return result;
      },
      drainQueue: (pipelineId: string) => {
        drainer?.requestDrainInboundQueue(pipelineId);
      },
    },
    onGatewayStatus: (status: GatewayConnectionInfo) => {
      for (const runtime of runtimeById.values()) runtime.onGatewayStatus(status);
    },
    onGatewayFrame: (frame: GatewayFrame) => {
      for (const runtime of runtimeById.values()) runtime.onGatewayFrame(frame);
    },
    onGatewayRawFrame: (rawFrame: GatewayFrame) => {
      if (rawFrame.type !== "event" && rawFrame.type !== "res") return;
      const payload = (rawFrame as { payload?: unknown }).payload as Record<string, unknown> | undefined;
      const sessionKey = payload
        ? (typeof payload.sessionKey === "string" && payload.sessionKey) ||
          (typeof payload.sessionId === "string" && payload.sessionId) ||
          (typeof payload.key === "string" && payload.key) ||
          (typeof payload.session === "string" && payload.session) ||
          null
        : null;

      if (sessionKey) {
        let routed = false;
        for (const runtime of runtimeById.values()) {
          if (runtime.hasActiveSession?.(sessionKey)) {
            runtime.onGatewayRawFrame(rawFrame);
            routed = true;
          }
        }
        if (routed) return;
      }
      // 无法判定 sessionKey 或无匹配 runtime 时，投递全部
      for (const runtime of runtimeById.values()) {
        runtime.onGatewayRawFrame(rawFrame);
      }
    },
    onGatewayError: (error: unknown) => {
      for (const runtime of runtimeById.values()) runtime.onGatewayError(error);
    },
    onGatewayReady: (hello: unknown) => {
      for (const runtime of runtimeById.values()) runtime.onGatewayReady(hello);
    },
  };
};

export type PipelineRegistry = ReturnType<typeof createPipelineRegistry>;
