import { t } from "../i18n"
import type { CliCommandHandler, CliRouteDefinition } from "../types"

export const systemSnapshotCommand: CliCommandHandler = async (_input, ctx) => {
  // The system snapshot is provided by the mainline service layer; the CLI only handles orchestration and output.
  return ctx.app.systemService.getSnapshot()
}

export const systemRoutes: CliRouteDefinition[] = [
  {
    key: "system.snapshot",
    path: ["system", "snapshot"],
    description: t("system.snapshot.description"),
    handler: systemSnapshotCommand,
    bootstrap: { gateway: "warmup" },
    help: {
      usage: "taskmeld system snapshot [--format <json|md>]",
      summary: t("system.snapshot.summary"),
    },
  },
]
