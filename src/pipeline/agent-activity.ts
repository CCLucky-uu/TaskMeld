import type { GatewayEventFrame, GatewayFrame } from "../gateway";

type TimelineLevel = "info" | "warn" | "error";

type AgentActivityTrackerDeps = {
  pushTimeline: (text: string, level?: TimelineLevel, detail?: unknown) => void;
  resolveAgentBySessionId: (sessionId: string) => string | null;
};

const SESSION_AGENT_PATTERN = /^agent:([^:]+):/i;

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

const inferLifecycle = (payload: unknown): "start" | "end" | "unknown" => {
  const marker = (findStringByKeys(payload, ["status", "state", "phase", "event", "type", "kind"]) ?? "").toLowerCase();
  if (!marker) return "unknown";
  if (
    marker.includes("start") ||
    marker.includes("running") ||
    marker.includes("in_progress") ||
    marker.includes("processing") ||
    marker.includes("stream")
  ) {
    return "start";
  }
  if (
    marker.includes("done") ||
    marker.includes("finish") ||
    marker.includes("complete") ||
    marker.includes("success") ||
    marker.includes("failed") ||
    marker.includes("error") ||
    marker.includes("idle") ||
    marker.includes("stop")
  ) {
    return "end";
  }
  return "unknown";
};

export const createAgentActivityTracker = (deps: AgentActivityTrackerDeps) => {
  const activeAgents = new Set<string>();

  const toActivityKey = (agentId: string, runId: string | null) => `${runId ?? "global"}::${agentId}`;
  const runLabel = (runId: string | null) => (runId ? `run:${runId}` : "run:unknown");

  const pushLifecycle = (
    agentId: string,
    runId: string | null,
    lifecycle: "start" | "end",
    source: string,
    frame: GatewayEventFrame,
  ) => {
    const detail = {
      source,
      agentId,
      runId,
      lifecycle,
      seq: frame.seq ?? null,
      stateVersion: frame.stateVersion ?? null,
    };
    if (lifecycle === "start") {
      deps.pushTimeline(`Agent ${agentId} started (${runLabel(runId)}, ${source})`, "info", detail);
      return;
    }
    deps.pushTimeline(`Agent ${agentId} finished (${runLabel(runId)}, ${source})`, "info", detail);
  };

  const refreshAgentActivity = (agentId: string, source: string, runId: string | null, frame: GatewayEventFrame) => {
    const activityKey = toActivityKey(agentId, runId);
    if (!activeAgents.has(activityKey)) {
      activeAgents.add(activityKey);
      pushLifecycle(agentId, runId, "start", source, frame);
    }
  };

  const endAgentActivity = (agentId: string, source: string, runId: string | null, frame: GatewayEventFrame) => {
    const endAllByAgent = (labelRunId: string | null) => {
      const keys = [...activeAgents].filter((key) => key.endsWith(`::${agentId}`));
      for (const key of keys) {
        activeAgents.delete(key);
      }
      if (keys.length > 0) {
        pushLifecycle(agentId, labelRunId, "end", source, frame);
      }
    };

    if (!runId) {
      endAllByAgent(null);
      return;
    }
    const activityKey = toActivityKey(agentId, runId);
    if (activeAgents.has(activityKey)) {
      activeAgents.delete(activityKey);
      pushLifecycle(agentId, runId, "end", source, frame);
      return;
    }
    // Some gateways emit different runId formats between start/end events.
    // Fallback: end all active runs for this agent to avoid stale busy state.
    endAllByAgent(runId);
  };

  const normalizeAgentId = (candidate: string | null): string | null => {
    if (!candidate) return null;
    const trimmed = candidate.trim();
    return trimmed || null;
  };

  const inferAgentIdFromSessionId = (sessionId: string): string | null => {
    const mapped = deps.resolveAgentBySessionId(sessionId);
    const normalizedMapped = normalizeAgentId(mapped);
    if (normalizedMapped) return normalizedMapped;
    const matched = sessionId.match(SESSION_AGENT_PATTERN);
    if (!matched) return null;
    return normalizeAgentId(matched[1]);
  };

  const resolveAgentFromPayload = (payload: unknown): string | null => {
    // For gateway agent/chat events, sessionKey is the stable source of agent identity.
    // Do not trust generic payload agentId/runId fields (they may be per-run UUIDs).
    const sessionId = findStringByKeys(payload, ["sessionKey", "sessionId", "key", "session"]);
    if (!sessionId) return null;
    return inferAgentIdFromSessionId(sessionId);
  };

  const handleFrame = (frame: GatewayFrame) => {
    if (frame.type !== "event") return;
    const eventFrame = frame as GatewayEventFrame;
    const payload = eventFrame.payload as Record<string, unknown> | undefined;
    if (!payload) return;

    const agentId = resolveAgentFromPayload(payload);
    if (!agentId) return;
    const runIdRaw = payload.runId;
    const runId = typeof runIdRaw === "string" && runIdRaw.trim() ? runIdRaw.trim() : null;

    if (eventFrame.event === "agent") {
      const stream = typeof payload.stream === "string" ? payload.stream : "";
      if (stream !== "lifecycle") return;
      const lifecycle = inferLifecycle(payload.data);
      if (lifecycle === "start") {
        refreshAgentActivity(agentId, "event:agent.lifecycle", runId, eventFrame);
        return;
      }
      if (lifecycle === "end") {
        endAgentActivity(agentId, "event:agent.lifecycle", runId, eventFrame);
      }
      return;
    }

    if (eventFrame.event === "sessions.changed") {
      const phase = findStringByKeys(payload, ["phase"])?.toLowerCase() ?? "";
      const status = findStringByKeys(payload, ["status"])?.toLowerCase() ?? "";
      const isStart = phase === "start" || status === "running";
      const isEnd =
        phase === "end" ||
        status === "done" ||
        status === "idle" ||
        status === "completed" ||
        status === "stopped" ||
        status === "success" ||
        status === "failed";
      if (isStart) {
        refreshAgentActivity(agentId, "event:sessions.changed", runId, eventFrame);
        return;
      }
      if (isEnd) {
        endAgentActivity(agentId, "event:sessions.changed", runId, eventFrame);
      }
      return;
    }

    if (eventFrame.event === "chat") {
      const state = findStringByKeys(payload, ["state"])?.toLowerCase() ?? "";
      if (state === "final" || state === "done" || state === "end" || state === "completed") {
        endAgentActivity(agentId, "event:chat.final", runId, eventFrame);
      }
    }
  };

  const dispose = () => {
    activeAgents.clear();
  };

  return {
    handleFrame,
    dispose,
  };
};
