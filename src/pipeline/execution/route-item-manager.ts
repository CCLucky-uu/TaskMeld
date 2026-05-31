import { randomUUID } from "node:crypto";
import type { RuntimeStore } from "../../app/runtime-store";
import type { WorkflowGraph } from "../workflow-graph";
import type { GroupItemRun, NodeItemRun } from "../runtime-model";
import type { ResultEnvelope } from "../structured-output";
import type { RunStateHelpers } from "./run-state-helpers";
import { canPromoteToQueuedByDependency } from "./readiness-state";
import { transitionStatus } from "../state-machine";
import { buildDerivedRouteItemKey } from "../identity";
import { MAINLINE_ROUTE_VALUE } from "../workflow/routes";
import {
  markItemSuccess,
  markItemWaiting,
  markItemQueued,
  markItemReset,
  markGroupItemQueued,
  markGroupItemReset,
} from "../state";
import type { StateTransitionContext } from "../state";

const ctx = (reason: string, extra?: Partial<Omit<StateTransitionContext, "reason">>): StateTransitionContext => ({ reason, ...extra });

type CreateRouteItemManagerOptions = {
  runtimeStore: RuntimeStore;
  graph: WorkflowGraph;
  state: RunStateHelpers;
};

const normalizeAllowedRoute = (rawRoute: unknown, allowedRoutes: string[]) => {
  if (typeof rawRoute !== "string") return null;
  const trimmed = rawRoute.trim();
  if (!trimmed) return null;
  if (allowedRoutes.length === 0) return trimmed;
  const direct = allowedRoutes.find((route) => route === trimmed);
  if (direct) return direct;
  const lower = trimmed.toLowerCase();
  // 与结构化校验保持一致：大小写不一致时使用工作流声明值，避免命中丢失。
  return allowedRoutes.find((route) => route.toLowerCase() === lower) ?? null;
};

const collectRouteBuckets = (content: unknown, allowedRoutes: string[]) => {
  if (!Array.isArray(content)) return [] as Array<{ route: string; count: number }>;
  const counts = new Map<string, number>();
  for (const entry of content) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const route = normalizeAllowedRoute((entry as Record<string, unknown>).route, allowedRoutes);
    if (!route) continue;
    (entry as Record<string, unknown>).route = route;
    counts.set(route, (counts.get(route) ?? 0) + 1);
  }
  return [...counts.entries()].map(([route, count]) => ({ route, count }));
};

export const createRouteItemManager = (options: CreateRouteItemManagerOptions) => {
  const clearDerivedRouteItemRuns = (item: NodeItemRun) => {
    const run = options.state.getRun();
    const prefix = `${item.itemKey}::${item.nodeId}:`;
    run.itemRuns = (run.itemRuns ?? []).filter((candidate) => !candidate.itemKey.startsWith(prefix));
    run.groupItemRuns = (run.groupItemRuns ?? []).filter((candidate) => !candidate.itemKey.startsWith(prefix));
  };

  const resetNodeItemRun = (target: NodeItemRun, status: NodeItemRun["status"]) => {
    markItemReset(target, status, ctx("route_reset", { command: "retry_reset" }));
    target.route = null;
    target.attempt = 0;
    target.loopCount = 0;
    target.artifacts = [];
  };

  const resetGroupItemRun = (target: GroupItemRun, status: GroupItemRun["status"]) => {
    markGroupItemReset(target, status, ctx("route_reset", { command: "retry_reset" }));
    target.attempt = 0;
    target.artifacts = [];
  };

  const copyNodeItemRun = (target: NodeItemRun, source: NodeItemRun) => {
    target.status = transitionStatus(target.status, source.status, "route_backfill");
    target.route = source.route;
    target.attempt = source.attempt;
    target.loopCount = source.loopCount;
    target.wakeAt = source.wakeAt;
    target.startedAt = source.startedAt;
    target.finishedAt = source.finishedAt;
    target.lastError = source.lastError;
    target.artifacts = source.artifacts;
  };

  const copyGroupItemRun = (target: GroupItemRun, source: GroupItemRun) => {
    target.status = transitionStatus(target.status, source.status, "route_backfill");
    target.attempt = source.attempt;
    target.startedAt = source.startedAt;
    target.finishedAt = source.finishedAt;
    target.lastError = source.lastError;
    target.artifacts = source.artifacts;
  };

  const initializeDerivedRouteItemKey = (sourceItem: NodeItemRun, derivedItemKey: string, route: string) => {
    const run = options.state.getRun();
    options.graph.syncRunGroupsFromWorkflow(run);
    if (!run.itemRuns) run.itemRuns = [];
    if (!run.groupItemRuns) run.groupItemRuns = [];

    const outgoingEdges = options.graph.getOutgoingEdges(sourceItem.nodeId);
    const isRouteNode = (options.graph.getWorkflowNodeById(sourceItem.nodeId)?.routePolicy?.allowed.length ?? 0) > 0;
    const startTargets = outgoingEdges
      // 分流节点中 yes 是主线语义：只沿普通依赖边初始化；no/自定义值只沿路由边初始化。
      .filter((edge) => (isRouteNode ? (route === MAINLINE_ROUTE_VALUE ? edge.when === null : edge.when === route) : !edge.when))
      .map((edge) => edge.to);
    const reachable = options.state.collectReachableEntities(startTargets);
    const ancestors = options.state.collectAncestorEntities([sourceItem.nodeId, ...startTargets]);

    for (const node of run.nodes) {
      let target = options.state.getItemRun(node.id, derivedItemKey);
      if (!target) {
        target = {
          id: randomUUID(),
          nodeId: node.id,
          itemKey: derivedItemKey,
          status: "blocked",
          route: null,
          attempt: 0,
          loopCount: 0,
          wakeAt: null,
          startedAt: null,
          finishedAt: null,
          lastError: null,
          artifacts: [],
        };
        run.itemRuns.push(target);
      }
      const source = options.state.getItemRun(node.id, sourceItem.itemKey);
      if (node.id === sourceItem.nodeId) {
        copyNodeItemRun(target, source ?? sourceItem);
        markItemSuccess(target, ctx("route_init_success", { command: "route_backfill" }));
        target.route = route;
        continue;
      }
      if (ancestors.nodeIds.has(node.id)) {
        if (source) {
          copyNodeItemRun(target, source);
        } else {
          resetNodeItemRun(target, options.state.computeInitialItemStatus(node.id));
        }
        continue;
      }
      if (reachable.nodeIds.has(node.id)) {
        resetNodeItemRun(target, options.state.computeInitialItemStatus(node.id));
        continue;
      }
      resetNodeItemRun(target, "skipped");
    }

    for (const group of run.groups ?? []) {
      let target = options.state.getGroupItemRun(group.id, derivedItemKey);
      if (!target) {
        target = {
          id: randomUUID(),
          groupId: group.id,
          itemKey: derivedItemKey,
          status: "blocked",
          attempt: 0,
          startedAt: null,
          finishedAt: null,
          lastError: null,
          artifacts: [],
        };
        run.groupItemRuns.push(target);
      }
      const source = options.state.getGroupItemRun(group.id, sourceItem.itemKey);
      if (ancestors.groupIds.has(group.id)) {
        if (source) {
          copyGroupItemRun(target, source);
        } else {
          resetGroupItemRun(target, options.state.computeInitialGroupItemStatus(group.id));
        }
        continue;
      }
      if (reachable.groupIds.has(group.id)) {
        resetGroupItemRun(target, options.state.computeInitialGroupItemStatus(group.id));
        continue;
      }
      resetGroupItemRun(target, "skipped");
    }
  };

  const applyEnvelopeOutcomeToItem = async (
    item: NodeItemRun,
    envelope: ResultEnvelope | null,
    opts?: { suppressOutgoing?: boolean },
  ) => {
    if (!envelope) return;
    const workflowNode = options.graph.getWorkflowNodeById(item.nodeId);
    const allowedRoutes = workflowNode?.routePolicy?.allowed ?? [];
    const isRouteNode = allowedRoutes.length > 0;
    item.route = null;

    if (isRouteNode) {
      clearDerivedRouteItemRuns(item);
      const routeBuckets = collectRouteBuckets(envelope.artifacts[0]?.content, allowedRoutes);
      for (const bucket of routeBuckets) {
        const derivedItemKey = buildDerivedRouteItemKey(item.itemKey, item.nodeId, bucket.route);
        initializeDerivedRouteItemKey(item, derivedItemKey, bucket.route);
        const nextItem = options.state.getItemRun(item.nodeId, derivedItemKey);
        if (!nextItem) continue;
        markItemSuccess(nextItem, ctx("route_hit", { command: "route_backfill" }));
        nextItem.route = bucket.route;
        nextItem.attempt = Math.max(nextItem.attempt, item.attempt);
        nextItem.startedAt = item.startedAt;
        nextItem.finishedAt = item.finishedAt ?? new Date().toISOString();
        nextItem.wakeAt = null;
        nextItem.artifacts = item.artifacts;
        if (!opts?.suppressOutgoing) {
          for (const edge of options.graph.getOutgoingEdges(item.nodeId)) {
            if (bucket.route === MAINLINE_ROUTE_VALUE) continue;
            // 路由节点只按命中的 route 边推进，普通边在此一律忽略，避免主线被隐式直通。
            if (edge.when !== bucket.route) continue;
            if (options.graph.isGroupId(edge.to)) {
              options.state.ensureGroupItemKeyInitialized(derivedItemKey);
              const downstreamGroup = options.state.getGroupItemRun(edge.to, derivedItemKey);
              if (downstreamGroup && canPromoteToQueuedByDependency(downstreamGroup)) {
                markGroupItemQueued(downstreamGroup, ctx("route_downstream"));
              }
              continue;
            }
            const downstream = options.state.getItemRun(edge.to, derivedItemKey);
            if (!downstream) continue;
            if (canPromoteToQueuedByDependency(downstream)) {
              markItemQueued(downstream, ctx("route_downstream"));
            }
          }
        }
        options.runtimeStore.pushTimeline(`Route hit: ${item.nodeId}#${item.itemKey} -> ${bucket.route} (${bucket.count} items)`);
      }
    }

    const sleepUntil = envelope.control?.sleepUntil;
    if (typeof sleepUntil === "string" && sleepUntil.trim()) {
      const parsed = Date.parse(sleepUntil);
      if (Number.isFinite(parsed)) {
        const wakeAt = new Date(parsed).toISOString();
        markItemWaiting(item, { reason: "sleep_until", wakeAt });
      }
    }

    if (!opts?.suppressOutgoing && !isRouteNode) {
      for (const edge of options.graph.getOutgoingEdges(item.nodeId)) {
        if (edge.when) continue;
        if (options.graph.isCrossBranchEdge({ from: item.nodeId, to: edge.to, when: null })) {
          continue;
        }
        if (options.graph.isGroupId(edge.to)) {
          options.state.ensureGroupItemKeyInitialized(item.itemKey);
          const downstreamGroup = options.state.getGroupItemRun(edge.to, item.itemKey);
          if (downstreamGroup && canPromoteToQueuedByDependency(downstreamGroup)) {
            markGroupItemQueued(downstreamGroup, ctx("downstream_promote"));
          }
          continue;
        }
        const downstream = options.state.getItemRun(edge.to, item.itemKey);
        if (!downstream) continue;
        if (canPromoteToQueuedByDependency(downstream)) {
          markItemQueued(downstream, ctx("downstream_promote"));
        }
      }
    }
  };

  return {
    applyEnvelopeOutcomeToItem,
  };
};

export type RouteItemManager = ReturnType<typeof createRouteItemManager>;
