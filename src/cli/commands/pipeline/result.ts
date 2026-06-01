import { CliError, assertRequiredArg } from "../../errors";
import { t } from "../../i18n";
import type { CliCommandHandler, CliRouteDefinition } from "../../types";
import type { CliPipelineResult, CliPipelineResultNode } from "../../types";

type ItemRunGroup = {
  baseKey: string;
  nodeIds: Set<string>;
  itemKeys: Set<string>;
  nodeStatusMap: Map<string, { status: string; lastError: string | null }>;
};

const groupItemRunsByBaseKey = (itemRuns: Record<string, unknown>[]): ItemRunGroup[] => {
  const batchMap = new Map<string, {
    nodeIds: Set<string>;
    itemKeys: Set<string>;
    nodeStatusMap: Map<string, { status: string; lastError: string | null }>;
  }>();

  for (const item of itemRuns) {
    const rawKey = String(item.itemKey ?? "");
    const baseKey = rawKey.split("::")[0];
    if (!batchMap.has(baseKey)) {
      batchMap.set(baseKey, {
        nodeIds: new Set(),
        itemKeys: new Set(),
        nodeStatusMap: new Map(),
      });
    }
    const batch = batchMap.get(baseKey)!;
    const nodeId = String(item.nodeId ?? "");
    batch.nodeIds.add(nodeId);
    if (rawKey) batch.itemKeys.add(rawKey);
    batch.nodeStatusMap.set(nodeId, {
      status: String(item.status ?? "unknown"),
      lastError: typeof item.lastError === "string" ? item.lastError : null,
    });
  }

  return [...batchMap.entries()].map(([baseKey, batch]) => ({
    baseKey,
    nodeIds: batch.nodeIds,
    itemKeys: batch.itemKeys,
    nodeStatusMap: batch.nodeStatusMap,
  }));
};

const extractEnvelopeContents = (content: unknown): { contents: unknown[]; logs: unknown[] | null } => {
  const obj = content as Record<string, unknown> | null;
  if (!obj) return { contents: [], logs: null };
  const contents = Array.isArray(obj.contents) ? obj.contents : [];
  const logs = Array.isArray(obj.logs) ? obj.logs : null;
  return { contents, logs };
};

export const pipelineResultCommand: CliCommandHandler = async (input, ctx) => {
  const pipelineId = assertRequiredArg(input.args[0], "pipelineId");
  const targetNodeId = typeof input.flags.node === "string" ? input.flags.node.trim() : undefined;
  const includeLogs = input.flags.logs === true;

  const detail = await ctx.app.pipelineService.getPipelineById(pipelineId);
  if (!detail) {
    throw new CliError(`Pipeline not found: ${pipelineId}`, {
      code: "PIPELINE_NOT_FOUND",
      exitCode: 3,
      details: { pipelineId },
    });
  }

  const d = detail as Record<string, unknown>;
  const run = d.run as Record<string, unknown>;
  const runId = String(run.id ?? "");
  const runStatus = String(run.status ?? "unknown");

  const workflow = d.workflow as Record<string, unknown>;
  const workflowNodes = Array.isArray(workflow.nodes) ? workflow.nodes as Record<string, unknown>[] : [];

  const nodeTitleMap = new Map<string, string>();
  for (const wn of workflowNodes) {
    const id = String(wn.id ?? "");
    const title = String(wn.name ?? wn.title ?? id);
    if (id) nodeTitleMap.set(id, title);
  }

  const workflowPlugins = workflow.plugins as Record<string, unknown> | undefined;
  const remoteBatchPlugin = workflowPlugins?.remoteBatch as Record<string, unknown> | undefined;
  const isBatch = remoteBatchPlugin?.enabled === true;

  const itemRuns = Array.isArray(run.itemRuns) ? run.itemRuns as Record<string, unknown>[] : [];

  const batchRun = d.batchRun as Record<string, unknown> | undefined;
  const batchRunId = typeof batchRun?.batchRunId === "string" ? batchRun.batchRunId : null;

  const result: CliPipelineResult = {
    command: "pipeline.result",
    pipelineId,
    title: String(d.title ?? pipelineId),
    runId,
    runStatus,
    batchRunId,
    isBatch,
    batches: [],
    nodes: [],
  };

  // Query envelope files via artifact service (reuses unified read semantics)
  const envelopeList = await ctx.app.artifactService.listArtifacts({
    pipelineId,
    runId,
    kind: "envelope",
  }) as { items?: Array<{ nodeId?: string | null; relativePath?: string }> };
  const envelopeItems = Array.isArray(envelopeList?.items) ? envelopeList.items : [];

  // Index envelope relativePath by nodeId
  const envelopePathByNode = new Map<string, string>();
  for (const item of envelopeItems) {
    const nid = item.nodeId?.trim();
    const rp = item.relativePath?.trim();
    if (nid && rp) envelopePathByNode.set(nid, rp);
  }

  const fetchNodeContent = async (nodeId: string): Promise<{ content: string[]; logs: unknown[] | null }> => {
    const relativePath = envelopePathByNode.get(nodeId);
    if (!relativePath) return { content: [], logs: null };
    try {
      const raw = await ctx.app.artifactService.getArtifactContent({ pipelineId, relativePath }) as
        { content?: { content?: unknown } } | null;
      if (!raw?.content) return { content: [], logs: null };
      const { contents, logs } = extractEnvelopeContents(raw.content);
      const content = contents.map((c: unknown) => (typeof c === "string" ? c : JSON.stringify(c)));
      return { content, logs: includeLogs ? logs : null };
    } catch {
      return { content: [], logs: null };
    }
  };

  if (isBatch) {
    const groups = groupItemRunsByBaseKey(itemRuns);

    for (const group of groups) {
      const batchNodes: CliPipelineResultNode[] = [];

      for (const nodeId of group.nodeIds) {
        if (targetNodeId && nodeId !== targetNodeId) continue;
        const { content, logs } = await fetchNodeContent(nodeId);
        const nodeStatus = group.nodeStatusMap.get(nodeId);
        batchNodes.push({
          nodeId,
          title: nodeTitleMap.get(nodeId) ?? nodeId,
          status: nodeStatus?.status ?? "unknown",
          lastError: nodeStatus?.lastError ?? null,
          content,
          logs,
        });
      }

      if (batchNodes.length > 0) {
        result.batches.push({
          itemKey: group.baseKey,
          items: [...group.itemKeys],
          nodes: batchNodes,
        });
      }
    }
  } else {
    const nodes = Array.isArray(run.nodes) ? run.nodes as Record<string, unknown>[] : [];

    for (const node of nodes) {
      const nodeId = String(node.id ?? "");
      if (targetNodeId && nodeId !== targetNodeId) continue;
      const { content, logs } = await fetchNodeContent(nodeId);
      result.nodes.push({
        nodeId,
        title: nodeTitleMap.get(nodeId) ?? String(node.title ?? nodeId),
        status: String(node.status ?? "unknown"),
        lastError: typeof node.lastError === "string" ? node.lastError : null,
        content,
        logs,
      });
    }
  }

  return result;
};

export const pipelineResultRoutes: CliRouteDefinition[] = [
  {
    key: "pipeline.result",
    path: ["pipeline", "result"],
    description: t("pipeline.result.description"),
    handler: pipelineResultCommand,
    help: {
      usage: "taskmeld pipeline result <pipelineId> [--node <nodeId>] [--logs] [--format <json|md>]",
      args: [{ name: "pipelineId", required: true, description: t("pipeline.result.argPipelineId") }],
      options: [
        { flags: ["--node"], valueName: "nodeId", description: t("pipeline.result.optNode") },
        { flags: ["--logs"], description: t("pipeline.result.optLogs") },
        { flags: ["--format"], valueName: "json|md", description: t("pipeline.result.optFormat") },
      ],
      summary: t("pipeline.result.summary"),
    },
  },
];
