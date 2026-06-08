import type { RenderSpecMap } from "../engine/types"

export const initRenderSpecs: RenderSpecMap = {
  init: {
    kind: "text",
    render: (data) => {
      const d = data as { ok: boolean; gatewayUrl?: string; configPath?: string; interactive?: boolean }
      if (d.interactive) return ""
      if (d.ok) {
        const lines = [
          "Gateway configured successfully.",
          "",
          `  URL     ${d.gatewayUrl ?? "(set)"}`,
          `  Config  ${d.configPath ?? "~/.taskmeld/config.json"}`,
          "",
          '  Run "taskmeld server start" to begin.',
        ]
        return lines.join("\n")
      }
      return "Setup was not completed."
    },
  },
}
