import { createItemBatchController } from "./item-batch-controller";
import { syncRunNodeStatusFromItemRuns, touchRun, type GroupItemRun, type NodeItemRun } from "./runtime-model";
import type { RuntimeStore } from "../app/runtime-store";
import type { WorkflowGraph } from "./workflow-graph";
import type { ExecutionService } from "./execution";
import type { ExecuteGroupResult, ExecuteNodeResult } from "./execution/execution-result";
import { createDependencyState } from "./scheduler/dependency-state";
import { createRunStateHelpers } from "./execution/run-state-helpers";
import { markItemReset, markGroupItemReset, markGroupReset } from "./state";
import { buildBatchItemKey } from "./identity";

type SchedulerServiceDeps = {
  pipelineId: string;
  runtimeStore: RuntimeStore;
  graph: WorkflowGraph;
  defaultItemKeys: string[];
  executionService: ExecutionService;
  onRunCompleted?: (run: ReturnType<RuntimeStore["getRun"]>) => void;
};

/**
 * 流水线调度器。
 * 负责：决定何时执行节点、管理并发、控制调度模式。
 * 不负责：节点的具体执行逻辑。
 */
export const createSchedulerService = (deps: SchedulerServiceDeps) => {
  const isSchedulerPluginEnabled = () => deps.graph.getWorkflow().plugins.scheduler.enabled;
  const schedulerState = {
    enabled: deps.graph.getWorkflow().scheduler.enabled,
    mode: deps.graph.getWorkflow().scheduler.mode,
  } as { enabled: boolean; mode: "auto" | "manual" };

  const getRun = () => deps.runtimeStore.getRun();

  const state = createRunStateHelpers({
    runtimeStore: deps.runtimeStore,
    graph: deps.graph,
    defaultItemKeys: deps.defaultItemKeys,
  });

  let drainInFlight: Promise<{ executed: number; hardFailed: boolean }> | null = null;
  let drainInFlightReason: string | null = null;
  const dependencyState = createDependencyState({
    runtimeStore: deps.runtimeStore,
    graph: deps.graph,
    ensureItemRuns: state.ensureItemRuns,
    getItemRun: state.getItemRun,
    getGroupItemRun: state.getGroupItemRun,
  });
  const { markReadyItemsFromDependencies, markReadyGroupsFromDependencies } = dependencyState;

  const pickNextRunnableBatch = (maxBatchSize = Math.max(1, deps.graph.getWorkflow().scheduler.maxConcurrency || 1)) => {
    const candidates: Array<GroupItemRun | NodeItemRun> = [];
    for (const groupItem of getRun().groupItemRuns ?? []) {
      if (groupItem.status !== "queued") continue;
      candidates.push(groupItem);
      if (candidates.length >= maxBatchSize) return candidates;
    }
    for (const item of getRun().itemRuns ?? []) {
      if (item.status !== "queued") continue;
      const node = state.getNodeById(item.nodeId);
      if (!node || !deps.graph.isWorkflowNodeEnabled(item.nodeId)) continue;
      if (deps.graph.getParallelGroupByMemberNodeId(item.nodeId)) continue;
      candidates.push(item);
      if (candidates.length >= maxBatchSize) return candidates;
    }
    return candidates;
  };

  const resetItemRunForRetry = (item: NodeItemRun) => {
    markItemReset(item, state.computeInitialItemStatus(item.nodeId), { reason: "retry_reset" });
    item.route = null;
    item.artifacts = [];
  };

  const retryNodeExecution = async (nodeId: string, itemKey?: string) => {
    const node = state.getNodeById(nodeId);
    if (!node) {
      return { ok: false as const, error: "node_not_found" };
    }

    state.ensureItemRuns();
    const affected = state.collectDownstreamSubgraph(nodeId);
    const items = (getRun().itemRuns ?? []).filter(
      (item) => affected.nodeIds.has(item.nodeId) && (!itemKey || item.itemKey === itemKey),
    );
    if (items.length === 0) {
      return { ok: false as const, error: itemKey ? "node_item_not_found" : "node_item_runs_not_found" };
    }

    for (const current of items) {
      resetItemRunForRetry(current);
    }
    for (const currentNode of getRun().nodes) {
      if (!affected.nodeIds.has(currentNode.id)) continue;
      state.resetNodeForReplay(currentNode, { clearRejectFeedbacks: currentNode.id !== nodeId });
    }
    for (const currentGroup of getRun().groups ?? []) {
      if (!affected.groupIds.has(currentGroup.id)) continue;
      markGroupReset(currentGroup, state.computeInitialGroupItemStatus(currentGroup.id), { reason: "retry_reset" });
      currentGroup.artifacts = [];
    }
    for (const currentGroupItem of getRun().groupItemRuns ?? []) {
      if (!affected.groupIds.has(currentGroupItem.groupId)) continue;
      if (itemKey && currentGroupItem.itemKey !== itemKey) continue;
      markGroupItemReset(currentGroupItem, state.computeInitialGroupItemStatus(currentGroupItem.groupId), { reason: "retry_reset" });
      currentGroupItem.attempt = 0;
      currentGroupItem.artifacts = [];
    }
    // 手动重试模式下，目标节点可能已经满足依赖但被 reset 成 blocked。
    // 这里先重新评估依赖，再决定是否立刻执行首个节点，避免稳定复现 node_retry_blocked。
    markReadyItemsFromDependencies();
    markReadyGroupsFromDependencies();

    deps.runtimeStore.emitPipeline();

    let drained: { executed: number; hardFailed: boolean } | null = null;
    if (schedulerState.mode === "manual") {
      const first = items.find((candidate) => candidate.nodeId === nodeId && candidate.status === "queued") ?? null;
      if (!first) {
        touchRun(getRun());
        deps.runtimeStore.emitPipeline();
        return { ok: false as const, error: "node_retry_blocked", node, drained };
      }
      const exec = await deps.executionService.executeNodeItem(first);
      touchRun(getRun());
      deps.runtimeStore.emitPipeline();
      return { ...exec, node, item: first, drained };
    }

    const drainSignal = deps.executionService.getOrCreateDrainSignal(getRun().id);
    drained = await drainPipeline(`retry:${nodeId}${itemKey ? `#${itemKey}` : ""}`, drainSignal);
    touchRun(getRun());
    deps.runtimeStore.emitPipeline();
    return { ok: true as const, node, drained };
  };

  /**
   * 核心调度循环。遍历就绪节点并执行。这是调度器的核心职责。
   *
   * 传入的 AbortSignal 仅用于提前退出本地排水循环；
   * 远端 agent 的停止由 executionService.abortRunControllers 通过 "/stop" 命令处理。
   */
  const drainPipeline = async (reason: string, signal?: AbortSignal) => {
    const manualTick = reason.startsWith("manual_tick");
    const forceBatchDrain = reason.startsWith("batch:");
    const explicitRunStart = reason === "run" || reason.startsWith("run:");
    const pipelineLinkDrain = reason.startsWith("pipeline_link:");
    const retryDrain = reason.startsWith("retry:");
    if (!manualTick && !forceBatchDrain && !explicitRunStart && !pipelineLinkDrain && !retryDrain) {
      if (!isSchedulerPluginEnabled()) return { executed: 0, hardFailed: false };
      if (!schedulerState.enabled) return { executed: 0, hardFailed: false };
      if (schedulerState.mode === "manual") return { executed: 0, hardFailed: false };
    }
    if (drainInFlight) {
      deps.runtimeStore.pushTimeline(`[Scheduling drain lock] caller=${reason} triggered drain, but ${drainInFlightReason} drain is already in progress, merged into existing drain`, "info");
      return drainInFlight;
    }
    drainInFlight = (async () => {
      drainInFlightReason = reason;
      let executed = 0;
      let hardFailed = false;
      const maxIterations = deps.graph.getWorkflow().scheduler.loopGuard.maxGlobalIterations;
      const maxConcurrency = Math.max(1, deps.graph.getWorkflow().scheduler.maxConcurrency || 1);
      const active = new Set<
        Promise<{
          item: GroupItemRun | NodeItemRun;
          result: ExecuteNodeResult | ExecuteGroupResult;
        }>
      >();
      let stopScheduling = false;

      const launchItem = (item: GroupItemRun | NodeItemRun) => {
        const task = ("nodeId" in item ? deps.executionService.executeNodeItem(item) : deps.executionService.executeGroupItem(item))
          .then((result) => ({ item, result }))
          .finally(() => {
            active.delete(task);
          });
        active.add(task);
      };

      while (true) {
        // 客户端侧中止：外部调用 abortRunControllers 后，signal 变为 aborted，
        // 排水循环提前退出，不再等待活跃节点自然完成。
        if (signal?.aborted) {
          stopScheduling = true;
        }

        if (executed >= maxIterations) {
          deps.runtimeStore.pushTimeline(`Scheduling reached global iteration limit: ${maxIterations}`, "warn");
          break;
        }

        while (!stopScheduling && !signal?.aborted && active.size < maxConcurrency && executed < maxIterations) {
          markReadyItemsFromDependencies();
          markReadyGroupsFromDependencies();
          const batch = pickNextRunnableBatch(maxConcurrency - active.size);
          if (batch.length === 0) break;
          const batchLabel = batch
            .map((item) => ("nodeId" in item ? `${item.nodeId}#${item.itemKey}` : `group:${item.groupId}#${item.itemKey}`))
            .join(", ");
          deps.runtimeStore.pushTimeline(`Pipeline auto-scheduled: ${batchLabel} (${reason})`);
          for (const item of batch) {
            launchItem(item);
          }
          executed += batch.length;
          if (manualTick) {
            stopScheduling = true;
            break;
          }
        }

        if (active.size === 0) break;

        const settled = await Promise.race(active);
        if (signal?.aborted) {
          stopScheduling = true;
        }
        if (!settled.result.ok && settled.result.finalStatus !== "rejected") {
          const shouldHalt = settled.result.haltPipeline !== false;
          if (shouldHalt) {
            hardFailed = true;
            stopScheduling = true;
          }
        }

        if (manualTick && stopScheduling) {
          await Promise.all(active);
          break;
        }
      }
      syncRunNodeStatusFromItemRuns(getRun());
      touchRun(getRun());
      deps.runtimeStore.emitPipeline();
      deps.onRunCompleted?.(getRun());
      return { executed, hardFailed };
    })().finally(() => {
      drainInFlight = null;
      drainInFlightReason = null;
    });
    return drainInFlight;
  };

  /**
   * 批量运行控制器。管理关键词池的分批执行生命周期（启动、停止、取消、状态查询）。
   * 属于调度器职责——控制何时及如何分批执行。
   */
  const itemBatchController = createItemBatchController({
    pipelineId: deps.pipelineId,
    executeBatch: async ({ batchItems, batchIndex, totalBatches, totalItems }) => {
      const batchItemKey = buildBatchItemKey(batchIndex);
      const nextRun = deps.runtimeStore.seedRun(deps.graph.getTemplateNodes(), [batchItemKey]);
      deps.runtimeStore.setRun(nextRun);
      deps.executionService.setActiveBatchKeywordItems([...batchItems]);
      deps.graph.syncRunGroupsFromWorkflow(nextRun);
      deps.runtimeStore.emitPipeline();
      deps.runtimeStore.pushTimeline(`Batch run started: batch ${batchIndex}/${totalBatches}, keywords ${batchItems.length}/${totalItems}`);

      let drained: { executed: number; hardFailed: boolean };
      try {
        const drainSignal = deps.executionService.getOrCreateDrainSignal(getRun().id);
        drained = await drainPipeline(`batch:${batchIndex}/${totalBatches}`, drainSignal);
        touchRun(getRun());
        deps.runtimeStore.emitPipeline();
      } finally {
        deps.executionService.setActiveBatchKeywordItems(null);
      }

      if (getRun().status === "running") {
        deps.runtimeStore.pushTimeline(`Batch run ended: batch ${batchIndex} has no further executable nodes, proceeding to next batch`, "warn", {
          batchIndex,
          totalBatches,
          drained,
          runId: getRun().id,
        });
        return { ok: true as const };
      }

      // 仅在硬失败场景停止后续批次；业务型 failed(status=failed) 允许继续下一批。
      if (drained.hardFailed) {
        deps.runtimeStore.pushTimeline(`Batch run failed: batch ${batchIndex}, subsequent batches stopped`, "error", {
          batchIndex,
          totalBatches,
          drained,
          runId: getRun().id,
        });
        return { ok: false as const, error: `batch_${batchIndex}_failed`, hardStop: true };
      }
      deps.runtimeStore.pushTimeline(`Batch run completed: batch ${batchIndex}/${totalBatches}, run=${getRun().id}`);
      return { ok: true as const };
    },
  });

  return {
    getSchedulerState: () => ({
      ...schedulerState,
      // 调度器插件关闭时，对外统一表现为 disabled，避免界面和运行时状态不一致。
      enabled: isSchedulerPluginEnabled() && schedulerState.enabled,
    }),
    setSchedulerEnabled: (enabled: boolean) => {
      schedulerState.enabled = enabled;
    },
    setSchedulerMode: (mode: "auto" | "manual") => {
      schedulerState.mode = mode;
    },
    syncSchedulerStateFromWorkflow: () => {
      schedulerState.enabled = deps.graph.getWorkflow().scheduler.enabled;
      schedulerState.mode = deps.graph.getWorkflow().scheduler.mode;
    },
    getBatchRunState: () => itemBatchController.getSnapshot(),
    startBatchRun: (items: string[], batchSize?: number, options?: { startIndex?: number }) => {
      const started = itemBatchController.start(items, batchSize, options);
      if (started.ok) {
        deps.runtimeStore.pushTimeline(`Batch run started: ${started.snapshot.totalItems} total items, ${started.snapshot.batchSize} per batch`);
      }
      return started;
    },
    stopBatchRun: () => {
      const stopped = itemBatchController.stop();
      if (stopped.ok) {
        deps.runtimeStore.pushTimeline("Batch run stop requested (takes effect after current batch completes)", "warn");
      }
      return stopped;
    },
    cancelBatchRun: () => {
      const canceled = itemBatchController.cancel();
      if (canceled.ok) {
        deps.runtimeStore.pushTimeline("Batch run cancelled immediately (plugin disabled)", "warn");
      }
      return canceled;
    },
    markReadyItemsFromDependencies,
    markReadyGroupsFromDependencies,
    retryNodeExecution,
    drainPipeline,
    abortRunControllers: deps.executionService.abortRunControllers,
    getOrCreateDrainSignal: deps.executionService.getOrCreateDrainSignal,
  };
};

export type SchedulerService = ReturnType<typeof createSchedulerService>;
