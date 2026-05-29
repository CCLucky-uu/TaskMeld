import { GatewayFramePayload } from "../../../shared/realtime/gateway-events";
import { AssistantStreamPatch, ToolStreamPatch } from "./session-modal-types";

export const readAssistantStreamPatch = (
  frame: GatewayFramePayload,
  selectedSessionId: string,
): AssistantStreamPatch | null => {
  if (frame.type !== "event") return null;
  const payload = (frame.payload ?? {}) as Record<string, unknown>;
  const sessionKey = String(payload.sessionKey ?? payload.sessionId ?? payload.key ?? "").trim();
  if (!sessionKey || sessionKey !== selectedSessionId) return null;

  const stream = String(payload.stream ?? "").toLowerCase();
  const data = (payload.data ?? {}) as Record<string, unknown>;

  if (stream === "lifecycle") {
    const phase = String(data.phase ?? "").toLowerCase();
    if (phase === "start") return { kind: "lifecycle-start" };
    if (phase === "end") return { kind: "lifecycle-end" };
  }

  if (stream === "assistant") {
    const text = typeof data.text === "string" ? data.text : "";
    if (text.trim()) return { kind: "assistant-text", text };
  }

  const delta = (payload.delta ?? {}) as Record<string, unknown>;
  const role = String(payload.role ?? data.role ?? delta.role ?? "").toLowerCase();
  const directTextCandidates: unknown[] = [delta.text, payload.text, data.text];
  const directText = directTextCandidates.find((entry) => typeof entry === "string" && String(entry).trim());
  if (role === "assistant" && typeof directText === "string") {
    return { kind: "assistant-text", text: directText };
  }

  return null;
};

export const mergeAssistantText = (prev: string, incoming: string): string => {
  if (!prev) return incoming;
  if (!incoming) return prev;
  if (incoming.startsWith(prev)) return incoming;
  if (prev.endsWith(incoming)) return prev;
  return `${prev}${incoming}`;
};

export const readToolStreamPatch = (frame: GatewayFramePayload, selectedSessionId: string): ToolStreamPatch | null => {
  if (frame.type !== "event") return null;
  if (frame.event !== "agent" && frame.event !== "session.tool") return null;
  const payload = (frame.payload ?? {}) as Record<string, unknown>;
  const sessionKey = String(payload.sessionKey ?? payload.sessionId ?? payload.key ?? "").trim();
  if (!sessionKey || sessionKey !== selectedSessionId) return null;
  const stream = String(payload.stream ?? "").toLowerCase();
  if (stream !== "tool" && stream !== "command_output") return null;

  const data = (payload.data ?? {}) as Record<string, unknown>;
  const phase = String(data.phase ?? "").toLowerCase();
  const toolName = String(data.name ?? data.toolName ?? "tool").trim() || "tool";
  const key = String(data.toolCallId ?? data.itemId ?? `${toolName}:${Date.now()}`).trim();
  const ts = new Date().toISOString();

  const commandText = (() => {
    const candidates: unknown[] = [data.arguments, data.args, data.input, data.command, data.path, data.title];
    const picked = candidates.find((entry) => typeof entry === "string" || (entry && typeof entry === "object"));
    if (typeof picked === "string" && picked.trim()) return picked.trim();
    if (picked && typeof picked === "object") return JSON.stringify(picked);
    return "-";
  })();

  const outputText = (() => {
    const candidates: unknown[] = [
      data.output,
      data.text,
      data.result,
      data.message,
      data.meta,
      data.stdout,
      data.stderr,
    ];
    const picked = candidates.find((entry) => typeof entry === "string" || (entry && typeof entry === "object"));
    if (typeof picked === "string" && picked.trim()) return picked.trim();
    if (picked && typeof picked === "object") return JSON.stringify(picked);
    return "";
  })();

  if (stream === "command_output") {
    if (phase === "delta" || phase === "update") {
      return { kind: "tool-output", key, toolName, outputText, ts };
    }
    if (phase === "end" || phase === "result") {
      return { kind: "tool-end", key, toolName, outputText, ts };
    }
    return outputText ? { kind: "tool-output", key, toolName, outputText, ts } : null;
  }

  if (phase === "start") {
    return { kind: "tool-start", key, toolName, commandText, ts };
  }
  if (phase === "result") {
    return { kind: "tool-output", key, toolName, outputText, ts };
  }
  if (phase === "update") {
    return outputText ? { kind: "tool-output", key, toolName, outputText, ts } : null;
  }
  if (phase === "end") {
    return { kind: "tool-end", key, toolName, outputText, ts };
  }
  return null;
};
