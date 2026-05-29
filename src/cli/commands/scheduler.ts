import { CliError, assertBooleanFlag, assertRequiredArg } from "../errors";
import type { CliCommandHandler, CliRouteDefinition } from "../types";

const assertSchedulerMode = (value: string | boolean | undefined): "auto" | "manual" => {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "auto" || normalized === "manual") {
      return normalized;
    }
  }
  throw new CliError("Invalid scheduler mode: --mode", {
    code: "INVALID_ARGUMENT",
    exitCode: 2,
  });
};

const normalizeSchedulerResult = (
  result: unknown,
  pipelineId: string,
): { ok: true; pipelineId: string; scheduler: unknown } => {
  const data = result as { ok?: boolean; error?: string; plugin?: string };
  if (data.ok === true) {
    return result as { ok: true; pipelineId: string; scheduler: unknown };
  }
  if (data.error === "pipeline_not_found") {
    throw new CliError(`Pipeline not found: ${pipelineId}`, {
      code: "PIPELINE_NOT_FOUND",
      exitCode: 3,
      details: { pipelineId },
    });
  }
  if (data.error === "pipeline_plugin_disabled") {
    throw new CliError(`Scheduler plugin disabled: ${pipelineId}`, {
      code: "PIPELINE_PLUGIN_DISABLED",
      exitCode: 4,
      details: { pipelineId, plugin: data.plugin ?? "scheduler" },
    });
  }
  throw new CliError("Scheduler command failed", {
    code: "SCHEDULER_COMMAND_FAILED",
    exitCode: 4,
    details: { pipelineId, result },
  });
};

export const schedulerToggleCommand: CliCommandHandler = async (input, ctx) => {
  const pipelineId = assertRequiredArg(input.args[0], "pipelineId");
  const enabled = assertBooleanFlag(input.flags.enabled, "enabled");
  const result = await ctx.app.schedulerService.toggleScheduler(pipelineId, enabled);
  return normalizeSchedulerResult(result, pipelineId);
};

export const schedulerModeCommand: CliCommandHandler = async (input, ctx) => {
  const pipelineId = assertRequiredArg(input.args[0], "pipelineId");
  const mode = assertSchedulerMode(input.flags.mode);
  const result = await ctx.app.schedulerService.setSchedulerMode(pipelineId, mode);
  return normalizeSchedulerResult(result, pipelineId);
};

export const schedulerRoutes: CliRouteDefinition[] = [
  {
    key: "scheduler.toggle",
    path: ["scheduler", "toggle"],
    description: "启用或停用调度器",
    handler: schedulerToggleCommand,
    help: {
      usage: "taskmeld scheduler toggle <pipelineId> --enabled <true|false> [--format <json|md>]",
      args: [{ name: "pipelineId", required: true, description: "流水线 ID" }],
      options: [{ flags: ["--enabled"], valueName: "true|false", required: true, description: "是否启用调度器" }],
      notes: ["<pipelineId> 与 --enabled 均为必填控制项。"],
    },
  },
  {
    key: "scheduler.mode",
    path: ["scheduler", "mode"],
    description: "切换调度器模式",
    handler: schedulerModeCommand,
    help: {
      usage: "taskmeld scheduler mode <pipelineId> --mode <auto|manual> [--format <json|md>]",
      args: [{ name: "pipelineId", required: true, description: "流水线 ID" }],
      options: [{ flags: ["--mode"], valueName: "auto|manual", required: true, description: "调度器模式" }],
      notes: ["<pipelineId> 与 --mode 均为必填控制项。"],
    },
  },
];
