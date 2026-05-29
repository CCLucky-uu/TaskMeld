import { CliError, assertRequiredArg } from "../errors";
import type { CliCommandHandler, CliRouteDefinition } from "../types";

const pickOptionalString = (value: string | boolean | undefined): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
};

const pickCsvStrings = (value: string | boolean | undefined): string[] | undefined => {
  if (typeof value !== "string") return undefined;
  const values = value.split(",").map((item) => item.trim()).filter(Boolean);
  return values.length ? values : undefined;
};

const pickPositiveInteger = (value: string | boolean | undefined, flagName: string): number | undefined => {
  if (value === undefined) return undefined;
  if (value === true) {
    throw new CliError(`Invalid flag: --${flagName} requires a positive integer`, {
      code: "INVALID_ARGUMENT",
      exitCode: 2,
    });
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new CliError(`Invalid flag: --${flagName} must be a positive integer`, {
      code: "INVALID_ARGUMENT",
      exitCode: 2,
    });
  }
  return parsed;
};

export const artifactListCommand: CliCommandHandler = async (input, ctx) => {
  return ctx.app.artifactService.listArtifacts({
    pipelineId: pickOptionalString(input.flags.pipeline),
    nodeId: pickOptionalString(input.flags.node),
    status: pickOptionalString(input.flags.status),
    kind: pickOptionalString(input.flags.kind),
    batchRunId: pickOptionalString(input.flags.batch),
    runId: pickOptionalString(input.flags.run),
    cursor: pickOptionalString(input.flags.cursor),
  });
};

export const artifactShowCommand: CliCommandHandler = async (input, ctx) => {
  const pipelineId = assertRequiredArg(input.args[0], "pipelineId");
  const relativePath = assertRequiredArg(input.args[1], "relativePath");
  return ctx.app.artifactService.getArtifactContent({ pipelineId, relativePath });
};

export const artifactExportCommand: CliCommandHandler = async (input, ctx) => {
  return ctx.app.artifactService.exportArtifacts({
    pipelineId: pickOptionalString(input.flags.pipeline),
    nodeId: pickOptionalString(input.flags.node),
    status: pickOptionalString(input.flags.status),
    kind: pickOptionalString(input.flags.kind),
    batchRunId: pickOptionalString(input.flags.batch),
    dateFrom: pickOptionalString(input.flags.from),
    dateTo: pickOptionalString(input.flags.to),
    limit: pickPositiveInteger(input.flags.limit, "limit"),
  });
};

export const artifactCleanupCommand: CliCommandHandler = async (input, ctx) => {
  const pipelineId = assertRequiredArg(input.args[0], "pipelineId");
  const plan = await ctx.app.artifactService.planCleanup(pipelineId, {
    olderThanDays: pickPositiveInteger(input.flags["older-than"], "older-than"),
    statuses: pickCsvStrings(input.flags.status),
  });
  const planObj = plan as Record<string, unknown>;
  if (input.flags.confirm !== true) {
    return { ...planObj, dryRun: true, message: "dry-run 模式，候选文件不会删除。传入 --confirm 执行真实删除。" };
  }
  const result = await ctx.app.artifactService.executeCleanup(pipelineId, plan) as Record<string, unknown>;
  return { ...planObj, dryRun: false, ...result };
};

export const artifactIndexCommand: CliCommandHandler = async (input, ctx) => {
  const action = assertRequiredArg(input.args[0], "action");
  if (action !== "rebuild") {
    throw new CliError(`Unknown artifact index action: ${action}`, {
      code: "UNKNOWN_COMMAND",
      exitCode: 2,
      details: { action },
    });
  }
  return ctx.app.artifactService.rebuildIndex(pickOptionalString(input.flags.pipeline));
};

export const artifactRoutes: CliRouteDefinition[] = [
  {
    key: "artifact.index",
    path: ["artifact", "index"],
    description: "重建产物索引",
    handler: artifactIndexCommand,
    help: {
      usage: "taskmeld artifact index rebuild [--pipeline <id>] [--format <json|md>]",
      args: [{ name: "rebuild", required: true, description: "重建 index.jsonl" }],
      options: [{ flags: ["--pipeline"], valueName: "id", description: "只重建指定流水线" }],
      summary: "扫描产物目录并重建 index.jsonl，用于升级后纳入历史文件或修复索引不一致",
    },
  },
  {
    key: "artifact.list",
    path: ["artifact", "list"],
    description: "输出产物列表",
    handler: artifactListCommand,
    help: {
      usage: "taskmeld artifact list [--pipeline <id>] [--node <id>] [--status <status>] [--kind <kind>] [--batch <id>] [--run <id>] [--cursor <cursor>] [--format <json|md>]",
      options: [
        { flags: ["--pipeline"], valueName: "id", description: "按流水线过滤" },
        { flags: ["--node"], valueName: "id", description: "按节点过滤" },
        { flags: ["--status"], valueName: "status", description: "success,failed,rejected" },
        { flags: ["--kind"], valueName: "kind", description: "artifact,envelope,adapter,group" },
        { flags: ["--batch"], valueName: "id", description: "按批跑ID过滤" },
        { flags: ["--run"], valueName: "id", description: "按运行RunId过滤" },
        { flags: ["--cursor"], valueName: "cursor", description: "分页游标" },
      ],
      summary: "输出产物列表，支持状态/类型/批跑/游标分页",
    },
  },
  {
    key: "artifact.show",
    path: ["artifact", "show"],
    description: "输出产物内容",
    handler: artifactShowCommand,
    help: {
      usage: "taskmeld artifact show <pipelineId> <relativePath> [--format <json|md>]",
      args: [
        { name: "pipelineId", required: true, description: "流水线 ID" },
        { name: "relativePath", required: true, description: "产物相对路径" },
      ],
      summary: "输出指定产物的文件内容",
    },
  },
  {
    key: "artifact.export",
    path: ["artifact", "export"],
    description: "导出产物内容",
    handler: artifactExportCommand,
    help: {
      usage: "taskmeld artifact export [--pipeline <id>] [--from <date>] [--to <date>] [--format <json>]",
      options: [
        { flags: ["--pipeline"], valueName: "id", description: "按流水线过滤" },
        { flags: ["--node"], valueName: "id", description: "按节点过滤" },
        { flags: ["--status"], valueName: "status", description: "success,failed,rejected" },
        { flags: ["--kind"], valueName: "kind", description: "artifact,envelope,adapter,group" },
        { flags: ["--batch"], valueName: "id", description: "按批跑ID过滤" },
        { flags: ["--from"], valueName: "date", description: "开始日期 YYYY-MM-DD" },
        { flags: ["--to"], valueName: "date", description: "结束日期 YYYY-MM-DD" },
        { flags: ["--limit"], valueName: "n", description: "最大导出条数，默认20000" },
      ],
      summary: "导出产物内容为 日期->流水线->节点 三层JSON",
    },
  },
  {
    key: "artifact.cleanup",
    path: ["artifact", "cleanup"],
    description: "清理旧产物",
    handler: artifactCleanupCommand,
    help: {
      usage: "taskmeld artifact cleanup <pipelineId> [--older-than <days>] [--status <status>] [--confirm]",
      args: [{ name: "pipelineId", required: true, description: "流水线 ID" }],
      options: [
        { flags: ["--pipeline"], valueName: "id", description: "按流水线过滤" },
        { flags: ["--older-than"], valueName: "days", description: "保留天数，默认 success=30/failed=90/rejected=90" },
        { flags: ["--status"], valueName: "status", description: "success,failed,rejected" },
        { flags: ["--confirm"], description: "必须显式传入才执行真实删除，否则 dry-run" },
      ],
      summary: "清理旧产物文件，默认 dry-run 只展示候选不删除，传 --confirm 执行真实删除并重建索引",
    },
  },
];
