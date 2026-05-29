export type SessionItem = {
  id: string;
  title: string;
};

export type SendMode = "auto" | "chat" | "sessions";

export type SessionHistoryItem = {
  id: string;
  role: "user" | "assistant" | "system" | "tool" | "unknown";
  text: string;
  ts: string | null;
  model?: string;
  modelProvider?: string;
  api?: string;
  toolName?: string;
  toolCallId?: string;
  toolEventType?: "call" | "result";
  toolArgs?: Record<string, unknown> | string;
};
