import { CliError, assertRequiredArg } from "../errors";
import type { CliCommandHandler, CliRouteDefinition } from "../types";
import { throwSelectorScopedError } from "./pipeline/errors";
import { pipelineResultRoutes } from "./pipeline/result";
import {
  describePipelineSelector,
  getPipelineStatusBySelector,
  pickOptionalStringFlag,
  readPipelineSelector,
  stopPipelineBySelector,
} from "./pipeline/selector";
import { watchPipelineUntilTerminal } from "./pipeline/watch";

export const pipelineListCommand: CliCommandHandler = async (_input, ctx) => {
  return ctx.app.pipelineService.listPipelines();
};

export const pipelineGetCommand: CliCommandHandler = async (input, ctx) => {
  const pipelineId = assertRequiredArg(input.args[0], "pipelineId");
  const detail = await ctx.app.pipelineService.getPipelineById(pipelineId);
  if (!detail) {
    throw new CliError(`Pipeline not found: ${pipelineId}`, {
      code: "PIPELINE_NOT_FOUND",
      exitCode: 3,
      details: { pipelineId },
    });
  }
  return detail;
};

export const pipelineStartCommand: CliCommandHandler = async (input, ctx) => {
  const pipelineId = assertRequiredArg(input.args[0], "pipelineId");
  const result = await ctx.app.pipelineService.startPipeline(pipelineId);
  const data = result as {
    ok?: boolean;
    error?: string;
    state?: unknown;
    remoteUrl?: string;
    status?: number;
    detail?: string;
  };
  if (data.ok === false && data.error === "pipeline_not_found") {
    throw new CliError(`Pipeline not found: ${pipelineId}`, {
      code: "PIPELINE_NOT_FOUND",
      exitCode: 3,
      details: { pipelineId },
    });
  }
  if (data.ok === false && data.error === "batch_run_in_progress") {
    throw new CliError(`Batch run already in progress: ${pipelineId}`, {
      code: "BATCH_RUN_IN_PROGRESS",
      exitCode: 4,
      details: { pipelineId, state: data.state ?? null },
    });
  }
  if (data.ok === false) {
    throw new CliError(`Pipeline run failed: ${data.error ?? "unknown_error"}`, {
      code: String(data.error ?? "PIPELINE_RUN_FAILED").toUpperCase(),
      exitCode: 4,
      details: {
        pipelineId,
        state: data.state ?? null,
        remoteUrl: data.remoteUrl ?? null,
        status: data.status ?? null,
        detail: data.detail ?? null,
      },
    });
  }
  const shouldWatch = input.flags.watch === true || String(input.flags.watch ?? "").trim().toLowerCase() === "true";
  if (shouldWatch) {
    const watchResult = await watchPipelineUntilTerminal(ctx, { pipelineId }, input.flags.timeout, input.flags.interval);
    return {
      ...(result as Record<string, unknown>),
      watch: watchResult,
    };
  }
  return result;
};

export const pipelineStatusCommand: CliCommandHandler = async (input, ctx) => {
  const selector = readPipelineSelector(input);
  const result = await getPipelineStatusBySelector(ctx, selector);
  if (result.ok === false) {
    throwSelectorScopedError(result, selector);
  }
  return result;
};

export const pipelineWatchCommand: CliCommandHandler = async (input, ctx) => {
  const selector = readPipelineSelector(input);
  return watchPipelineUntilTerminal(ctx, selector, input.flags.timeout, input.flags.interval);
};

export const pipelineStopCommand: CliCommandHandler = async (input, ctx) => {
  const selector = readPipelineSelector(input);
  const result = await stopPipelineBySelector(ctx, selector);
  if (result.ok === false && (result.error === "pipeline_not_found" || result.error === "run_not_found" || result.error === "batch_run_not_found")) {
    throwSelectorScopedError(result, selector);
  }
  if (result.ok === false && result.error === "batch_run_not_running") {
    throw new CliError(`Batch run not running: ${describePipelineSelector(selector)}`, {
      code: "BATCH_RUN_NOT_RUNNING",
      exitCode: 4,
      details: { ...selector, status: result.status ?? null },
    });
  }
  return result;
};

export const pipelineRetryNodeCommand: CliCommandHandler = async (input, ctx) => {
  const pipelineId = assertRequiredArg(input.args[0], "pipelineId");
  const nodeId = assertRequiredArg(input.args[1], "nodeId");
  const itemKey = pickOptionalStringFlag(input.flags.item);
  const result = await ctx.app.pipelineService.retryNode({ pipelineId, nodeId, itemKey });
  const data = result as {
    ok?: boolean;
    error?: string;
    retry?: { ok?: boolean; error?: string };
  };
  if (data.ok === false && data.error === "pipeline_not_found") {
    throw new CliError(`Pipeline not found: ${pipelineId}`, {
      code: "PIPELINE_NOT_FOUND",
      exitCode: 3,
      details: { pipelineId },
    });
  }
  if (data.retry?.ok === false && data.retry.error === "node_not_found") {
    throw new CliError(`Node not found: ${nodeId}`, {
      code: "NODE_NOT_FOUND",
      exitCode: 3,
      details: { pipelineId, nodeId, itemKey: itemKey ?? null },
    });
  }
  if (data.retry?.ok === false) {
    throw new CliError(`Retry node failed: ${data.retry.error ?? "unknown_error"}`, {
      code: "RETRY_NODE_FAILED",
      exitCode: 4,
      details: { pipelineId, nodeId, itemKey: itemKey ?? null, result },
    });
  }
  return result;
};

export const pipelineDiagnoseCommand: CliCommandHandler = async (input, ctx) => {
  const pipelineId = assertRequiredArg(input.args[0], "pipelineId");
  const nodeId = assertRequiredArg(input.args[1], "nodeId");
  const itemKey = pickOptionalStringFlag(input.flags.item);
  const result = await ctx.app.pipelineService.diagnoseNode({ pipelineId, nodeId, itemKey });
  const data = result as {
    diagnostics?: unknown[];
    itemKey?: string | null;
    nodeId?: string;
  };
  if (!data.diagnostics || (Array.isArray(data.diagnostics) && data.diagnostics.length === 0)) {
    throw new CliError(`No diagnostics available for node: ${nodeId}`, {
      code: "DIAGNOSTICS_UNAVAILABLE",
      exitCode: 3,
      details: { pipelineId, nodeId, itemKey: itemKey ?? null },
    });
  }
  return result;
};

export const pipelineRoutes: CliRouteDefinition[] = [
  ...pipelineResultRoutes,
  {
    key: "pipeline.list",
    path: ["pipeline", "list"],
    description: "输出流水线列表",
    handler: pipelineListCommand,
    help: {
      usage: "taskmeld pipeline list [--format <json|md>]",
      summary: "输出流水线列表",
    },
  },
  {
    key: "pipeline.get",
    path: ["pipeline", "get"],
    description: "输出指定流水线详情",
    handler: pipelineGetCommand,
    help: {
      usage: "taskmeld pipeline get <id> [--format <json|md>]",
      args: [{ name: "id", required: true, description: "流水线 ID" }],
      summary: "输出指定流水线详情",
    },
  },
  {
    key: "pipeline.start",
    path: ["pipeline", "start"],
    description: "发起指定流水线运行（不承诺已完成）",
    handler: pipelineStartCommand,
    bootstrap: { runtimeApiOnly: true, ensureServerReady: true },
    help: {
      usage: "taskmeld pipeline start <pipelineId> [--watch] [--timeout <ms>] [--interval <ms>] [--format <json|md>]",
      args: [{ name: "pipelineId", required: true, description: "流水线 ID" }],
      options: [
        { flags: ["--watch"], description: "启动后继续等待运行完成" },
        { flags: ["--timeout"], valueName: "ms", description: "watch 超时时间，默认 600000" },
        { flags: ["--interval"], valueName: "ms", description: "watch 轮询间隔，默认 1200" },
      ],
      notes: [
        "start 只负责发起运行请求，不承诺命令返回时业务已执行完成。",
        "--watch 会在发起成功后进入等待流程。",
      ],
    },
  },
  {
    key: "pipeline.status",
    path: ["pipeline", "status"],
    description: "输出指定流水线当前运行状态",
    handler: pipelineStatusCommand,
    bootstrap: { runtimeApiOnly: true, ensureServerReady: true },
    help: {
      usage: "taskmeld pipeline status [<pipelineId>] [--run-id <id>] [--batch-run-id <id>] [--format <json|md>]",
      args: [{ name: "pipelineId", description: "兼容入口，按流水线 ID 查询当前运行" }],
      options: [
        { flags: ["--run-id"], valueName: "id", description: "按单次运行 ID 精确查询" },
        { flags: ["--batch-run-id"], valueName: "id", description: "按批跑 ID 精确查询" },
      ],
      examples: [
        "taskmeld pipeline status A",
        "taskmeld pipeline status A --run-id run-123",
        "taskmeld pipeline status A --batch-run-id batch:A:2026-05-08T18:34:08.978Z",
      ],
      notes: [
        "需要至少提供 <pipelineId>、--run-id、--batch-run-id 之一。",
        "未提供 selector 时，默认按 pipelineId 查询当前活动运行。",
      ],
    },
  },
  {
    key: "pipeline.watch",
    path: ["pipeline", "watch"],
    description: "监听指定流水线直到结束或超时",
    handler: pipelineWatchCommand,
    bootstrap: { runtimeApiOnly: true, ensureServerReady: true },
    help: {
      usage: "taskmeld pipeline watch [<pipelineId>] [--run-id <id>] [--batch-run-id <id>] [--timeout <ms>] [--interval <ms>] [--format <json|md>]",
      args: [{ name: "pipelineId", description: "兼容入口，监听该流水线当前运行" }],
      options: [
        { flags: ["--run-id"], valueName: "id", description: "按单次运行 ID 精确监听" },
        { flags: ["--batch-run-id"], valueName: "id", description: "按批跑 ID 精确监听" },
        { flags: ["--timeout"], valueName: "ms", description: "watch 超时时间，默认 600000" },
        { flags: ["--interval"], valueName: "ms", description: "watch 轮询间隔，默认 1200" },
      ],
      examples: [
        "taskmeld pipeline watch A",
        "taskmeld pipeline watch --run-id run-123",
        "taskmeld pipeline watch --batch-run-id batch:A:2026-05-08T18:34:08.978Z --timeout 900000",
      ],
      notes: [
        "watch 是监听命令，不负责发起新运行。",
        "需要至少提供 <pipelineId>、--run-id、--batch-run-id 之一。",
        "当前 watch 语义为事件流优先，轮询作为兜底路径。",
      ],
    },
  },
  {
    key: "pipeline.stop",
    path: ["pipeline", "stop"],
    description: "停止指定流水线批跑任务",
    handler: pipelineStopCommand,
    bootstrap: { runtimeApiOnly: true, ensureServerReady: true },
    help: {
      usage: "taskmeld pipeline stop [<pipelineId>] [--run-id <id>] [--batch-run-id <id>] [--format <json|md>]",
      args: [{ name: "pipelineId", description: "兼容入口，停止该流水线当前运行" }],
      options: [
        { flags: ["--run-id"], valueName: "id", description: "按单次运行 ID 精确停止" },
        { flags: ["--batch-run-id"], valueName: "id", description: "按批跑 ID 精确停止" },
      ],
      notes: [
        "需要至少提供 <pipelineId>、--run-id、--batch-run-id 之一。",
        "当前 stop 主要用于停止批跑任务。",
        "对非批跑运行会返回业务错误，而不是静默成功。",
      ],
    },
  },
  {
    key: "pipeline.retry-node",
    path: ["pipeline", "retry-node"],
    description: "重试指定节点或节点条目",
    handler: pipelineRetryNodeCommand,
    bootstrap: { gateway: "required" },
    help: {
      usage: "taskmeld pipeline retry-node <pipelineId> <nodeId> [--item <itemKey>] [--format <json|md>]",
      args: [
        { name: "pipelineId", required: true, description: "流水线 ID" },
        { name: "nodeId", required: true, description: "节点 ID" },
      ],
      options: [{ flags: ["--item"], valueName: "itemKey", description: "指定重试的条目键" }],
      summary: "重试指定节点或节点条目",
    },
  },
  {
    key: "pipeline.diagnose",
    path: ["pipeline", "diagnose"],
    description: "诊断指定节点依赖状态，输出阻塞原因",
    handler: pipelineDiagnoseCommand,
    bootstrap: { runtimeApiOnly: true, ensureServerReady: true },
    help: {
      usage: "taskmeld pipeline diagnose <pipelineId> <nodeId> [--item <itemKey>] [--format <json|md>]",
      args: [
        { name: "pipelineId", required: true, description: "流水线 ID" },
        { name: "nodeId", required: true, description: "节点 ID" },
      ],
      options: [{ flags: ["--item"], valueName: "itemKey", description: "可选，指定条目键精确诊断" }],
      summary: "诊断指定节点依赖状态，输出阻塞原因",
    },
  },
  {
    key: "pipeline.output",
    path: ["pipeline", "output"],
    description: "查询流水线最终产物",
    handler: async (input, ctx) => {
      const pipelineId = assertRequiredArg(input.args[0], "pipelineId");
      const runId = pickOptionalStringFlag(input.flags.run);
      const output = await ctx.app.pipelineService.getOutput(pipelineId, runId);
      if (!output) {
        return { ok: true, pipelineId, items: [] };
      }
      const outputs = runId ? [output] : await ctx.app.pipelineService.listOutputs(pipelineId);
      return { ok: true, pipelineId, items: outputs };
    },
    help: {
      usage: "taskmeld pipeline output <pipelineId> [--run <runId>]",
      args: [{ name: "pipelineId", required: true, description: "流水线 ID" }],
      options: [{ flags: ["--run"], valueName: "runId", description: "按 runId 精确查询" }],
      summary: "查询流水线最终产物",
    },
  },
  {
    key: "pipeline.link-list",
    path: ["pipeline", "link", "list"],
    description: "列出所有流水线投递链接",
    handler: async (_input, ctx) => {
      const links = await ctx.app.pipelineService.listLinks();
      return { ok: true, items: links };
    },
    help: {
      usage: "taskmeld pipeline link list",
      summary: "列出所有流水线投递链接",
    },
  },
  {
    key: "pipeline.queue",
    path: ["pipeline", "queue"],
    description: "查询流水线接收队列",
    handler: async (input, ctx) => {
      const pipelineId = assertRequiredArg(input.args[0], "pipelineId");
      const items = ctx.app.pipelineService.getQueue(pipelineId);
      return { ok: true, pipelineId, items };
    },
    help: {
      usage: "taskmeld pipeline queue <pipelineId>",
      args: [{ name: "pipelineId", required: true, description: "流水线 ID" }],
      summary: "查询流水线接收队列",
    },
  },
];
