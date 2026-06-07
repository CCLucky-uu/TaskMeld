import type { Tool } from "../../types"
import type { ReadonlyServices } from "../../../services/read-services"
import { APP_VERSION } from "../../../version"
import { readFileSync } from "node:fs"

function getPlatform(): string {
  const p = process.platform
  if (p === "win32") return "Windows"
  if (p === "darwin") return "macOS"
  if (p === "linux") {
    if (process.env.WSL_DISTRO_NAME) return `WSL (${process.env.WSL_DISTRO_NAME})`
    try {
      const ver = readFileSync("/proc/version", "utf-8")
      if (ver.includes("Microsoft") || ver.includes("WSL")) return "WSL"
    } catch {
      /* not WSL */
    }
    return "Linux"
  }
  return p
}

export function createSystemTools(services?: ReadonlyServices | null): Tool[] {
  return [
    {
      name: "system_status",
      description: "Get TaskMeld server status including uptime, version, and resource usage.",
      parameters: { type: "object", properties: {}, required: [] },
      annotations: { readOnly: true, destructive: false, requiresConfirmation: false, idempotent: true },
      permission: "auto",
      async execute() {
        let gateway: Record<string, unknown> = { connected: false }
        if (services?.system) {
          try {
            const snapshot = services.system.getSnapshot()
            const gw = snapshot.gateway as any
            gateway = {
              connected: gw?.status?.connected ?? false,
              url: gw?.status?.url ?? null,
              lastError: gw?.status?.lastError ?? null,
            }
          } catch {
            /* use default */
          }
        }

        return {
          output: JSON.stringify(
            {
              status: "running",
              version: APP_VERSION,
              platform: getPlatform(),
              currentTime: new Date().toISOString().replace("T", " ").slice(0, 19),
              uptime: process.uptime(),
              memory: process.memoryUsage(),
              gateway,
            },
            null,
            2,
          ),
          isError: false,
        }
      },
    },
    {
      name: "system_gateway",
      description: "Get OpenClaw Gateway connection status.",
      parameters: { type: "object", properties: {}, required: [] },
      annotations: { readOnly: true, destructive: false, requiresConfirmation: false, idempotent: true },
      permission: "auto",
      async execute() {
        if (!services?.system) {
          return { output: "System service not available.", isError: true }
        }
        try {
          const snapshot = services.system.getSnapshot()
          const gw = snapshot.gateway as any
          return {
            output: JSON.stringify(
              {
                connected: gw?.status?.connected ?? false,
                url: gw?.status?.url ?? null,
                lastError: gw?.status?.lastError ?? null,
                hello: gw?.hello ?? null,
                lastFrame: gw?.lastFrame ?? null,
              },
              null,
              2,
            ),
            isError: false,
          }
        } catch (err) {
          return {
            output: `Failed to get gateway status: ${err instanceof Error ? err.message : String(err)}`,
            isError: true,
          }
        }
      },
    },
  ]
}
