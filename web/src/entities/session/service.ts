import { SendMode, SessionHistoryItem, SessionItem } from "./types";
import { wsRequest } from "../../shared/ws-client";
import { mapSessions } from "./mapper";

type SessionListResponse = {
  items?: unknown;
};

type SessionSendResponse = {
  usedMethod?: string;
  usedParams?: Record<string, unknown>;
  model?: string | null;
  modelProvider?: string | null;
  api?: string | null;
};

type SessionHistoryResponse = {
  items?: unknown;
};

export async function fetchSessions(): Promise<SessionItem[]> {
  const data = await wsRequest<SessionListResponse>("session.list");
  return mapSessions(data.items);
}

export async function createSession(payload: Record<string, unknown>) {
  return wsRequest("session.create", payload);
}

export async function sendSessionMessage(params: {
  sessionId: string;
  message: string;
  mode: SendMode;
}): Promise<SessionSendResponse> {
  return wsRequest<SessionSendResponse>("session.send", { sessionId: params.sessionId, message: params.message, mode: params.mode });
}

const normalizeHistoryItems = (rawItems: unknown[]): SessionHistoryItem[] =>
  rawItems.flatMap((item, index) => {
    const obj = (item ?? {}) as Record<string, unknown>;
    const roleRaw = String(
      obj.role ??
        obj.senderRole ??
        obj.authorRole ??
        (obj.sender as Record<string, unknown> | undefined)?.role ??
        "unknown",
    ).toLowerCase();
    const role =
      roleRaw === "user" || roleRaw === "assistant" || roleRaw === "system"
        ? roleRaw
        : roleRaw === "toolresult" || roleRaw === "tool_result" || roleRaw === "tool"
          ? "tool"
          : "unknown";

    const tsCandidate = obj.ts ?? obj.time ?? obj.createdAt ?? obj.timestamp;
    let ts: string | null = null;
    if (typeof tsCandidate === "string" && tsCandidate.trim()) {
      ts = tsCandidate;
    } else if (typeof tsCandidate === "number" && Number.isFinite(tsCandidate)) {
      ts = new Date(tsCandidate).toISOString();
    }

    const model = typeof obj.model === "string" && obj.model.trim() ? obj.model.trim() : undefined;
    const modelProviderRaw = obj.modelProvider ?? obj.provider;
    const modelProvider =
      typeof modelProviderRaw === "string" && modelProviderRaw.trim() ? modelProviderRaw.trim() : undefined;
    const api = typeof obj.api === "string" && obj.api.trim() ? obj.api.trim() : undefined;
    const withModelMeta = (entry: SessionHistoryItem): SessionHistoryItem => {
      const next = { ...entry };
      if (model) next.model = model;
      if (modelProvider) next.modelProvider = modelProvider;
      if (api) next.api = api;
      return next;
    };

    const contentParts = Array.isArray(obj.content)
      ? obj.content.map((entry) => (entry ?? {}) as Record<string, unknown>)
      : null;

    if (roleRaw === "assistant" && contentParts && contentParts.length > 0) {
      const textParts = contentParts
        .filter((part) => String(part.type ?? "").toLowerCase() === "text")
        .map((part) => (typeof part.text === "string" ? part.text : ""))
        .filter((text) => text.trim());
      const toolCallParts = contentParts.filter((part) => String(part.type ?? "").toLowerCase() === "toolcall");

      if (toolCallParts.length > 0) {
        const out: SessionHistoryItem[] = [];
        const baseId = String(obj.id ?? obj.eventId ?? obj.seq ?? `${index}`);

        if (textParts.length > 0) {
          out.push(
            withModelMeta({
              id: `${baseId}:assistant`,
              role: "assistant",
              text: textParts.join("\n"),
              ts,
            }),
          );
        }

        toolCallParts.forEach((part, partIndex) => {
          const toolName = String(part.name ?? part.toolName ?? "tool").trim() || "tool";
          const toolCallIdRaw = part.id ?? part.toolCallId ?? part.tool_call_id ?? obj.toolCallId ?? obj.tool_call_id;
          const toolCallId = typeof toolCallIdRaw === "string" && toolCallIdRaw.trim() ? toolCallIdRaw.trim() : undefined;
          const argsRaw = part.arguments;
          const argsText =
            typeof argsRaw === "string"
              ? argsRaw
              : argsRaw && typeof argsRaw === "object"
                ? JSON.stringify(argsRaw, null, 2)
                : "";
          out.push({
            id: `${baseId}:toolcall:${partIndex}`,
            role: "tool",
            text: argsText ? `[toolCall] ${toolName}\n${argsText}` : `[toolCall] ${toolName}`,
            ts,
            toolName,
            toolCallId,
            toolEventType: "call",
            toolArgs:
              typeof argsRaw === "string" || (argsRaw && typeof argsRaw === "object")
                ? (argsRaw as Record<string, unknown> | string)
                : undefined,
          });
        });
        return out;
      }
    }

    const normalizedContentText = (() => {
      const contentRaw = obj.content;
      if (typeof contentRaw === "string" && contentRaw.trim()) {
        return contentRaw;
      }
      if (Array.isArray(contentRaw)) {
        const hasTextPart = contentRaw.some((entry) => {
          const part = (entry ?? {}) as Record<string, unknown>;
          return String(part.type ?? "").toLowerCase() === "text" && typeof part.text === "string" && part.text.trim();
        });

        const chunks = contentRaw
          .map((entry) => {
            const part = (entry ?? {}) as Record<string, unknown>;
            const type = String(part.type ?? "").toLowerCase();
            if (type === "text") {
              const t = part.text;
              return typeof t === "string" ? t : "";
            }
            if (type === "toolcall") {
              const name = String(part.name ?? "tool");
              const argsRaw = part.arguments;
              const argsText =
                argsRaw && typeof argsRaw === "object"
                  ? JSON.stringify(argsRaw, null, 2)
                  : typeof argsRaw === "string"
                    ? argsRaw
                    : "";
              if (!hasTextPart) {
                return argsText ? `[toolCall] ${name}\n${argsText}` : `[toolCall] ${name}`;
              }
              return argsText ? `[toolCall] ${name}\n${argsText}` : `[toolCall] ${name}`;
            }
            if (type === "toolresult") {
              const name = String(part.toolName ?? "tool");
              const text = typeof part.text === "string" ? part.text : "";
              return text ? `[toolResult:${name}] ${text}` : `[toolResult:${name}]`;
            }
            return "";
          })
          .filter(Boolean);
        if (chunks.length > 0) return chunks.join("\n");
      }

      const textCandidates: unknown[] = [
        obj.text,
        obj.message,
        (obj.delta as Record<string, unknown> | undefined)?.text,
        (obj.payload as Record<string, unknown> | undefined)?.text,
      ];
      const fallback = textCandidates.find((x) => typeof x === "string" && String(x).trim().length > 0);
      return typeof fallback === "string" ? fallback : "";
    })();

    if (!normalizedContentText.trim()) return [];

    const shouldTreatAsToolCall =
      roleRaw === "assistant" &&
      Array.isArray(obj.content) &&
      obj.content.length > 0 &&
      obj.content.every((entry) => {
        const part = (entry ?? {}) as Record<string, unknown>;
        return String(part.type ?? "").toLowerCase() === "toolcall";
      });

    const normalizedRole = shouldTreatAsToolCall ? "tool" : role;
    const isToolResult = roleRaw === "toolresult" || roleRaw === "tool_result";

    const toolName = (() => {
      if (normalizedRole !== "tool") return undefined;
      if (typeof obj.toolName === "string" && obj.toolName.trim()) return obj.toolName.trim();
      if (Array.isArray(obj.content)) {
        const first = (obj.content[0] ?? {}) as Record<string, unknown>;
        const nameRaw = first.name ?? first.toolName;
        if (typeof nameRaw === "string" && nameRaw.trim()) return nameRaw.trim();
      }
      const m1 = normalizedContentText.match(/^\[toolCall\]\s+([^\n]+)/i);
      if (m1?.[1]) return m1[1].trim();
      const m2 = normalizedContentText.match(/^\[toolResult:([^\]]+)\]/i);
      if (m2?.[1]) return m2[1].trim();
      return undefined;
    })();

    const toolCallId = (() => {
      if (normalizedRole !== "tool") return undefined;
      const raw = obj.toolCallId ?? obj.tool_call_id;
      return typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
    })();

    const toolEventType: SessionHistoryItem["toolEventType"] = shouldTreatAsToolCall
      ? "call"
      : isToolResult
        ? "result"
        : undefined;

    const toolArgs = (() => {
      if (!shouldTreatAsToolCall) return undefined;
      if (Array.isArray(obj.content) && obj.content.length > 0) {
        const first = (obj.content[0] ?? {}) as Record<string, unknown>;
        const argsRaw = first.arguments;
        if (typeof argsRaw === "string" || (argsRaw && typeof argsRaw === "object")) {
          return argsRaw as Record<string, unknown> | string;
        }
      }
      return undefined;
    })();

    const base: SessionHistoryItem = {
      id: String(obj.id ?? obj.eventId ?? obj.seq ?? `${index}`),
      role: normalizedRole,
      text: normalizedContentText,
      ts,
    };
    if (toolName) {
      base.toolName = toolName;
    }
    if (toolCallId) {
      base.toolCallId = toolCallId;
    }
    if (toolEventType) {
      base.toolEventType = toolEventType;
    }
    if (toolArgs) {
      base.toolArgs = toolArgs;
    }
    return [withModelMeta(base)];
  });

export async function fetchSessionHistory(params: {
  sessionId: string;
  limit?: number;
}): Promise<SessionHistoryItem[]> {
  const wsParams: Record<string, unknown> = { sessionId: params.sessionId };
  if (typeof params.limit === "number") wsParams.limit = Math.max(1, Math.floor(params.limit));
  const data = await wsRequest<SessionHistoryResponse>("session.history", wsParams);
  const source = Array.isArray(data.items) ? data.items : [];
  return normalizeHistoryItems(source);
}
