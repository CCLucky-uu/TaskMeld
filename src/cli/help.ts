import type { CliArgHelpDefinition, CliOptionHelpDefinition, CliRouteDefinition } from "./types";

type HelpScope = "root" | "group" | "command";

type HelpInfo = {
  scope: HelpScope;
  text: string;
};

const ROOT_USAGE = "taskmeld <resource> <action> [args] [--flags]";

const GROUP_DESCRIPTIONS: Record<string, string> = {
  agent: "智能体管理",
  artifact: "产物管理",
  init: "First-time setup",
  pipeline: "流水线管理",
  scheduler: "调度控制",
  server: "后端服务管理",
  system: "系统信息",
};

const COMMON_OPTIONS_LINES = [
  "Common Options:",
  "  -f, --format <json|md>  输出格式（默认: md）",
  "  --envelope              仅与 --format json 搭配可用，输出完整包装层",
  "  -h, --help      显示当前命令帮助",
];

const listPublicRoutes = (routes: CliRouteDefinition[]): CliRouteDefinition[] => {
  return routes.filter((route) => route.hidden !== true);
};

const uniqueGroups = (routes: CliRouteDefinition[]): string[] => {
  return [...new Set(listPublicRoutes(routes).map((route) => route.path[0]))].sort();
};

const listGroupActions = (routes: CliRouteDefinition[], group: string): CliRouteDefinition[] => {
  return listPublicRoutes(routes)
    .filter((route) => route.path[0] === group)
    .sort((a, b) => a.path[1].localeCompare(b.path[1]));
};

const findCommandRoute = (routes: CliRouteDefinition[], group: string, action: string): CliRouteDefinition | undefined => {
  return routes.find((route) => route.path[0] === group && route.path[1] === action);
};

const formatArgsBlock = (args: CliArgHelpDefinition[] | undefined): string[] => {
  if (!args || args.length === 0) return [];
  return [
    "Arguments:",
    ...args.map((item) => {
      const printableName = item.name.startsWith("<") ? item.name : `<${item.name}>`;
      const requiredLabel = item.required ? "必填" : "可选";
      const detail = item.description ? `，${item.description}` : "";
      return `  ${printableName}  ${requiredLabel}${detail}`;
    }),
  ];
};

const formatOptionsBlock = (options: CliOptionHelpDefinition[] | undefined): string[] => {
  if (!options || options.length === 0) return [];
  return [
    "Options:",
    ...options.map((item) => {
      const flagName = item.flags.join(", ");
      const valueHint = item.valueName ? ` <${item.valueName}>` : "";
      const requiredLabel = item.required ? "必填" : "可选";
      const detail = item.description ? `，${item.description}` : "";
      return `  ${flagName}${valueHint}  ${requiredLabel}${detail}`;
    }),
  ];
};

const formatExamplesBlock = (examples: string[] | undefined): string[] => {
  if (!examples || examples.length === 0) return [];
  return ["Examples:", ...examples.map((example) => `  ${example}`)];
};

const formatNotesBlock = (notes: string[] | undefined): string[] => {
  if (!notes || notes.length === 0) return [];
  return ["Notes:", ...notes.map((note) => `  ${note}`)];
};

const appendCommonOptions = (lines: string[]): void => {
  lines.push("", ...COMMON_OPTIONS_LINES);
};

const renderRoot = (routes: CliRouteDefinition[]): string => {
  const groups = uniqueGroups(routes);
  const lines = [
    "Usage:",
    `  ${ROOT_USAGE}`,
    "",
    "Resources:",
    ...groups.map((group) => {
      const desc = GROUP_DESCRIPTIONS[group];
      return desc ? `  ${group.padEnd(12)}${desc}` : `  ${group}`;
    }),
    "",
    "Tips:",
    "  taskmeld <resource> -h         查看一级命令帮助",
    "  taskmeld <resource> <action> -h  查看二级命令帮助",
  ];
  return lines.join("\n");
};

const renderGroup = (routes: CliRouteDefinition[], group: string): string => {
  const commands = listGroupActions(routes, group);
  const lines = [
    "Usage:",
    `  taskmeld ${group} <action> [args] [--flags]`,
    "",
    "Actions:",
    ...commands.map((route) => `  ${route.path[1]}  ${route.description}`),
    "",
    "Tips:",
    `  taskmeld ${group} <action> -h`,
  ];
  return lines.join("\n");
};

const renderAutoCommandHelp = (route: CliRouteDefinition): string => {
  const help = route.help;
  const lines = ["Usage:", `  ${help.usage}`];
  const summary = help.summary ?? route.description;
  lines.push("", "Description:", `  ${summary}`);

  const argsBlock = formatArgsBlock(help.args);
  if (argsBlock.length > 0) {
    lines.push("", ...argsBlock);
  }

  const optionsBlock = formatOptionsBlock(help.options);
  if (optionsBlock.length > 0) {
    lines.push("", ...optionsBlock);
  }

  const examplesBlock = formatExamplesBlock(help.examples);
  if (examplesBlock.length > 0) {
    lines.push("", ...examplesBlock);
  }

  const notesBlock = formatNotesBlock(help.notes);
  if (notesBlock.length > 0) {
    lines.push("", ...notesBlock);
  }

  return lines.join("\n");
};

const renderCommand = (route: CliRouteDefinition): string => {
  // 保留特例出口是为了兼容未来极少数需要完全自定义排版的命令；默认路径必须使用路由元数据生成。
  const text = route.renderHelp ? route.renderHelp(route) : renderAutoCommandHelp(route);
  const lines = text.split("\n");
  appendCommonOptions(lines);
  return lines.join("\n");
};

export const resolveHelp = (routes: CliRouteDefinition[], args: string[]): HelpInfo | null => {
  if (args.length === 0) {
    return { scope: "root", text: renderRoot(routes) };
  }
  const group = args[0];
  if (!group) {
    return { scope: "root", text: renderRoot(routes) };
  }
  if (args.length === 1) {
    const standaloneRoute = routes.find((r) => r.path.length === 1 && r.path[0] === group);
    if (standaloneRoute) {
      return { scope: "command", text: renderCommand(standaloneRoute) };
    }
    const commands = listGroupActions(routes, group);
    if (commands.length === 0) return null;
    return { scope: "group", text: renderGroup(routes, group) };
  }
  const action = args[1];
  const route = findCommandRoute(routes, group, action);
  if (!route) return null;
  return { scope: "command", text: renderCommand(route) };
};

export const resolveHelpHint = (routes: CliRouteDefinition[], args: string[]): string => {
  if (args.length >= 2) {
    const group = args[0];
    const hasGroup = listGroupActions(routes, group).length > 0;
    if (hasGroup) {
      return `Use: taskmeld ${group} -h`;
    }
  }
  if (args.length >= 2) {
    return `Use: taskmeld ${args[0]} ${args[1]} -h`;
  }
  if (args.length === 1) {
    return `Use: taskmeld ${args[0]} -h`;
  }
  return "Use: taskmeld -h";
};

export const resolveHelpHintByRouteKey = (routes: CliRouteDefinition[], routeKey: string): string => {
  const route = routes.find((item) => item.key === routeKey);
  if (!route) return "Use: taskmeld -h";
  return `Use: taskmeld ${route.path[0]} ${route.path[1]} -h`;
};
