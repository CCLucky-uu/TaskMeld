import type { CliCommandHandler, CliRouteDefinition } from "../types";

export const systemSnapshotCommand: CliCommandHandler = async (_input, ctx) => {
  // 系统快照由主线 service 层提供，CLI 只做编排与输出。
  return ctx.app.systemService.getSnapshot();
};

export const systemRoutes: CliRouteDefinition[] = [
  {
    key: "system.snapshot",
    path: ["system", "snapshot"],
    description: "输出系统全局快照",
    handler: systemSnapshotCommand,
    bootstrap: { gateway: "warmup" },
    help: {
      usage: "taskmeld system snapshot [--format <json|md>]",
      summary: "输出系统全局快照",
    },
  },
];
