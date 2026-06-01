import { CliError, assertRequiredArg } from "../errors";
import { t } from "../i18n";
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
    return { ...planObj, dryRun: true, message: t("artifact.cleanup.dryRunMessage") };
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
    description: t("artifact.index.description"),
    handler: artifactIndexCommand,
    help: {
      usage: "taskmeld artifact index rebuild [--pipeline <id>] [--format <json|md>]",
      args: [{ name: "rebuild", required: true, description: t("artifact.index.argRebuild") }],
      options: [{ flags: ["--pipeline"], valueName: "id", description: t("artifact.index.optPipeline") }],
      summary: t("artifact.index.summary"),
    },
  },
  {
    key: "artifact.list",
    path: ["artifact", "list"],
    description: t("artifact.list.description"),
    handler: artifactListCommand,
    help: {
      usage: "taskmeld artifact list [--pipeline <id>] [--node <id>] [--status <status>] [--kind <kind>] [--batch <id>] [--run <id>] [--cursor <cursor>] [--format <json|md>]",
      options: [
        { flags: ["--pipeline"], valueName: "id", description: t("artifact.list.optPipeline") },
        { flags: ["--node"], valueName: "id", description: t("artifact.list.optNode") },
        { flags: ["--status"], valueName: "status", description: "success,failed,rejected" },
        { flags: ["--kind"], valueName: "kind", description: "artifact,envelope,adapter,group" },
        { flags: ["--batch"], valueName: "id", description: t("artifact.list.optBatch") },
        { flags: ["--run"], valueName: "id", description: t("artifact.list.optRun") },
        { flags: ["--cursor"], valueName: "cursor", description: t("artifact.list.optCursor") },
      ],
      summary: t("artifact.list.summary"),
    },
  },
  {
    key: "artifact.show",
    path: ["artifact", "show"],
    description: t("artifact.show.description"),
    handler: artifactShowCommand,
    help: {
      usage: "taskmeld artifact show <pipelineId> <relativePath> [--format <json|md>]",
      args: [
        { name: "pipelineId", required: true, description: t("artifact.show.argPipelineId") },
        { name: "relativePath", required: true, description: t("artifact.show.argRelativePath") },
      ],
      summary: t("artifact.show.summary"),
    },
  },
  {
    key: "artifact.export",
    path: ["artifact", "export"],
    description: t("artifact.export.description"),
    handler: artifactExportCommand,
    help: {
      usage: "taskmeld artifact export [--pipeline <id>] [--from <date>] [--to <date>] [--format <json>]",
      options: [
        { flags: ["--pipeline"], valueName: "id", description: t("artifact.export.optPipeline") },
        { flags: ["--node"], valueName: "id", description: t("artifact.export.optNode") },
        { flags: ["--status"], valueName: "status", description: "success,failed,rejected" },
        { flags: ["--kind"], valueName: "kind", description: "artifact,envelope,adapter,group" },
        { flags: ["--batch"], valueName: "id", description: t("artifact.export.optBatch") },
        { flags: ["--from"], valueName: "date", description: t("artifact.export.optFrom") },
        { flags: ["--to"], valueName: "date", description: t("artifact.export.optTo") },
        { flags: ["--limit"], valueName: "n", description: t("artifact.export.optLimit") },
      ],
      summary: t("artifact.export.summary"),
    },
  },
  {
    key: "artifact.cleanup",
    path: ["artifact", "cleanup"],
    description: t("artifact.cleanup.description"),
    handler: artifactCleanupCommand,
    help: {
      usage: "taskmeld artifact cleanup <pipelineId> [--older-than <days>] [--status <status>] [--confirm]",
      args: [{ name: "pipelineId", required: true, description: t("artifact.cleanup.argPipelineId") }],
      options: [
        { flags: ["--pipeline"], valueName: "id", description: t("artifact.list.optPipeline") },
        { flags: ["--older-than"], valueName: "days", description: t("artifact.cleanup.optOlderThan") },
        { flags: ["--status"], valueName: "status", description: "success,failed,rejected" },
        { flags: ["--confirm"], description: t("artifact.cleanup.optConfirm") },
      ],
      summary: t("artifact.cleanup.summary"),
    },
  },
];
