import type { GatewayFrame } from "../gateway";

type TimelineLevel = "info" | "warn" | "error";

type ToolActivityLoggerDeps = {
  pushTimeline: (text: string, level?: TimelineLevel) => void;
  resolveAgentBySessionId: (sessionId: string) => string | null;
};

const SESSION_AGENT_PATTERN = /^agent:([^:]+):/i;
const MAX_SEEN_KEYS = 500;

const findStringByKeys = (value: unknown, keys: string[], depth = 0): string | null => {
  if (depth > 5 || value === null || value === undefined) return null;
  if (typeof value === "string") return value.trim() || null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findStringByKeys(item, keys, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const raw = record[key];
    if (typeof raw === "string" && raw.trim()) return raw.trim();
  }
  for (const item of Object.values(record)) {
    const found = findStringByKeys(item, keys, depth + 1);
    if (found) return found;
  }
  return null;
};

export const createToolActivityLogger = (deps: ToolActivityLoggerDeps) => {
  const seenOrder: string[] = [];
  const seenSet = new Set<string>();

  const markSeen = (key: string) => {
    if (seenSet.has(key)) return false;
    seenSet.add(key);
    seenOrder.push(key);
    if (seenOrder.length > MAX_SEEN_KEYS) {
      const oldest = seenOrder.shift();
      if (oldest) seenSet.delete(oldest);
    }
    return true;
  };

  const inferAgentId = (sessionKey: string | null): string | null => {
    if (!sessionKey) return null;
    const mapped = deps.resolveAgentBySessionId(sessionKey);
    if (mapped && mapped.trim()) return mapped.trim();
    const match = sessionKey.match(SESSION_AGENT_PATTERN);
    return match?.[1] ?? null;
  };

  const handleFrame = (frame: GatewayFrame) => {
    if (frame.type !== "event") return;
    if (frame.event !== "agent" && frame.event !== "session.tool") return;
    const payload = frame.payload as Record<string, unknown> | undefined;
    if (!payload) return;
    if (payload.stream !== "tool") return;

    const data = (payload.data ?? {}) as Record<string, unknown>;
    const phase = typeof data.phase === "string" ? data.phase.trim() : "";
    const toolName = typeof data.name === "string" && data.name.trim() ? data.name.trim() : "unknown_tool";
    const toolCallId = typeof data.toolCallId === "string" ? data.toolCallId.trim() : "";
    const runId = typeof payload.runId === "string" && payload.runId.trim() ? payload.runId.trim() : "unknown";
    const seq = typeof payload.seq === "number" ? String(payload.seq) : "n/a";
    const sessionKey = findStringByKeys(payload, ["sessionKey", "sessionId", "key", "session"]);
    const agentId = inferAgentId(sessionKey) ?? "unknown";

    const dedupeKey = `${runId}|${toolCallId || toolName}|${phase}|${seq}`;
    if (!markSeen(dedupeKey)) return;

    if (phase === "start") {
      deps.pushTimeline(`Agent ${agentId} 工具开始: ${toolName} (run:${runId})`);
      return;
    }
    if (phase === "result" || phase === "end") {
      const isError = data.isError === true;
      deps.pushTimeline(
        `Agent ${agentId} 工具结束: ${toolName} (run:${runId}${isError ? ", error" : ""})`,
        isError ? "warn" : "info",
      );
      return;
    }
    deps.pushTimeline(`Agent ${agentId} 工具事件: ${toolName}/${phase || "unknown"} (run:${runId})`);
  };

  return {
    handleFrame,
  };
};
