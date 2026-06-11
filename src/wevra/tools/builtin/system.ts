import type { Tool } from "../../types"
import type { ReadonlyServices } from "../../../services/read-services"
import { APP_VERSION } from "../../../version"
import { readFileSync } from "node:fs"

const pad = (n: number) => String(n).padStart(2, "0")
const formatLocalTime = () => {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

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
      name: "system_time",
      description:
        "Get the current local date and time.",
      parameters: { type: "object", properties: {}, required: [] },
      annotations: { readOnly: true, destructive: false, requiresConfirmation: false, idempotent: true },
      permission: "auto",
      async execute() {
        const d = new Date()
        const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
        return {
          output: JSON.stringify(
            {
              localTime: formatLocalTime(),
              dayOfWeek: days[d.getDay()],
              timestamp: d.getTime(),
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              utcOffset: `UTC${d.getTimezoneOffset() > 0 ? "-" : "+"}${pad(Math.abs(d.getTimezoneOffset()) / 60)}:${pad(Math.abs(d.getTimezoneOffset()) % 60)}`,
            },
            null,
            2,
          ),
          isError: false,
        }
      },
    },
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
              currentTime: formatLocalTime(),
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
