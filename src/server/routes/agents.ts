import type { Router } from "../types.js";
import type { NormalizedSession } from "../../utils/session.js";

type AgentServices = {
  client: {
    sendReq: (
      method: string,
      params?: Record<string, unknown>,
      opts?: { sideEffect?: boolean },
    ) => Promise<unknown>;
  };
  pickArray: (payload: unknown) => unknown[];
  getSessionCache: () => NormalizedSession[];
  refreshSessionsFromGateway: () => Promise<{ items: NormalizedSession[] }>;
};

const asRecord = (
  value: unknown,
): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

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

const readSessionActivityMs = (
  raw: Record<string, unknown>,
): number | null => {
  const candidates = [
    raw.updatedAt,
    raw.endedAt,
    raw.startedAt,
    raw.timestamp,
    raw.ts,
  ];
  let best: number | null = null;
  for (const candidate of candidates) {
    const ms = toEpochMs(candidate);
    if (ms === null) continue;
    if (best === null || ms > best) best = ms;
  }
  return best;
};

const inferAgentIdsFromSession = (session: NormalizedSession): string[] => {
  const out = new Set<string>();
  const id = session.id.trim();
  if (id) {
    const match = id.match(/^agent:([^:]+):/i);
    if (match?.[1]) out.add(match[1]);
  }
  const raw = session.raw;
  const directKeys = [
    raw.agentId,
    raw.agent_id,
    raw.executorAgentId,
    raw.ownerAgentId,
  ];
  for (const value of directKeys) {
    if (typeof value === "string" && value.trim()) out.add(value.trim());
  }
  return [...out];
};

export const registerAgentsRoutes = (router: Router): void => {
  router.register("GET", "/api/agents", async (ctx) => {
    const services = ctx.services as AgentServices;
    try {
      const payload = await services.client.sendReq("agents.list");
      const rawItems = services.pickArray(payload);
      let sessionItems: NormalizedSession[] = services.getSessionCache();
      try {
        const refreshed = await services.refreshSessionsFromGateway();
        sessionItems = refreshed.items;
      } catch {
        // 即使 session 列表刷新临时失败，仍保持 /api/agents 可用
      }

      const lastActiveByAgentId = new Map<string, number>();
      for (const session of sessionItems) {
        const activityMs = readSessionActivityMs(session.raw);
        if (activityMs === null) continue;
        const agentIds = inferAgentIdsFromSession(session);
        for (const agentId of agentIds) {
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
          const activeMs = agentId
            ? (lastActiveByAgentId.get(agentId) ?? null)
            : null;
          return {
            ...obj,
            lastActiveAtMs: activeMs,
            lastActiveAt: activeMs ? new Date(activeMs).toISOString() : null,
          };
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

      ctx.sendJson(200, { items, raw: payload });
    } catch (error) {
      ctx.sendJson(503, { error: String(error) });
    }
  });

  router.register("GET", "/api/agents/:agentId/files", async (ctx) => {
    const services = ctx.services as AgentServices;
    try {
      const agentId = ctx.params.agentId;
      if (!agentId) {
        ctx.sendJson(400, { error: "invalid_agent_id" });
        return;
      }
      const payload = await services.client.sendReq("agents.files.list", {
        agentId,
      });
      const obj = (payload ?? {}) as Record<string, unknown>;
      const files = Array.isArray(obj.files)
        ? obj.files
        : services.pickArray(payload);
      ctx.sendJson(200, { items: files, raw: payload });
    } catch (error) {
      ctx.sendJson(503, { error: String(error) });
    }
  });

  router.register("GET", "/api/agents/:agentId/files/*name", async (ctx) => {
    const services = ctx.services as AgentServices;
    try {
      const agentId = ctx.params.agentId;
      const name = ctx.params.name;
      if (!agentId) {
        ctx.sendJson(400, { error: "invalid_agent_id" });
        return;
      }
      if (!name) {
        ctx.sendJson(400, { error: "invalid_file_name" });
        return;
      }
      const payload = await services.client.sendReq("agents.files.get", {
        agentId,
        name,
      });
      const obj = (payload ?? {}) as Record<string, unknown>;
      const file = (obj.file ?? payload) as unknown;
      ctx.sendJson(200, { item: file ?? null, raw: payload });
    } catch (error) {
      ctx.sendJson(503, { error: String(error) });
    }
  });

  router.register(
    "POST",
    "/api/agents/:agentId/files/*name",
    async (ctx) => {
      const services = ctx.services as AgentServices;
      try {
        const agentId = ctx.params.agentId;
        const name = ctx.params.name;
        if (!agentId) {
          ctx.sendJson(400, { error: "invalid_agent_id" });
          return;
        }
        if (!name) {
          ctx.sendJson(400, { error: "invalid_file_name" });
          return;
        }
        const body = await ctx.readBody();
        const content = typeof body.content === "string" ? body.content : "";
        const payload = await services.client.sendReq(
          "agents.files.set",
          { agentId, name, content },
          { sideEffect: true },
        );
        const obj = (payload ?? {}) as Record<string, unknown>;
        const file = (obj.file ?? payload) as unknown;
        ctx.sendJson(200, { item: file ?? null, raw: payload });
      } catch (error) {
        ctx.sendJson(503, { error: String(error) });
      }
    },
  );
};
