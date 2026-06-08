import { t } from "../i18n"
import type { CliCommandHandler, CliRouteDefinition } from "../types"

export const serverEnsureCommand: CliCommandHandler = async (_input, ctx) => {
  return ctx.app.serverService.ensureServerReady()
}

export const serverStartCommand: CliCommandHandler = async (_input, ctx) => {
  return ctx.app.serverService.startServer()
}

export const serverStatusCommand: CliCommandHandler = async (_input, ctx) => {
  return ctx.app.serverService.getServerStatus()
}

export const serverStopCommand: CliCommandHandler = async (_input, ctx) => {
  return ctx.app.serverService.stopServer()
}

export const serverRoutes: CliRouteDefinition[] = [
  {
    key: "server.ensure",
    path: ["server", "ensure"],
    description: t("server.ensure.description"),
    handler: serverEnsureCommand,
    bootstrap: { runtimeApiOnly: true },
    help: {
      usage: "taskmeld server ensure [--format <json|md>]",
      summary: t("server.ensure.summary"),
      notes: [t("server.ensure.noteDaemonFirst"), t("server.ensure.noteNewDaemon")],
    },
  },
  {
    key: "server.start",
    path: ["server", "start"],
    description: t("server.start.description"),
    handler: serverStartCommand,
    bootstrap: { runtimeApiOnly: true },
    help: {
      usage: "taskmeld server start [--format <json|md>]",
      summary: t("server.start.summary"),
    },
  },
  {
    key: "server.status",
    path: ["server", "status"],
    description: t("server.status.description"),
    handler: serverStatusCommand,
    bootstrap: { runtimeApiOnly: true },
    help: {
      usage: "taskmeld server status [--format <json|md>]",
      summary: t("server.status.summary"),
      notes: [t("server.status.note")],
    },
  },
  {
    key: "server.stop",
    path: ["server", "stop"],
    description: t("server.stop.description"),
    handler: serverStopCommand,
    bootstrap: { runtimeApiOnly: true },
    help: {
      usage: "taskmeld server stop [--format <json|md>]",
      summary: t("server.stop.summary"),
    },
  },
]
