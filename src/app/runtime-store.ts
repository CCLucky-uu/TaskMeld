import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { GatewayConnectionInfo, GatewayFrame } from "../gateway";
import { sanitizeDiagnosticPayload } from "../gateway/frame-sanitizer";
import {
  addTimeline,
  seedRunWithItems,
  syncRunNodeStatusFromItemRuns,
  touchRun,
  type Run,
  type TimelineItem,
} from "../pipeline/runtime-model";
import { createTimelineLogStore } from "../pipeline/timeline-log-store";
import type { WorkflowGraph } from "../pipeline/workflow-graph";
import { resolveTaskMeldDataPath } from "./data-dir";

type RuntimeStoreOptions = {
  graph: WorkflowGraph;
  defaultItemKeys: string[];
  runStateFile: string;
  initialRun: Run;
  getSchedulerState: () => { enabled: boolean; mode: "auto" | "manual" };
  getBatchRunState?: () => Record<string, unknown> | null;
};

export const createRuntimeStore = (options: RuntimeStoreOptions) => {
  const timeline: TimelineItem[] = [];
  let run = options.initialRun;
  let latestStatus: GatewayConnectionInfo | null = null;
  let latestHello: unknown = null;
  let lastFrame: GatewayFrame | null = null;
  let broadcast: (payload: unknown) => void = () => {};
  let persistRunStateInFlight: Promise<void> | null = null;
  const timelineLogStore = createTimelineLogStore({
    rootDir: resolveTaskMeldDataPath("logs", "runs"),
  });

  const persistRunState = async () => {
    if (persistRunStateInFlight) return persistRunStateInFlight;
    persistRunStateInFlight = (async () => {
      try {
        await mkdir(resolveTaskMeldDataPath(), { recursive: true });
        await writeFile(
          options.runStateFile,
          JSON.stringify(
            {
              savedAt: new Date().toISOString(),
              workflowVersion: options.graph.getWorkflow().version,
              run,
            },
            null,
            2,
          ),
          "utf8",
        );
      } catch (error) {
        // Persistence failures should not break pipeline execution.
        pushTimeline(
          `Failed to persist run state: ${error instanceof Error ? error.message : String(error)}`,
          "warn",
        );
      }
    })().finally(() => {
      persistRunStateInFlight = null;
    });
    return persistRunStateInFlight;
  };

  const tryLoadPersistedRunState = async () => {
    try {
      const raw = await readFile(options.runStateFile, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object") return null;
      const payload = parsed as Record<string, unknown>;
      const savedRun = payload.run as Run | undefined;
      if (!savedRun || !Array.isArray(savedRun.nodes)) return null;
      if (!Array.isArray(savedRun.itemRuns)) return null;
      if (!Array.isArray(savedRun.groups)) savedRun.groups = [];
      if (!Array.isArray(savedRun.groupItemRuns)) savedRun.groupItemRuns = [];
      if (!savedRun.input) (savedRun as Record<string, unknown>).input = { trigger: "manual" };
      if (savedRun.output === undefined) (savedRun as Record<string, unknown>).output = null;
      const nodeIds = new Set(savedRun.nodes.map((node) => node.id));
      const templateNodes = options.graph.getTemplateNodes();
      if (nodeIds.size !== templateNodes.length) return null;
      for (const node of templateNodes) {
        if (!nodeIds.has(node.id)) return null;
      }
      return savedRun;
    } catch (error) {
      pushTimeline(
        `Failed to load persisted run state: ${error instanceof Error ? error.message : String(error)}`,
        "warn",
      );
      return null;
    }
  };

  const pushTimeline = (text: string, level: TimelineItem["level"] = "info", detail?: unknown) => {
    const safeDetail = detail !== undefined ? sanitizeDiagnosticPayload(detail) : undefined;
    const item = addTimeline(timeline, text, level, safeDetail);
    void timelineLogStore.appendTimeline(run.id, item);
    broadcast({
      type: "timeline.updated",
      payload: { item },
    });
  };

  const emitPipeline = () => {
    options.graph.syncRunGroupsFromWorkflow(run);
    syncRunNodeStatusFromItemRuns(run);
    touchRun(run);
    const nodesWithWorkflowMeta = options.graph.getNodesWithWorkflowMeta(run.nodes);
    broadcast({
      type: "pipeline.updated",
      payload: {
        run: { ...run, nodes: nodesWithWorkflowMeta },
        runId: run.id,
        nodes: nodesWithWorkflowMeta,
        scheduler: { ...options.getSchedulerState() },
        ...(options.getBatchRunState ? { batchRunState: options.getBatchRunState() } : {}),
      },
    });
    void persistRunState();
  };

  const restorePersistedRunState = async () => {
    const persisted = await tryLoadPersistedRunState();
    if (!persisted) return;
    run = persisted;
    options.graph.syncRunGroupsFromWorkflow(run);
    syncRunNodeStatusFromItemRuns(run);
    touchRun(run);
    pushTimeline(`Restored previous run state: ${run.id}`);
    emitPipeline();
  };

  const bootstrapRun = () => {
    if (run.itemRuns && run.itemRuns.length > 0) return;
    run = seedRunWithItems(options.graph.getTemplateNodes(), options.defaultItemKeys);
    options.graph.syncRunGroupsFromWorkflow(run);
  };

  return {
    getRun: () => run,
    setRun: (nextRun: Run) => {
      run = nextRun;
    },
    bootstrapRun,
    seedRun: (nodes = options.graph.getTemplateNodes(), itemKeys = options.defaultItemKeys) => seedRunWithItems(nodes, itemKeys),
    getTimeline: () => timeline,
    pushTimeline,
    emitPipeline,
    restorePersistedRunState,
    persistRunState,
    setBroadcast: (nextBroadcast: (payload: unknown) => void) => {
      broadcast = nextBroadcast;
    },
    broadcast: (payload: unknown) => {
      broadcast(payload);
    },
    getLatestStatus: () => latestStatus,
    setLatestStatus: (status: GatewayConnectionInfo | null) => {
      latestStatus = status;
    },
    getLatestHello: () => latestHello,
    setLatestHello: (hello: unknown) => {
      latestHello = hello;
    },
    getLastFrame: () => lastFrame,
    setLastFrame: (frame: GatewayFrame | null) => {
      lastFrame = frame;
    },
  };
};

export type RuntimeStore = ReturnType<typeof createRuntimeStore>;
