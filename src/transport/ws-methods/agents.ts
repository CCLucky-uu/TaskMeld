import type { WsMethodRegistry } from "./types";
import { asRecord, formatError } from "./utils";
import { resolveDefaultWorkspacePath } from "../../app/user-config";

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

const readSessionActivityMs = (raw: Record<string, unknown>): number | null => {
  const candidates = [raw.updatedAt, raw.endedAt, raw.startedAt, raw.timestamp, raw.ts];
  let best: number | null = null;
  for (const candidate of candidates) {
    const ms = toEpochMs(candidate);
    if (ms === null) continue;
    if (best === null || ms > best) best = ms;
  }
  return best;
};

const inferAgentIdsFromSession = (session: { id: string; raw: Record<string, unknown> }): string[] => {
  const out = new Set<string>();
  const id = session.id.trim();
  if (id) {
    const match = id.match(/^agent:([^:]+):/i);
    if (match?.[1]) out.add(match[1]);
  }
  const directKeys = [session.raw.agentId, session.raw.agent_id, session.raw.executorAgentId, session.raw.ownerAgentId];
  for (const value of directKeys) {
    if (typeof value === "string" && value.trim()) out.add(value.trim());
  }
  return [...out];
};

export const registerAgentWsMethods = (registry: WsMethodRegistry): void => {
  registry.register("agent.list", async (_params, ctx) => {
    try {
      const payload = await ctx.services.client.sendReq("agents.list");
      const rawItems = ctx.services.pickArray(payload);
      let sessionItems = ctx.services.getSessionCache();
      try {
        const refreshed = await ctx.services.refreshSessionsFromGateway();
        sessionItems = refreshed.items;
      } catch { /* silent */ }

      const lastActiveByAgentId = new Map<string, number>();
      for (const session of sessionItems) {
        const activityMs = readSessionActivityMs(session.raw);
        if (activityMs === null) continue;
        for (const agentId of inferAgentIdsFromSession(session)) {
          const prev = lastActiveByAgentId.get(agentId);
          if (prev === undefined || activityMs > prev) {
            lastActiveByAgentId.set(agentId, activityMs);
          }
        }
      }

      const items = rawItems
        .map((item) => {
          const obj = asRecord(item);
          if (!obj) return item;
          const agentId = String(obj.id ?? obj.name ?? obj.key ?? "").trim();
          const activeMs = agentId ? (lastActiveByAgentId.get(agentId) ?? null) : null;
          return { ...obj, lastActiveAtMs: activeMs, lastActiveAt: activeMs ? new Date(activeMs).toISOString() : null };
        })
        .sort((a, b) => {
          const aObj = asRecord(a);
          const bObj = asRecord(b);
          const aMs = toEpochMs(aObj?.lastActiveAtMs ?? aObj?.lastActiveAt) ?? -1;
          const bMs = toEpochMs(bObj?.lastActiveAtMs ?? bObj?.lastActiveAt) ?? -1;
          if (aMs !== bMs) return bMs - aMs;
          const aId = String(aObj?.id ?? aObj?.name ?? "");
          const bId = String(bObj?.id ?? bObj?.name ?? "");
          return aId.localeCompare(bId);
        });

      return { ok: true, payload: { items, raw: payload } };
    } catch (error) {
      return { ok: false, error: formatError(error) };
    }
  });

  registry.register("agent.files.list", async (params, ctx) => {
    try {
      const agentId = typeof params.agentId === "string" ? params.agentId.trim() : "";
      if (!agentId) return { ok: false, error: "invalid_agent_id" };
      const payload = await ctx.services.client.sendReq("agents.files.list", { agentId });
      const obj = (payload ?? {}) as Record<string, unknown>;
      const files = Array.isArray(obj.files) ? obj.files : ctx.services.pickArray(payload);
      return { ok: true, payload: { items: files, raw: payload } };
    } catch (error) {
      return { ok: false, error: formatError(error) };
    }
  });

  registry.register("agent.files.get", async (params, ctx) => {
    try {
      const agentId = typeof params.agentId === "string" ? params.agentId.trim() : "";
      const name = typeof params.name === "string" ? params.name.trim() : "";
      if (!agentId) return { ok: false, error: "invalid_agent_id" };
      if (!name) return { ok: false, error: "invalid_file_name" };
      const payload = await ctx.services.client.sendReq("agents.files.get", { agentId, name });
      const obj = (payload ?? {}) as Record<string, unknown>;
      const file = (obj.file ?? payload) as unknown;
      return { ok: true, payload: { item: file ?? null, raw: payload } };
    } catch (error) {
      return { ok: false, error: formatError(error) };
    }
  });

  // Equivalent to CLI-side resolveDefaultWorkspacePath; the frontend uses this WS method
  // to resolve the default path, avoiding hardcoded path assembly in the browser.
  registry.register("agent.defaultWorkspace", async (params, _ctx) => {
    try {
      const name = typeof params.name === "string" ? params.name.trim() : "";
      const workspace = await resolveDefaultWorkspacePath(name);
      return { ok: true, payload: { workspace } };
    } catch (error) {
      return { ok: false, error: formatError(error) };
    }
  });

  registry.register("agent.create", async (params, ctx) => {
    try {
      const name = typeof params.name === "string" ? params.name.trim() : "";
      if (!name) return { ok: false, error: "invalid_agent_name" };
      let workspace: string;
      if (typeof params.workspace === "string" && params.workspace.trim()) {
        workspace = params.workspace.trim();
      } else {
        workspace = await resolveDefaultWorkspacePath(name);
      }
      const payload = await ctx.services.client.sendReq(
        "agents.create", { name, workspace },
      );
      return { ok: true, payload: payload ?? {} };
    } catch (error) {
      return { ok: false, error: formatError(error) };
    }
  });

  registry.register("agent.update", async (params, ctx) => {
    try {
      const agentId = typeof params.agentId === "string" ? params.agentId.trim() : "";
      if (!agentId) return { ok: false, error: "invalid_agent_id" };
      const updateParams: Record<string, unknown> = { agentId };
      if (typeof params.name === "string" && params.name.trim()) updateParams.name = params.name.trim();
      if (typeof params.workspace === "string" && params.workspace.trim()) updateParams.workspace = params.workspace.trim();
      const payload = await ctx.services.client.sendReq(
        "agents.update", updateParams,
      );
      return { ok: true, payload: payload ?? {} };
    } catch (error) {
      return { ok: false, error: formatError(error) };
    }
  });

  registry.register("agent.delete", async (params, ctx) => {
    try {
      const agentId = typeof params.agentId === "string" ? params.agentId.trim() : "";
      if (!agentId) return { ok: false, error: "invalid_agent_id" };
      const deleteParams: Record<string, unknown> = { agentId };
      if (typeof params.deleteFiles === "boolean") deleteParams.deleteFiles = params.deleteFiles;
      const payload = await ctx.services.client.sendReq(
        "agents.delete", deleteParams,
      );
      return { ok: true, payload: payload ?? {} };
    } catch (error) {
      return { ok: false, error: formatError(error) };
    }
  });

  registry.register("agent.files.set", async (params, ctx) => {
    try {
      const agentId = typeof params.agentId === "string" ? params.agentId.trim() : "";
      const name = typeof params.name === "string" ? params.name.trim() : "";
      const content = typeof params.content === "string" ? params.content : "";
      if (!agentId) return { ok: false, error: "invalid_agent_id" };
      if (!name) return { ok: false, error: "invalid_file_name" };
      const payload = await ctx.services.client.sendReq(
        "agents.files.set", { agentId, name, content }, { sideEffect: true },
      );
      const obj = (payload ?? {}) as Record<string, unknown>;
      const file = (obj.file ?? payload) as unknown;
      return { ok: true, payload: { item: file ?? null, raw: payload } };
    } catch (error) {
      return { ok: false, error: formatError(error) };
    }
  });
};
