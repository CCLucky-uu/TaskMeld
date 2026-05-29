import type { DetailSectionSpec, RenderSpecMap } from "../engine/types";

import { asArray, pickText, readRecord } from "../engine/utils";

const isPipelineStatusIdlePayload = (value: unknown): boolean => {
  const payload = readRecord(value);
  return payload.running === false && typeof payload.message === "string";
};

const buildNodeRows = (data: unknown): Record<string, unknown>[] => {
  const detail = readRecord(data);
  const workflow = readRecord(detail.workflow);
  const nodes = asArray(workflow.nodes);
  if (nodes.length === 0) return [];
  const edges = asArray(workflow.edges);
  const downstreamByNode = new Map<string, string[]>();
  for (const edge of edges) {
    const edgeRec = readRecord(edge);
    const from = pickText(edgeRec.from);
    const to = pickText(edgeRec.to);
    if (from === "-" || to === "-") continue;
    const when = pickText(edgeRec.when);
    const label = when !== "-" ? `${to}(${when})` : to;
    const bucket = downstreamByNode.get(from) ?? [];
    bucket.push(label);
    downstreamByNode.set(from, bucket);
  }
  return nodes.map((node) => {
    const nodeRec = readRecord(node);
    const executor = readRecord(nodeRec.executor);
    const nodeId = pickText(nodeRec.id);
    const downstream = downstreamByNode.get(nodeId) ?? [];
    return {
      nodeId: nodeRec.id,
      title: nodeRec.name ?? nodeRec.title ?? "-",
      agent: executor.agentId,
      lane: nodeRec.lane ?? "-",
      downstream: downstream.length > 0 ? downstream.join(", ") : "-",
    };
  });
};

const statusSections = (showLastCompleted: boolean): DetailSectionSpec[] => [
  {
    title: "Summary",
    kind: "custom",
    visible: (data) => isPipelineStatusIdlePayload(readRecord(data)),
    render: (data) => {
      const payload = readRecord(data);
      const lines = ["No active pipeline run."];
      if (typeof payload.lastBatchRunId === "string" && payload.lastBatchRunId.trim()) {
        lines.push("", `Last batch run: ${payload.lastBatchRunId.trim()}`);
      } else if (typeof payload.lastRunId === "string" && payload.lastRunId.trim()) {
        lines.push("", `Last run: ${payload.lastRunId.trim()}`);
      }
      if (showLastCompleted && typeof payload.lastCompletedAt === "string" && payload.lastCompletedAt.trim()) {
        lines.push(`Last completed at: ${payload.lastCompletedAt.trim()}`);
      }
      return lines;
    },
  },
  {
    title: "Summary",
    kind: "key-value",
    visible: (data) => !isPipelineStatusIdlePayload(readRecord(data)),
    rows: (data) => {
      const payload = readRecord(data);
      const status = readRecord(payload.status);
      const batchRun = readRecord(status.batchRun);
      const rows = [
        { field: "Pipeline ID", value: status.pipelineId },
        { field: "Mode", value: status.mode },
        { field: "Running", value: status.running },
        { field: "Run ID", value: status.runId },
        { field: "Run Status", value: status.runStatus },
      ];
      if (batchRun.batchRunId) {
        rows.push({ field: "Batch Run ID", value: batchRun.batchRunId });
      }
      rows.push(
        { field: "Active Nodes", value: asArray(status.activeNodeIds).map((n) => pickText(n)).join(", ") || "-" },
        { field: "Pending Nodes", value: asArray(status.pendingNodeIds).map((n) => pickText(n)).join(", ") || "-" },
        { field: "Updated At", value: status.updatedAt },
        { field: "Last Error", value: status.lastError },
      );
      return rows;
    },
  },
  {
    title: "Batch Run",
    kind: "key-value",
    visible: (data) => {
      const payload = readRecord(data);
      if (isPipelineStatusIdlePayload(payload)) return false;
      return readRecord(payload.status).mode === "remote_batch";
    },
    rows: (data) => {
      const payload = readRecord(data);
      const status = readRecord(payload.status);
      const batchRun = readRecord(status.batchRun);
      return [
        { field: "Status", value: batchRun.status },
        { field: "Batch Size", value: batchRun.batchSize },
        { field: "Total Items", value: batchRun.totalItems },
        { field: "Processed Items", value: batchRun.processedItems },
        { field: "Processed Batches", value: batchRun.processedBatches },
        { field: "Next Batch Index", value: batchRun.nextBatchIndex },
      ];
    },
  },
  {
    title: "Current Batch",
    kind: "key-value",
    visible: (data) => {
      const payload = readRecord(data);
      if (isPipelineStatusIdlePayload(payload)) return false;
      return readRecord(payload.status).mode === "remote_batch";
    },
    rows: (data) => {
      const payload = readRecord(data);
      const status = readRecord(payload.status);
      const currentBatch = readRecord(status.currentBatch);
      return [
        { field: "Index", value: currentBatch.index },
        { field: "Item Key", value: currentBatch.itemKey },
        { field: "Items", value: asArray(currentBatch.items).map((item) => pickText(item)).join(", ") || "-" },
        { field: "Running Nodes", value: asArray(currentBatch.runningNodeIds).map((item) => pickText(item)).join(", ") || "-" },
        { field: "Pending Nodes", value: asArray(currentBatch.pendingNodeIds).map((item) => pickText(item)).join(", ") || "-" },
        { field: "Completed Nodes", value: asArray(currentBatch.completedNodeIds).map((item) => pickText(item)).join(", ") || "-" },
        { field: "Failed Nodes", value: asArray(currentBatch.failedNodeIds).map((item) => pickText(item)).join(", ") || "-" },
      ];
    },
  },
];

export const pipelineRenderSpecs: RenderSpecMap = {
  "pipeline.list": {
    kind: "list",
    title: "Pipeline List",
    columns: [
      {
        title: "ID",
        render: (row) => row.id ?? row.pipelineId ?? "-",
      },
      {
        title: "Title",
        render: (row) => row.title ?? row.name ?? "-",
      },
    ],
  },
  "pipeline.start": {
    kind: "detail",
    title: "Pipeline Started",
    sections: [
      {
        title: "Basic",
        kind: "key-value",
        rows: (data) => {
          const d = readRecord(data);
          if (d.ok === false) return null;
          const isBatch = d.mode === "remote_batch";
          if (isBatch) {
            const batchRun = readRecord(d.batchRun);
            return [
              { field: "Pipeline ID", value: d.pipelineId },
              { field: "Batch Run ID", value: d.batchRunId },
              { field: "Run ID", value: d.runId },
              { field: "Remote URL", value: d.remoteUrl },
              { field: "Status", value: batchRun.status },
              { field: "Total Fetched", value: d.totalFetched },
              { field: "Batch Size", value: batchRun.batchSize },
              { field: "Total Batches", value: batchRun.totalBatches },
            ];
          }
          return [
            { field: "Pipeline ID", value: d.pipelineId },
            { field: "Run ID", value: d.runId },
            { field: "Status", value: readRecord(d.run).status },
          ];
        },
      },
      {
        title: "Nodes",
        kind: "table",
        columns: [
          { title: "Node ID", render: (r) => r.nodeId },
          { title: "Title", render: (r) => r.title },
          { title: "Agent", render: (r) => r.agent },
          { title: "Lane", render: (r) => r.lane },
          { title: "Downstream", render: (r) => r.downstream },
        ],
        rows: (data) => {
          const d = readRecord(data);
          if (d.ok === false) return null;
          const isBatch = d.mode === "remote_batch";
          const rawNodes = isBatch
            ? asArray(d.templateNodes).map((n) => readRecord(n))
            : asArray(readRecord(d.run).nodes).map((n) => readRecord(n));
          if (rawNodes.length === 0) return null;
          const laneByNode = new Map<string, string>();
          const wfNodes = asArray(d.workflowNodes);
          for (const wn of wfNodes) {
            const w = readRecord(wn);
            laneByNode.set(pickText(w.id), pickText(w.lane));
          }
          const downstreamByNode = new Map<string, string[]>();
          const edges = isBatch
            ? asArray(d.edges)
            : asArray(readRecord(readRecord(data).workflow).edges);
          for (const edge of edges) {
            const edgeRec = readRecord(edge);
            const from = pickText(edgeRec.from);
            const to = pickText(edgeRec.to);
            if (from === "-" || to === "-") continue;
            const when = pickText(edgeRec.when);
            const label = when !== "-" ? `${to}(${when})` : to;
            const bucket = downstreamByNode.get(from) ?? [];
            bucket.push(label);
            downstreamByNode.set(from, bucket);
          }
          if (downstreamByNode.size === 0) {
            for (const n of rawNodes) {
              const from = pickText(n.id);
              for (const parent of asArray(n.dependsOn)) {
                const parentId = pickText(parent);
                if (parentId === "-") continue;
                const bucket = downstreamByNode.get(parentId) ?? [];
                bucket.push(from);
                downstreamByNode.set(parentId, bucket);
              }
            }
          }
          return rawNodes.map((n) => {
            const nodeId = pickText(n.id);
            const executor = readRecord(n.executor);
            const downstream = downstreamByNode.get(nodeId) ?? [];
            return {
              nodeId,
              title: n.title ?? n.name ?? "-",
              agent: executor.agentId ?? "-",
              lane: laneByNode.get(nodeId) ?? "-",
              downstream: downstream.length > 0 ? downstream.join(", ") : "-",
            };
          });
        },
      },
      {
        title: "Batch Items",
        kind: "key-value",
        rows: (data) => {
          const d = readRecord(data);
          if (d.ok === false || d.mode !== "remote_batch") return null;
          const batchRun = readRecord(d.batchRun);
          const items = asArray(batchRun.currentBatchItems);
          const preview = items.slice(0, 10).map((item) => pickText(item));
          if (items.length > 10) preview.push(`... and ${items.length - 10} more`);
          return [
            { field: "Batch Index", value: batchRun.currentBatchIndex },
            { field: "Item Key", value: batchRun.currentBatchItemKey },
            { field: "Items", value: preview.join(", ") || "-" },
          ];
        },
      },
    ],
  },
  "pipeline.stop": {
    kind: "detail",
    title: "Pipeline Stopped",
    sections: [
      {
        title: "Basic",
        kind: "key-value",
        rows: (data) => {
          const d = readRecord(data);
          return [
            { field: "Pipeline ID", value: d.pipelineId },
            { field: "Batch Run ID", value: d.batchRunId },
            { field: "Run ID", value: d.runId },
            { field: "Stop Status", value: readRecord(d.stopped).ok ? "stopped" : "failed" },
          ];
        },
      },
      {
        title: "Current Run",
        kind: "key-value",
        rows: (data) => {
          const d = readRecord(data);
          const status = readRecord(d.status);
          const activeIds = asArray(status.activeNodeIds).map((n) => pickText(n)).filter((n) => n !== "-");
          const pendingIds = asArray(status.pendingNodeIds).map((n) => pickText(n)).filter((n) => n !== "-");
          return [
            { field: "Run Status", value: status.runStatus },
            { field: "Active Nodes", value: activeIds.length > 0 ? activeIds.join(", ") : "-" },
            { field: "Pending Nodes", value: pendingIds.length > 0 ? pendingIds.join(", ") : "-" },
          ];
        },
      },
    ],
  },
  "pipeline.get": {
    kind: "detail",
    title: "Pipeline Detail",
    sections: [
      {
        title: "Basic",
        kind: "key-value",
        rows: (data) => {
          const detail = readRecord(data);
          const workflow = readRecord(detail.workflow);
          const nodes = asArray(workflow.nodes);
          return [
            { field: "ID", value: detail.pipelineId ?? detail.id },
            { field: "Title", value: detail.title ?? detail.name },
            { field: "Total Nodes", value: nodes.length },
            { field: "Mainline Nodes", value: nodes.filter((n) => readRecord(n).lane === "main").length },
            { field: "Branch Nodes", value: nodes.filter((n) => readRecord(n).lane === "branch").length },
          ];
        },
      },
      {
        title: "Nodes",
        kind: "table",
        columns: [
          { title: "Node ID", render: (r) => r.nodeId },
          { title: "Title", render: (r) => r.title },
          { title: "Agent", render: (r) => r.agent },
          { title: "Lane", render: (r) => r.lane },
          { title: "Downstream", render: (r) => r.downstream },
        ],
        rows: (data) => buildNodeRows(data),
      },
      {
        title: "Scheduler Plugin",
        kind: "key-value",
        rows: (data) => {
          const detail = readRecord(data);
          const workflow = readRecord(detail.workflow);
          const plugins = readRecord(workflow.plugins);
          const schedulerPlugin = readRecord(plugins.scheduler);
          if (schedulerPlugin.enabled === false) return null;
          const scheduler = readRecord(workflow.scheduler);
          const loopGuard = readRecord(scheduler.loopGuard);
          return [
            { field: "Mode", value: scheduler.mode },
            { field: "Dispatch By", value: scheduler.dispatchBy },
            { field: "Max Concurrency", value: scheduler.maxConcurrency },
            { field: "Max Global Iterations", value: loopGuard.maxGlobalIterations },
            { field: "Max Per Item Loop", value: loopGuard.maxPerItemLoop },
          ];
        },
      },
      {
        title: "Batch Plugin",
        kind: "key-value",
        rows: (data) => {
          const detail = readRecord(data);
          const workflow = readRecord(detail.workflow);
          const plugins = readRecord(workflow.plugins);
          const remoteBatchPlugin = readRecord(plugins.remoteBatch);
          if (remoteBatchPlugin.enabled === false) return null;
          return [
            { field: "Remote URL", value: remoteBatchPlugin.url },
            { field: "Source Field", value: remoteBatchPlugin.sourceField },
            { field: "Batch Size", value: remoteBatchPlugin.batchSize },
            { field: "Start Batch", value: remoteBatchPlugin.startBatch },
          ];
        },
      },
    ],
  },
  "pipeline.status": {
    kind: "detail",
    title: "Pipeline Status",
    sections: statusSections(true),
  },
  "pipeline.watch": {
    kind: "detail",
    title: "Pipeline Watch",
    sections: statusSections(false),
  },
  "pipeline.retry-node": {
    kind: "detail",
    title: "Node Retry",
    sections: [
      {
        title: "Summary",
        kind: "key-value",
        rows: (data) => {
          const d = readRecord(data);
          const retry = readRecord(d.retry);
          return [
            { field: "Pipeline ID", value: d.pipelineId },
            { field: "Retry OK", value: retry.ok ?? false },
          ];
        },
      },
    ],
  },
  "pipeline.result": {
    kind: "detail",
    title: "Pipeline Result",
    sections: [
      {
        title: "Run Info",
        kind: "key-value",
        rows: (data) => {
          const d = readRecord(data);
          const rows = [
            { field: "Pipeline", value: `${d.title} (${d.pipelineId})` },
            { field: "Run ID", value: d.runId },
            { field: "Status", value: d.runStatus },
          ];
          if (d.batchRunId) {
            rows.push({ field: "Batch Run", value: d.batchRunId });
          }
          return rows;
        },
      },
      {
        title: "Nodes",
        kind: "table",
        visible: (data) => !readRecord(data).isBatch,
        columns: [
          { title: "Node", render: (r) => `${r.nodeId} (${r.status})` },
          { title: "Title", render: (r) => r.title },
          { title: "Error", render: (r) => r.lastError ?? "-" },
        ],
        rows: (data) => {
          const nodes = asArray(readRecord(data).nodes).map((n) => readRecord(n));
          return nodes.length > 0 ? nodes : null;
        },
      },
      {
        title: "Batches",
        kind: "table",
        visible: (data) => readRecord(data).isBatch === true,
        columns: [
          { title: "Batch", render: (r) => r.itemKey },
          { title: "Node", render: (r) => `${r.nodeId} (${r.status})` },
          { title: "Title", render: (r) => r.title },
          { title: "Error", render: (r) => r.lastError ?? "-" },
        ],
        rows: (data) => {
          const d = readRecord(data);
          const batches = asArray(d.batches).map((b) => readRecord(b));
          const rows: Record<string, unknown>[] = [];
          for (const batch of batches) {
            const nodes = asArray(batch.nodes).map((n) => {
              const r = readRecord(n);
              return { ...r, itemKey: batch.itemKey };
            });
            rows.push(...nodes);
          }
          return rows.length > 0 ? rows : null;
        },
      },
      {
        title: "Results",
        kind: "custom",
        render: (data) => {
          const d = readRecord(data);
          const lines: string[] = [];

          const showNodeContent = (node: Record<string, unknown>) => {
            const status = pickText(node.status);
            const hasContent = (Array.isArray(node.content) && node.content.length > 0) || (typeof node.content === "string" && node.content);
            if (!hasContent && !node.lastError) return;

            lines.push(`### ${pickText(node.nodeId)} (${status})`);
            if (node.lastError) {
              lines.push(`Error: ${pickText(node.lastError)}`);
            }
            if (hasContent) {
              if (typeof node.content === "string") {
                lines.push(node.content);
              } else if (Array.isArray(node.content)) {
                for (const c of node.content as string[]) {
                  lines.push(c);
                }
              }
            } else {
              lines.push("(no content)");
            }
            if (node.logs && Array.isArray(node.logs) && node.logs.length > 0) {
              lines.push("", "Logs:", JSON.stringify(node.logs, null, 2));
            }
            lines.push("");
          };

          if (d.isBatch) {
            const batches = asArray(d.batches).map((b) => readRecord(b));
            if (batches.length === 0) {
              lines.push("(no batch results)");
            } else {
              for (const batch of batches) {
                const batchNodes = asArray(batch.nodes).map((n) => readRecord(n));
                const activeNodes = batchNodes.filter((n) => {
                  const hasContent = (Array.isArray(n.content) && n.content.length > 0) || (typeof n.content === "string" && n.content);
                  return hasContent || n.lastError;
                });
                if (activeNodes.length === 0) continue;
                lines.push(`## Batch ${pickText(batch.itemKey)}`);
                for (const node of activeNodes) {
                  showNodeContent(node);
                }
              }
            }
          } else {
            const nodes = asArray(d.nodes).map((n) => readRecord(n));
            const activeNodes = nodes.filter((n) => {
              const hasContent = (Array.isArray(n.content) && n.content.length > 0) || (typeof n.content === "string" && n.content);
              return hasContent || n.lastError;
            });
            if (activeNodes.length === 0) {
              lines.push("(no results)");
            } else {
              for (const node of activeNodes) {
                const status = pickText(node.status);
                const hasContent = (Array.isArray(node.content) && node.content.length > 0) || (typeof node.content === "string" && node.content);
                if (!hasContent && !node.lastError) continue;
                lines.push(`## ${pickText(node.nodeId)} (${status})`);
                if (node.lastError) {
                  lines.push(`Error: ${pickText(node.lastError)}`);
                }
                if (hasContent) {
                  if (typeof node.content === "string") {
                    lines.push(node.content);
                  } else if (Array.isArray(node.content)) {
                    for (const c of node.content as string[]) {
                      lines.push(c);
                    }
                  }
                } else {
                  lines.push("(no content)");
                }
                if (node.logs && Array.isArray(node.logs) && node.logs.length > 0) {
                  lines.push("", "Logs:", JSON.stringify(node.logs, null, 2));
                }
                lines.push("");
              }
            }
          }

          return lines.length > 0 ? lines : null;
        },
      },
    ],
  },
};
