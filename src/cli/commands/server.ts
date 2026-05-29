import type { CliCommandHandler, CliRouteDefinition } from "../types";

export const serverEnsureCommand: CliCommandHandler = async (_input, ctx) => {
  return ctx.app.serverService.ensureServerReady();
};

export const serverStartCommand: CliCommandHandler = async (_input, ctx) => {
  return ctx.app.serverService.startServer();
};

export const serverStatusCommand: CliCommandHandler = async (_input, ctx) => {
  return ctx.app.serverService.getServerStatus();
};

export const serverStopCommand: CliCommandHandler = async (_input, ctx) => {
  return ctx.app.serverService.stopServer();
};

export const serverRoutes: CliRouteDefinition[] = [
  {
    key: "server.ensure",
    path: ["server", "ensure"],
    description: "确保本地控制面后端已启动并健康",
    handler: serverEnsureCommand,
    bootstrap: { runtimeApiOnly: true },
    help: {
      usage: "taskmeld server ensure [--format <json|md>]",
      summary: "确保本地 control-plane daemon 已启动并健康",
      notes: [
        "daemon-first 语义：优先复用已存在且健康的本地实例。",
        "仅在没有可复用健康实例时，才会启动新的 daemon。",
      ],
    },
  },
  {
    key: "server.start",
    path: ["server", "start"],
    description: "显式启动本地控制面后端",
    handler: serverStartCommand,
    bootstrap: { runtimeApiOnly: true },
    help: {
      usage: "taskmeld server start [--format <json|md>]",
      summary: "显式启动本地 control-plane daemon",
    },
  },
  {
    key: "server.status",
    path: ["server", "status"],
    description: "输出本地控制面后端状态",
    handler: serverStatusCommand,
    bootstrap: { runtimeApiOnly: true },
    help: {
      usage: "taskmeld server status [--format <json|md>]",
      summary: "查看本地 control-plane daemon 的健康、ownership 与 pid 信息",
      notes: ["状态输出用于确认本地 daemon 是否可复用以及当前 owner 元数据是否一致。"],
    },
  },
  {
    key: "server.stop",
    path: ["server", "stop"],
    description: "停止本地控制面后端",
    handler: serverStopCommand,
    bootstrap: { runtimeApiOnly: true },
    help: {
      usage: "taskmeld server stop [--format <json|md>]",
      summary: "停止本地 control-plane daemon",
    },
  },
];
