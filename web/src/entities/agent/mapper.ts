import { AgentItem } from "./types";

export function mapAgents(items: unknown): AgentItem[] {
  if (!Array.isArray(items)) return [];
  const toEpochMs = (value: unknown): number | null => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const asNum = Number(value);
      if (Number.isFinite(asNum)) return asNum;
      const asDate = Date.parse(value);
      if (Number.isFinite(asDate)) return asDate;
    }
    return null;
  };

  return items
    .map((item, index) => {
      const obj = (item ?? {}) as Record<string, unknown>;
      const id = String(obj.id ?? obj.name ?? obj.key ?? `agent-${index}`);
      const role = String(obj.role ?? "agent");
      const state = String(obj.status ?? obj.state ?? "");
      const online = Boolean(
        obj.online ?? obj.enabled ?? (state ? state === "online" || state === "ready" || state === "active" : true),
      );
      const lastActiveAtMs =
        toEpochMs(obj.lastActiveAtMs ?? obj.lastActiveAt ?? obj.updatedAt ?? obj.lastSeenAt ?? obj.endedAt) ?? null;
      const lastActiveAt = lastActiveAtMs ? new Date(lastActiveAtMs).toISOString() : null;
      return { id, role, online, lastActiveAt, lastActiveAtMs };
    })
    .sort((a, b) => {
      const aMs = a.lastActiveAtMs ?? -1;
      const bMs = b.lastActiveAtMs ?? -1;
      if (aMs !== bMs) return bMs - aMs;
      return a.id.localeCompare(b.id);
    });
}
