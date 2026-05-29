import type { PipelineRegistry } from "../app/pipeline-registry";
import type { NormalizedSession } from "../utils/session";
import { ensureGatewayReadyForReadonly } from "./gateway-read-helpers";

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : null;

const readSessionActivityMs = (raw: Record<string, unknown>): number | null => {
  const candidates = [raw.updatedAt, raw.endedAt, raw.startedAt, raw.timestamp, raw.ts];
  let best: number | null = null;
  for (const candidate of candidates) {
    const asNumber = typeof candidate === "number" && Number.isFinite(candidate) ? candidate : null;
    const asDate = typeof candidate === "string" && candidate.trim() ? Date.parse(candidate) : Number.NaN;
    const ms = asNumber ?? (Number.isFinite(asDate) ? asDate : null);
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
  const directKeys = [raw.agentId, raw.agent_id, raw.executorAgentId, raw.ownerAgentId];
  for (const value of directKeys) {
    if (typeof value === "string" && value.trim()) out.add(value.trim());
  }
  return [...out];
};

export type AgentListItem = {
  id: string | null;
  raw: unknown;
  lastActiveAtMs: number | null;
  lastActiveAt: string | null;
};

export type AgentService = {
  listAgents: () => Promise<AgentListItem[]>;
};

export const createAgentService = (app: PipelineRegistry): AgentService => {
  const listAgents = async (): Promise<AgentListItem[]> => {
    await ensureGatewayReadyForReadonly(app);
    const payload = await app.gateway.client.sendReq("agents.list");
    const rawItems = app.gateway.pickArray(payload);

    // 会话活动时间优先尝试刷新；刷新失败时回退缓存，保证只读查询可用性。
    let sessionItems: NormalizedSession[] = app.gateway.getSessionCache();
    try {
      const refreshed = await app.gateway.refreshSessionsFromGateway();
      sessionItems = refreshed.items;
    } catch {
      // 只读查询容错：会话刷新失败不应阻断 agents.list 输出。
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

    return rawItems.map((item) => {
      const obj = asRecord(item);
      const agentId = obj ? String(obj.id ?? obj.name ?? obj.key ?? "").trim() || null : null;
      const activeMs = agentId ? (lastActiveByAgentId.get(agentId) ?? null) : null;
      return {
        id: agentId,
        raw: item,
        lastActiveAtMs: activeMs,
        lastActiveAt: activeMs ? new Date(activeMs).toISOString() : null,
      };
    });
  };

  return {
    listAgents,
  };
};
