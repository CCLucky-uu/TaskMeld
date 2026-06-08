import { readFile, writeFile, mkdir } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join, dirname } from "node:path"
import type { ToolPreferences } from "./types"
import { DEFAULT_TOOL_PREFERENCES } from "./types"

function getPrefsPath(dataDir: string): string {
  return join(dataDir, "tool-preferences.json")
}

export async function loadUserPreferences(dataDir: string): Promise<ToolPreferences> {
  const path = getPrefsPath(dataDir)
  if (!existsSync(path)) return { ...DEFAULT_TOOL_PREFERENCES }
  try {
    const raw = await readFile(path, "utf-8")
    const parsed = JSON.parse(raw) as Partial<ToolPreferences>
    return {
      mode: parsed.mode ?? DEFAULT_TOOL_PREFERENCES.mode,
      alwaysAllow: parsed.alwaysAllow ?? [],
      alwaysDeny: parsed.alwaysDeny ?? [],
    }
  } catch {
    return { ...DEFAULT_TOOL_PREFERENCES }
  }
}

export async function saveUserPreferences(dataDir: string, prefs: ToolPreferences): Promise<void> {
  const path = getPrefsPath(dataDir)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(prefs, null, 2))
}

export function resolvePreferences(convPrefs?: ToolPreferences, userGlobal?: ToolPreferences): ToolPreferences {
  const base = userGlobal ?? DEFAULT_TOOL_PREFERENCES
  if (!convPrefs) return base
  return {
    mode: convPrefs.mode,
    alwaysAllow: [...new Set([...convPrefs.alwaysAllow, ...base.alwaysAllow])],
    alwaysDeny: [...new Set([...convPrefs.alwaysDeny, ...base.alwaysDeny])],
  }
}

export function resolvePermission(
  toolName: string,
  annotations: { readOnly: boolean; destructive: boolean; requiresConfirmation: boolean },
  preferences: ToolPreferences,
): { decision: "allow" | "deny" | "confirm"; reason?: string } {
  if (preferences.mode === "auto") {
    return { decision: "allow" }
  }

  if (preferences.mode === "plan") {
    if (annotations.readOnly) return { decision: "allow" }
    return {
      decision: "deny",
      reason: `Tool "${toolName}" blocked by plan mode. Inform the user to manually switch to normal or auto mode.`,
    }
  }

  // normal
  if (preferences.alwaysDeny.includes(toolName)) {
    return { decision: "deny", reason: `Tool "${toolName}" is blocked by user preferences.` }
  }
  if (preferences.alwaysAllow.includes(toolName)) {
    return { decision: "allow" }
  }
  if (annotations.readOnly) return { decision: "allow" }
  if (annotations.destructive || annotations.requiresConfirmation) {
    return { decision: "confirm" }
  }
  return { decision: "allow" }
}
