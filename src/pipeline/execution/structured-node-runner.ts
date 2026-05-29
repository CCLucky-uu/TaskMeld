import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type { GatewayClient, GatewayFrame } from "../../gateway";
import { type ArtifactManifest, type NodeRun } from "../runtime-model";
import { buildArtifactStorageDirs, persistArtifactFile, persistEnvelopeFile } from "../artifact-storage";
import {
  buildDependencyArtifactInputs,
  buildExternalPipelineArtifactInput,
  createNodeCorrectionPrompt,
  createNodeExecutionPrompt,
  extractViolationCode,
  collectEnvelopeCandidates,
  waitForStructuredEnvelope,
  type ContractViolationCode,
  type DependencyArtifactInput,
  type ExternalPipelineArtifactInput,
  type EnvelopeValidationContext,
  type ResultEnvelope,
} from "../structured-output";
import type { OutputSpec } from "../template";
import type { RuntimeStore } from "../../app/runtime-store";
import type { WorkflowGraph } from "../workflow-graph";
import { MAINLINE_ROUTE_VALUE } from "../workflow/routes";
import { buildRequestId } from "../identity";

const RUNTIME_KEYWORDS_PLACEHOLDER = "{{RUNTIME_KEYWORDS_JSON}}";

const injectRuntimeKeywordsToInstruction = (instruction: string, keywords: string[]) => {
  if (keywords.length === 0) return instruction;
  const keywordJson = JSON.stringify(keywords, null, 2);
  if (instruction.includes(RUNTIME_KEYWORDS_PLACEHOLDER)) {
    return instruction.replaceAll(RUNTIME_KEYWORDS_PLACEHOLDER, keywordJson);
  }
  const arrayPattern = /\[\s*(?:"[^"\n]{1,400}"\s*,\s*){10,}"[^"\n]{1,400}"\s*\]/gs;
  const matchedArray = instruction.match(arrayPattern);
  if (matchedArray && matchedArray.length > 0) {
    return instruction.replace(arrayPattern, keywordJson);
  }
  return `${instruction}\n\n本批次关键词(JSON数组)：\n${keywordJson}`;
};

export const resolveActiveBatchKeywordsForInstruction = (
  activeBatchKeywordItems: string[] | null,
  isSourceEntryNode: boolean,
) => {
  // 只有真正处于批跑中的入口节点，才允许把关键词池注入到提示词。
  // 普通单运行虽然默认 itemKey 可能是 global，但它只是运行项标识，不应被当成批次关键词展示。
  if (!isSourceEntryNode || !activeBatchKeywordItems || activeBatchKeywordItems.length === 0) {
    return [];
  }
  return Array.from(new Set(activeBatchKeywordItems.map((item) => item.trim()).filter(Boolean)));
};

const shouldParseFrameForEnvelope = (frame: GatewayFrame): boolean => {
  if (frame.type === "res") return true;
  if (frame.type === "req") return false;
  if (frame.type !== "event") return false;
  if (frame.event === "chat") {
    const p = frame.payload as Record<string, unknown> | undefined;
    const state = typeof p?.state === "string" ? p.state.toLowerCase() : "";
    if (state === "final" || state === "done" || state === "end" || state === "completed") return true;
    if (typeof p?.data === "object" && p.data !== null) return true;
    return false;
  }
  if (frame.event === "agent") {
    const p = frame.payload as Record<string, unknown> | undefined;
    const stream = typeof p?.stream === "string" ? p.stream : "";
    if (stream === "lifecycle") return false;
    if (stream === "tool" || stream === "item" || stream === "command_output") {
      if (p && typeof p === "object") {
        if (p.version === "2.0" && Array.isArray(p.artifacts)) return true;
        const data = p.data;
        if (data && typeof data === "object") {
          const d = data as Record<string, unknown>;
          if (d.version === "2.0" && Array.isArray(d.artifacts)) return true;
        }
      }
      return false;
    }
    return true;
  }
  return false;
};

type CreateStructuredNodeRunnerOptions = {
  client: GatewayClient;
  runtimeStore: RuntimeStore;
  graph: WorkflowGraph;
  artifactDir: string;
  pipelineId: string;
  pipelineNodeExecutionTimeoutMs: number;
  getNodeById: (nodeId: string) => NodeRun | null;
  getRun: () => ReturnType<RuntimeStore["getRun"]>;
  getActiveBatchKeywordItems: () => string[] | null;
  getBatchRunId?: () => string | null;
};

export const createStructuredNodeRunner = (options: CreateStructuredNodeRunnerOptions) => {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(32);
  type SessionRunSnapshot = {
    firstSeenAt: number;
    lastSeenAt: number;
    completedAt: number | null;
  };
  type RequestRunWatch = {
    lockedRunId: string | null;
  };

  // 同一个 agent session 会复用多轮对话。
  // 这里按 sessionId + agent runId 记录生命周期，避免上一轮尾部的 end/error 事件误伤下一轮新请求。
  const sessionRuns = new Map<string, Map<string, SessionRunSnapshot>>();

  const findStringByKeys = (value: unknown, keys: string[], depth = 0): string | null => {
    if (depth > 5 || value === null || value === undefined) return null;
    if (typeof value === "string") return value.trim() || null;
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = findStringByKeys(item, keys, depth + 1);
        if (found) return found;
      }
      return null;
    }
    if (typeof value !== "object") return null;
    const record = value as Record<string, unknown>;
    for (const key of keys) {
      const raw = record[key];
      if (typeof raw === "string" && raw.trim()) return raw.trim();
    }
    for (const nested of Object.values(record)) {
      const found = findStringByKeys(nested, keys, depth + 1);
      if (found) return found;
    }
    return null;
  };

  const inferLifecycle = (payload: unknown): "start" | "end" | "unknown" => {
    const marker = (findStringByKeys(payload, ["status", "state", "phase", "event", "type", "kind"]) ?? "").toLowerCase();
    if (!marker) return "unknown";
    if (
      marker.includes("start") ||
      marker.includes("running") ||
      marker.includes("in_progress") ||
      marker.includes("processing") ||
      marker.includes("stream")
    ) {
      return "start";
    }
    if (
      marker.includes("done") ||
      marker.includes("finish") ||
      marker.includes("complete") ||
      marker.includes("success") ||
      marker.includes("failed") ||
      marker.includes("error") ||
      marker.includes("idle") ||
      marker.includes("stop")
    ) {
      return "end";
    }
    return "unknown";
  };

  const rememberSessionRunEvent = (
    sessionId: string | null,
    runId: string | null,
    lifecycle: "start" | "end" | "unknown",
  ) => {
    if (!sessionId || !runId) return;
    const now = Date.now();
    const runMap = sessionRuns.get(sessionId) ?? new Map<string, SessionRunSnapshot>();
    const current = runMap.get(runId) ?? {
      firstSeenAt: now,
      lastSeenAt: now,
      completedAt: null,
    };
    current.firstSeenAt = Math.min(current.firstSeenAt, now);
    current.lastSeenAt = now;
    if (lifecycle === "end") {
      current.completedAt = now;
    }
    if (lifecycle === "start") {
      current.completedAt = null;
    }
    runMap.set(runId, current);

    // 每个 session 只保留最近少量 run 记录，避免长跑时无界增长。
    // 驱逐前跳过仍在等待确认的活跃 run (completedAt 为 null)，
    // 防止 resolveCompletedAtForRequest 锁定的 runId 被误删导致超时。
    const MAX_RUNS_PER_SESSION = 48;
    if (runMap.size > MAX_RUNS_PER_SESSION) {
      const now = Date.now();
      const STALE_GRACE_MS = 5 * 60 * 1000;
      const staleEntries = [...runMap.entries()]
        .filter(([, snapshot]) => {
          if (snapshot.completedAt === null) return false;
          return now - snapshot.completedAt > STALE_GRACE_MS;
        })
        .sort((a, b) => a[1].lastSeenAt - b[1].lastSeenAt);
      const overflow = runMap.size - MAX_RUNS_PER_SESSION;
      for (let i = 0; i < Math.min(overflow, staleEntries.length); i += 1) {
        runMap.delete(staleEntries[i][0]);
      }
    }
    sessionRuns.set(sessionId, runMap);
  };

  const resolveCompletedAtForRequest = (
    sessionId: string,
    requestStartedAt: number,
    watch: RequestRunWatch,
  ): number | null => {
    const runMap = sessionRuns.get(sessionId);
    if (!runMap || runMap.size === 0) return null;

    if (!watch.lockedRunId) {
      // 优先锁定"首次出现时间晚于本次请求发出时间"的 runId。
      // 这样可以避免上一轮请求的尾部 end/error 在新请求刚开始时被错认成当前轮次结束。
      const currentRun = [...runMap.entries()]
        .filter(([, snapshot]) => snapshot.firstSeenAt >= requestStartedAt)
        .sort((a, b) => a[1].firstSeenAt - b[1].firstSeenAt)[0];
      if (currentRun) {
        watch.lockedRunId = currentRun[0];
      }
    }

    if (!watch.lockedRunId) return null;
    const snapshot = runMap.get(watch.lockedRunId);
    if (!snapshot) return null;
    if (snapshot.completedAt === null || snapshot.completedAt < requestStartedAt) return null;
    return snapshot.completedAt;
  };

  const rememberSessionCompletion = (frame: GatewayFrame) => {
    if (frame.type !== "event") return;
    const payload = frame.payload as Record<string, unknown> | undefined;
    if (!payload) return;
    const sessionId = findStringByKeys(payload, ["sessionKey", "sessionId", "key", "session"]);
    const runId = findStringByKeys(payload, ["runId"]);
    if (!sessionId) return;
    if (frame.event === "agent") {
      const stream = typeof payload.stream === "string" ? payload.stream : "";
      if (stream === "tool" || stream === "item" || stream === "command_output") return;
    }
    if (frame.event === "agent") {
      const stream = typeof payload.stream === "string" ? payload.stream : "";
      if (stream === "lifecycle") {
        rememberSessionRunEvent(sessionId, runId, inferLifecycle(payload.data));
        return;
      }
      // assistant/tool/item 等流虽然不代表完成，但能提供当前轮次的 runId。
      // 这里只做"看见过该 run"的记录，完成仍以 lifecycle/chat.final 为准。
      rememberSessionRunEvent(sessionId, runId, "unknown");
      return;
    }
    if (frame.event === "chat") {
      rememberSessionRunEvent(sessionId, runId, "unknown");
      const state = (findStringByKeys(payload, ["state"]) ?? "").toLowerCase();
      if (state === "final" || state === "done" || state === "end" || state === "completed") {
        rememberSessionRunEvent(sessionId, runId, "end");
      }
    }
  };

  // ── Extracted helpers for structured output node execution ──

  type NodePromptContext = {
    runId: string;
    nodeId: string;
    nodeTitle: string;
    requestId: string;
    sessionId: string;
    dependencies: string[];
    dependencyArtifacts: DependencyArtifactInput[];
    externalPipelineArtifact: ExternalPipelineArtifactInput | null;
    outputSpec: OutputSpec;
    instruction: string;
    allowReject: boolean;
    maxRejectCount: number;
    rejectFeedbacks: string[];
    allowedRoutes: string[];
    routeTargets: Array<{ route: string; targetNodeId: string; targetNodeTitle: string; targetAgentId: string; lane: string }>;
  };

  const buildNodePrompt = async (
    node: NodeRun,
    sessionId: string,
    itemKey?: string,
    dependencyIds?: string[],
  ) => {
    const run = options.getRun();
    const requestId = buildRequestId(node.id);
    const effectiveDependencyIds: string[] = dependencyIds?.length
      ? Array.from(new Set(dependencyIds.map((id) => id.trim()).filter(Boolean)))
      : node.dependsOn;
    const workflowNode = options.graph.getWorkflowNodeById(node.id);
    const retryBackoffMs = workflowNode?.retryPolicy.backoffMs ?? 0;
    const parallelGroup = options.graph.getParallelGroupByMemberNodeId(node.id);
    // 批处理关键词只应注入真正的入口节点。并行组成员虽然通常没有 direct incoming edge，
    // 但它们的依赖挂在 group 上，只看 node 自身入边会把 group 成员误判为 source entry。
    const isSourceEntryNode =
      options.graph.getIncomingEdges(node.id).length === 0 &&
      (!parallelGroup || options.graph.getIncomingEdges(parallelGroup.id).length === 0);
    const effectiveRuntimeKeywordItems = resolveActiveBatchKeywordsForInstruction(
      options.getActiveBatchKeywordItems(),
      isSourceEntryNode,
    );
    const effectiveInstruction =
      effectiveRuntimeKeywordItems.length > 0
        ? injectRuntimeKeywordsToInstruction(node.instruction, effectiveRuntimeKeywordItems)
        : node.instruction;
    const dependencyArtifacts = await buildDependencyArtifactInputs(
      run, node, itemKey, effectiveDependencyIds,
    );
    // Load external pipeline artifact for pipeline_link triggered runs (entry nodes only)
    let externalPipelineArtifact: ExternalPipelineArtifactInput | null = null;
    if (run.input?.trigger === "pipeline_link" && isSourceEntryNode) {
      externalPipelineArtifact = await buildExternalPipelineArtifactInput(run.input.upstreamOutput);
      if (!externalPipelineArtifact) {
        throw new Error("external_pipeline_artifact_read_failed");
      }
    }
    if (effectiveDependencyIds.length > 0) {
      options.runtimeStore.pushTimeline(
        `节点 ${node.id} 已加载上游产物 ${dependencyArtifacts.length} 条（来自: ${effectiveDependencyIds.join(",")}）`,
      );
    }
    const allowedRoutes = workflowNode?.routePolicy?.allowed ?? [];
    const routeTargets = options.graph.getOutgoingEdges(node.id)
      .filter((edge) => edge.when && edge.when !== MAINLINE_ROUTE_VALUE)
      .map((edge) => {
        const targetWorkflowNode = options.graph.getWorkflowNodeById(edge.to);
        const targetWorkflowGroup = options.graph.getWorkflowGroupById(edge.to);
        const targetNode = options.getNodeById(edge.to);
        return {
          route: edge.when ?? "",
          targetNodeId: edge.to,
          targetNodeTitle: targetWorkflowGroup
            ? `并行组 ${targetWorkflowGroup.id}`
            : targetNode?.title ?? targetWorkflowNode?.name ?? edge.to,
          targetAgentId: targetWorkflowGroup
            ? targetWorkflowGroup.id
            : targetNode?.executor.agentId ?? targetWorkflowNode?.executor.agentId ?? "-",
          lane: targetWorkflowGroup ? "group" : targetWorkflowNode?.lane ?? "main",
        };
      });
    const ctx: NodePromptContext = {
      runId: run.id, nodeId: node.id, nodeTitle: node.title,
      requestId, sessionId,
      dependencies: effectiveDependencyIds,
      dependencyArtifacts,
      externalPipelineArtifact,
      outputSpec: node.outputSpec,
      instruction: effectiveInstruction,
      allowReject: node.allowReject,
      maxRejectCount: node.maxRejectCount,
      rejectFeedbacks: node.rejectFeedbacks ?? [],
      allowedRoutes, routeTargets,
    };
    return { requestId, ctx, effectiveDependencyIds, dependencyArtifacts, allowedRoutes, routeTargets, retryBackoffMs };
  };

  const sendAndWaitForEnvelope = async (
    prompt: string,
    sessionId: string,
    nodeId: string,
    validationCtx: EnvelopeValidationContext,
    lastViolation: ContractViolationCode | null,
    requestStartedAt: number,
    requestRunWatch: RequestRunWatch,
    signal?: AbortSignal,
  ): Promise<ResultEnvelope> => {
    // DAG 节点发送只保留 chat.send 单一路径，避免不同发送 API 的兼容补发把同一 requestId 投递两次。
    const idempotencyKey = randomUUID();
    let payload: unknown;
    try {
      payload = await options.client.sendReq(
        "chat.send",
        { sessionKey: sessionId, message: prompt },
        {
          sideEffect: true,
          timeoutMs: options.pipelineNodeExecutionTimeoutMs,
          idempotencyKey,
        },
      );
    } catch (error) {
      options.runtimeStore.pushTimeline(
        `节点 ${nodeId} 发送失败(chat.send): ${String(error)}`,
        "error",
      );
      throw new Error(`openclaw_send_failed:chat.send:${String(error)}`);
    }
    options.runtimeStore.pushTimeline(`节点 ${nodeId} 已发送请求，等待结构化回执...`);
    const envelope = await waitForStructuredEnvelope(
      emitter,
      validationCtx,
      lastViolation,
      () => resolveCompletedAtForRequest(sessionId, requestStartedAt, requestRunWatch),
      signal,
    );
    return envelope;
  };

  const validateAndRetryEnvelope = async (
    ctx: NodePromptContext,
    sessionId: string,
    node: NodeRun,
    allowedRoutes: string[],
    retryBackoffMs = 0,
    signal?: AbortSignal,
  ): Promise<ResultEnvelope> => {
    const validationCtx: EnvelopeValidationContext = {
      runId: ctx.runId,
      nodeId: node.id,
      requestId: ctx.requestId,
      sessionId,
      outputSpec: node.outputSpec,
      allowedRoutes,
      requireRouteContent: allowedRoutes.length > 0,
    };
    let lastViolation: ContractViolationCode | null = null;
    // 纠错重试属于同一次节点请求的补正，不应更换 requestId。
    // 否则模型即使按上一轮上下文修正成功，也会因为顶层 requestId 变化被误判为 mismatch。
    for (let attemptIndex = 0; attemptIndex < 2; attemptIndex += 1) {
      if (attemptIndex > 0 && retryBackoffMs > 0) {
        await new Promise(resolve => setTimeout(resolve, retryBackoffMs));
      }
      try {
        const requestStartedAt = Date.now();
        const requestRunWatch: RequestRunWatch = { lockedRunId: null };
        const prompt =
          attemptIndex === 0 || !lastViolation
            ? createNodeExecutionPrompt(ctx)
            : createNodeCorrectionPrompt(ctx, lastViolation);
        const envelope = await sendAndWaitForEnvelope(
          prompt, sessionId, node.id, validationCtx,
          lastViolation, requestStartedAt, requestRunWatch,
          signal,
        );
        return envelope;
      } catch (error) {
        const violation = extractViolationCode(error);
        if (violation) {
          lastViolation = violation;
          if (attemptIndex === 0) {
            options.runtimeStore.pushTimeline(
              `节点 ${node.id} 回执校验失败(${violation})，自动纠正重试中...`, "warn",
            );
            continue;
          }
          options.runtimeStore.pushTimeline(
            `节点 ${node.id} 回执校验失败(${violation})，纠正后仍未通过，标记失败`, "error",
          );
        }
        throw error;
      }
    }
    throw new Error(`contract_violation:${lastViolation ?? "result_envelope_missing"}`);
  };

  const persistEnvelopeArtifacts = async (
    envelope: ResultEnvelope,
    runId: string,
    nodeId: string,
    requestId: string,
    sessionId: string,
  ): Promise<ArtifactManifest[]> => {
    const savedAt = new Date();
    const status = envelope.status === "failed" ? "failed" as const : "success" as const;
    const batchRunId = options.getBatchRunId?.();

    // envelope 文件通过 persistEnvelopeFile 写入并追加索引
    await persistEnvelopeFile(
      options.artifactDir,
      status,
      { runId, batchRunId, nodeId, requestId, pipelineId: options.pipelineId },
      envelope,
      { savedAt },
    );

    const normalizedArtifacts: ArtifactManifest[] = [];
    for (let i = 0; i < envelope.artifacts.length; i += 1) {
      const artifact = envelope.artifacts[i];
      const safeType = artifact.type.replace(/[^a-zA-Z0-9._-]/g, "_");
      const manifest = await persistArtifactFile(
        options.artifactDir,
        status,
        {
          runId,
          pipelineId: options.pipelineId,
          batchRunId,
          nodeId,
          requestId,
          kind: "artifact",
        },
        {
          type: artifact.type,
          schemaVersion: artifact.schemaVersion,
          name: artifact.name ?? `artifact-${i + 1}`,
          content: artifact.content,
          meta: artifact.meta,
        },
        { savedAt, fileNameSuffix: `${i + 1}-${safeType}` },
      );
      normalizedArtifacts.push(manifest);
    }
    return normalizedArtifacts;
  };

  const runNodeViaStructuredOutput = async (
    node: NodeRun,
    sessionId: string,
    itemKey?: string,
    dependencyIds?: string[],
    signal?: AbortSignal,
  ) => {
    const { requestId, ctx, allowedRoutes, retryBackoffMs } = await buildNodePrompt(
      node, sessionId, itemKey, dependencyIds,
    );
    const envelope = await validateAndRetryEnvelope(ctx, sessionId, node, allowedRoutes, retryBackoffMs, signal);
    const artifacts = await persistEnvelopeArtifacts(
      envelope, ctx.runId, node.id, requestId, sessionId,
    );
    return { envelope, artifacts };
  };

  const rememberGatewayFrame = (frame: GatewayFrame) => {
    if (frame.type === "req") return;
    if (shouldParseFrameForEnvelope(frame)) {
      const source = frame.type === "event" ? `event:${frame.event}` : "res";
      const candidates = collectEnvelopeCandidates(frame.payload);
      const now = Date.now();
      for (const envelope of candidates) {
        emitter.emit("candidate", { envelope, observedAt: now, source });
      }
    }
    rememberSessionCompletion(frame);
  };

  return {
    runNodeViaStructuredOutput,
    rememberGatewayFrame,
    hasActiveSession: (sessionKey: string): boolean => {
      const runMap = sessionRuns.get(sessionKey);
      if (!runMap || runMap.size === 0) return false;
      for (const snapshot of runMap.values()) {
        if (snapshot.completedAt === null) return true;
      }
      return false;
    },
  };
};

export type StructuredNodeRunner = ReturnType<typeof createStructuredNodeRunner>;
