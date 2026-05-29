import { SessionItem } from "./types";

export function mapSessions(items: unknown): SessionItem[] {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => {
      const obj = (item ?? {}) as Record<string, unknown>;
      const id = String(obj.sessionKey ?? obj.key ?? obj.sessionId ?? obj.id ?? "").trim();
      if (!id) return null;
      const title = String(obj.title ?? obj.name ?? id);
      return { id, title };
    })
    .filter((v): v is SessionItem => Boolean(v));
}
