import type { GatewayClient, GatewayConnectionInfo, GatewayFrame } from "../gateway";
import type { ServerResponse } from "node:http";
import { sendJson as sendJsonBase } from "../server/http-utils";
import {
  loadPipelineTemplateWithStorage,
  loadWorkflowDefinitionWithStorage,
  mergeTemplateNodesIntoWorkflow,
  type PipelineTemplateNode,
  type WorkflowDefinitionRuntime,
} from "../pipeline/template";
import { getPipelineNodeExecutionTimeoutMs } from "../pipeline/execution-timeout";
import { seedRunWithItems, touchRun } from "../pipeline/runtime-model";
import { pickArray } from "../utils/array";
import { createWorkflowGraph } from "../pipeline/workflow-graph";
import { createRuntimeStore, type RuntimeStore } from "./runtime-store";
import { createExecutionService } from "../pipeline/execution";
import { createSchedulerService } from "../pipeline/scheduler-service";
import type { PipelineOutputStore } from "../pipeline/output/pipeline-output-store";

type CreatePipelineRuntimeOptions = {
  pipelineId: string;
  client: GatewayClient;
  webOrigin: string;
  defaultItemKeys: string[];
  runStateFile: string;
  workflowFilePath: string;
  artifactDir: string;
  outputStore: PipelineOutputStore;
  onRunCompleted?: (run: ReturnType<RuntimeStore["getRun"]>) => void;
};

export const createPipelineRuntime = (options: CreatePipelineRuntimeOptions) => {
  const graph = createWorkflowGraph(
    loadWorkflowDefinitionWithStorage({ workflowFilePath: options.workflowFilePath }),
    loadPipelineTemplateWithStorage({ workflowFilePath: options.workflowFilePath }),
  );
  const initialRun = seedRunWithItems(graph.getTemplateNodes(), options.defaultItemKeys);
  let schedulerStateAccessor = () => ({ enabled: graph.getWorkflow().scheduler.enabled, mode: graph.getWorkflow().scheduler.mode });
  let batchRunStateGetter = () => null as Record<string, unknown> | null;

  const runtimeStore = createRuntimeStore({
    graph,
    defaultItemKeys: options.defaultItemKeys,
    runStateFile: options.runStateFile,
    initialRun,
    getSchedulerState: () => schedulerStateAccessor(),
    getBatchRunState: () => batchRunStateGetter(),
  });

  let getBatchRunId = () => null as string | null;
  const executionService = createExecutionService({
    client: options.client,
    runtimeStore,
    graph,
    artifactDir: options.artifactDir,
    pipelineId: options.pipelineId,
    pipelineNodeExecutionTimeoutMs: getPipelineNodeExecutionTimeoutMs(),
    defaultItemKeys: options.defaultItemKeys,
    getBatchRunId: () => getBatchRunId(),
  });

  const schedulerService = createSchedulerService({
    pipelineId: options.pipelineId,
    runtimeStore,
    graph,
    defaultItemKeys: options.defaultItemKeys,
    executionService,
    onRunCompleted: options.onRunCompleted,
  });
  getBatchRunId = () => schedulerService.getBatchRunState().batchRunId;
  schedulerStateAccessor = schedulerService.getSchedulerState;
  batchRunStateGetter = () => schedulerService.getBatchRunState() as Record<string, unknown> | null;

  const sendJson = (res: ServerResponse, code: number, data: unknown) =>
    sendJsonBase(res, code, data, options.webOrigin);

  const setRun = (nextRun: ReturnType<typeof runtimeStore.getRun>) => {
    runtimeStore.setRun(nextRun);
    graph.syncRunGroupsFromWorkflow(nextRun);
    if (!nextRun.itemRuns || nextRun.itemRuns.length === 0) {
      runtimeStore.setRun(seedRunWithItems(graph.getTemplateNodes(), options.defaultItemKeys));
      graph.syncRunGroupsFromWorkflow(runtimeStore.getRun());
    }
  };

  const setTemplateNodes = (nextNodes: PipelineTemplateNode[]) => {
    graph.setTemplateNodes(nextNodes);
  };

  const setWorkflow = (nextWorkflow: WorkflowDefinitionRuntime) => {
    graph.setWorkflow(nextWorkflow);
    schedulerService.syncSchedulerStateFromWorkflow();
    graph.syncRunGroupsFromWorkflow(runtimeStore.getRun());
  };

  const onGatewayStatus = (status: GatewayConnectionInfo) => {
    runtimeStore.setLatestStatus(status);
    runtimeStore.pushTimeline(`网关状态: ${status.status}`, status.status.includes("failed") ? "error" : "info");
    runtimeStore.broadcast({
      type: "gateway.status",
      payload: status,
    });
  };

  const onGatewayFrame = (frame: GatewayFrame) => {
    const isHealthEvent = frame.type === "event" && frame.event === "health";
    const isTickEvent = frame.type === "event" && frame.event === "tick";
    const isSilentEvent = isHealthEvent || isTickEvent;
    runtimeStore.setLastFrame(frame);
    if (frame.type === "event" && !isSilentEvent) {
      runtimeStore.pushTimeline(`事件: ${frame.event}`, "info", {
        type: "event",
        event: frame.event,
        seq: frame.seq ?? null,
        stateVersion: frame.stateVersion ?? null,
        payload: frame.payload ?? null,
      });
    }
    // health / tick 都是高频事件，只保留为 lastFrame，不推送到 timeline / ws，
    // 避免前端与日志被刷屏，同时不影响依赖最后一帧做诊断的调试能力。
    if (!isSilentEvent) {
      runtimeStore.broadcast({
        type: "gateway.frame",
        payload: frame,
      });
    }
  };

  const onGatewayRawFrame = (rawFrame: GatewayFrame) => {
    executionService.onGatewayFrame(rawFrame);
  };

  const onGatewayError = (error: unknown) => {
    runtimeStore.pushTimeline(`网关错误: ${String(error)}`, "error");
    runtimeStore.broadcast({
      type: "gateway.error",
      payload: { message: String(error) },
    });
  };

  const onGatewayReady = (hello: unknown) => {
    runtimeStore.setLatestHello(hello);
    runtimeStore.pushTimeline("网关握手完成");
    runtimeStore.emitPipeline();
    runtimeStore.broadcast({
      type: "gateway.ready",
      payload: hello,
    });
  };

  const getBootstrapPayload = () => {
    const run = runtimeStore.getRun();
    const nodesWithWorkflowMeta = graph.getNodesWithWorkflowMeta(run.nodes);
    return {
      status: runtimeStore.getLatestStatus() ?? options.client.getStatus(),
      timeline: runtimeStore.getTimeline(),
      run: { ...run, nodes: nodesWithWorkflowMeta },
      pipeline: nodesWithWorkflowMeta,
      runId: run.id,
      hello: runtimeStore.getLatestHello(),
      scheduler: schedulerService.getSchedulerState(),
      batchRunState: schedulerService.getBatchRunState(),
    };
  };

  const hasActiveSession = (sessionKey: string): boolean => {
    return executionService.hasActiveSession?.(sessionKey) ?? false;
  };

  const initialize = async () => {
    await runtimeStore.restorePersistedRunState();
  };

  return {
    initialize,
    dispose: () => executionService.dispose(),
    sendJson,
    getBootstrapPayload,
    onGatewayStatus,
    onGatewayFrame,
    onGatewayRawFrame,
    hasActiveSession,
    onGatewayError,
    onGatewayReady,
    runtime: {
      setBroadcast: runtimeStore.setBroadcast,
      pushTimeline: runtimeStore.pushTimeline,
      emitPipeline: runtimeStore.emitPipeline,
      getRun: runtimeStore.getRun,
      setRun,
      seedRun: runtimeStore.seedRun,
      getTimeline: runtimeStore.getTimeline,
      touchRun,
    },
    gateway: {
      client: options.client,
      getLatestStatus: runtimeStore.getLatestStatus,
      getLatestHello: runtimeStore.getLatestHello,
      getLastFrame: runtimeStore.getLastFrame,
      refreshSessionsFromGateway: executionService.refreshSessionsFromGateway,
      getSessionCache: executionService.getSessionCache,
      getExecutorSessionByAgentId: executionService.getExecutorSessionByAgentId,
      pickArray,
    },
    workflow: {
      getTemplateNodes: graph.getTemplateNodes,
      setTemplateNodes,
      getWorkflow: graph.getWorkflow,
      setWorkflow,
      mergeTemplateNodesIntoWorkflow,
      getWorkflowNodeById: graph.getWorkflowNodeById,
      getIncomingEdges: graph.getIncomingEdges,
      isCrossBranchEdge: graph.isCrossBranchEdge,
      isGroupId: graph.isGroupId,
      isWorkflowNodeEnabled: graph.isWorkflowNodeEnabled,
      pipelineId: options.pipelineId,
    },
    pipeline: {
      getItemRuns: () => runtimeStore.getRun().itemRuns ?? [],
      executeNode: executionService.executeNode,
      retryNodeExecution: schedulerService.retryNodeExecution,
      drainPipeline: schedulerService.drainPipeline,
      getSchedulerState: schedulerService.getSchedulerState,
      setSchedulerEnabled: schedulerService.setSchedulerEnabled,
      setSchedulerMode: schedulerService.setSchedulerMode,
      getBatchRunState: schedulerService.getBatchRunState,
      startBatchRun: schedulerService.startBatchRun,
      stopBatchRun: schedulerService.stopBatchRun,
      cancelBatchRun: schedulerService.cancelBatchRun,
      abortRunControllers: executionService.abortRunControllers,
      getOrCreateDrainSignal: executionService.getOrCreateDrainSignal,
    },
    output: {
      list: options.outputStore.list.bind(options.outputStore),
      getByRunId: options.outputStore.getByRunId.bind(options.outputStore),
      getById: options.outputStore.getById.bind(options.outputStore),
      append: options.outputStore.append.bind(options.outputStore),
    },
  };
};

export type PipelineRuntime = ReturnType<typeof createPipelineRuntime>;
