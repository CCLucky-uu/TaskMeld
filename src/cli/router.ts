import { CliError } from "./errors";
import * as agentCommands from "./commands/agent";
import * as artifactCommands from "./commands/artifact";
import * as initCommands from "./commands/init";
import * as pipelineCommands from "./commands/pipeline";
import * as schedulerCommands from "./commands/scheduler";
import * as serverCommands from "./commands/server";
import * as systemCommands from "./commands/system";
import { resolveHelp, resolveHelpHint } from "./help";
import type { CliRouteDefinition, CliRouteMatch, CliRunOptions } from "./types";

const collectRoutesFromModule = (moduleExports: Record<string, unknown>): CliRouteDefinition[] => {
  // 只聚合命令模块导出的 *Routes，router 不再内联维护路由定义。
  return Object.entries(moduleExports)
    .filter(([exportName, value]) => exportName.endsWith("Routes") && Array.isArray(value))
    .flatMap(([, value]) => value as CliRouteDefinition[]);
};

export const CLI_ROUTES: CliRouteDefinition[] = [
  ...collectRoutesFromModule(initCommands),
  ...collectRoutesFromModule(systemCommands),
  ...collectRoutesFromModule(serverCommands),
  ...collectRoutesFromModule(pipelineCommands),
  ...collectRoutesFromModule(agentCommands),
  ...collectRoutesFromModule(artifactCommands),
  ...collectRoutesFromModule(schedulerCommands),
];

const parseFlagsAndArgs = (argv: string[]): { args: string[]; flags: Record<string, string | boolean> } => {
  const args: string[] = [];
  const flags: Record<string, string | boolean> = {};
  let index = 0;
  while (index < argv.length) {
    const token = argv[index];
    if (token === "-h") {
      flags.help = true;
      flags.h = true;
      index += 1;
      continue;
    }
    if (token === "-f") {
      const nextToken = argv[index + 1];
      if (nextToken && !nextToken.startsWith("-")) {
        flags.format = nextToken;
        index += 2;
        continue;
      }
      flags.format = true;
      index += 1;
      continue;
    }
    if (!token.startsWith("--")) {
      args.push(token);
      index += 1;
      continue;
    }

    const normalized = token.slice(2).trim();
    if (!normalized) {
      index += 1;
      continue;
    }

    const equalIndex = normalized.indexOf("=");
    if (equalIndex >= 0) {
      const key = normalized.slice(0, equalIndex).trim();
      const value = normalized.slice(equalIndex + 1).trim();
      if (key) flags[key] = value;
      index += 1;
      continue;
    }

    const nextToken = argv[index + 1];
    if (nextToken && !nextToken.startsWith("--")) {
      flags[normalized] = nextToken;
      index += 2;
      continue;
    }

    flags[normalized] = true;
    index += 1;
  }
  return { args, flags };
};

const isTruthyFlag = (value: string | boolean | undefined): boolean => {
  if (value === true) return true;
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "1";
};

export const resolveRoute = (options: CliRunOptions): CliRouteMatch => {
  const parsed = parseFlagsAndArgs(options.argv);
  if (Object.prototype.hasOwnProperty.call(parsed.flags, "version")) {
    throw new CliError("VERSION", { code: "VERSION_REQUESTED", exitCode: 0 });
  }
  const help = parsed.flags.help === true || parsed.flags.h === true;
  if (help) {
    const helpInfo = resolveHelp(CLI_ROUTES, parsed.args);
    if (!helpInfo) {
      throw new CliError(`Unknown command for help: ${parsed.args.join(" ") || "<empty>"}`, {
        code: "UNKNOWN_COMMAND",
        exitCode: 2,
      });
    }
    throw new CliError(helpInfo.text, { code: "HELP_REQUESTED", exitCode: 0 });
  }
  if (parsed.flags.format === true) {
    throw new CliError("Invalid output format: missing value for -f/--format. Use json or md", {
      code: "INVALID_ARGUMENT",
      exitCode: 2,
    });
  }
  const rawFormatFlag = typeof parsed.flags.format === "string" ? parsed.flags.format.trim().toLowerCase() : undefined;
  if (Object.prototype.hasOwnProperty.call(parsed.flags, "json") || Object.prototype.hasOwnProperty.call(parsed.flags, "md")) {
    throw new CliError("Deprecated output flags: use -f/--format <json|md> instead of --json/--md", {
      code: "INVALID_ARGUMENT",
      exitCode: 2,
    });
  }
  let format: "json" | "md" = "md";
  if (rawFormatFlag) {
    if (rawFormatFlag !== "json" && rawFormatFlag !== "md") {
      throw new CliError(`Invalid output format: ${rawFormatFlag}. Use json or md`, {
        code: "INVALID_ARGUMENT",
        exitCode: 2,
      });
    }
    format = rawFormatFlag;
  }
  const envelope = isTruthyFlag(parsed.flags.envelope);
  if (format !== "json" && envelope) {
    throw new CliError("Invalid flag: --envelope requires --format json", {
      code: "INVALID_ARGUMENT",
      exitCode: 2,
    });
  }

  const pathTokens = parsed.args.slice(0, 2);
  const route = CLI_ROUTES.find((item) => item.path[0] === pathTokens[0] && item.path[1] === pathTokens[1]);
  if (!route) {
    const hint = resolveHelpHint(CLI_ROUTES, parsed.args);
    throw new CliError(`Unknown command: ${pathTokens.join(" ") || "<empty>"}. ${hint}`, {
      code: "UNKNOWN_COMMAND",
      exitCode: 2,
    });
  }

  const commandArgs = parsed.args.slice(route.path.length);
  return {
    key: route.key,
    input: {
      args: commandArgs,
      flags: parsed.flags,
      stdin: options.stdin,
    },
    global: { format, envelope },
  };
};

export const getRouteDefinition = (key: string): CliRouteDefinition => {
  const route = CLI_ROUTES.find((item) => item.key === key);
  if (!route) {
    throw new CliError(`Route not found: ${key}`, {
      code: "ROUTE_NOT_FOUND",
      exitCode: 2,
    });
  }
  return route;
};
