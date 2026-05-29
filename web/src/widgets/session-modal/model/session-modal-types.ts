import { SessionHistoryItem } from "../../../entities/session";

export type AssistantStreamPatch =
  | { kind: "assistant-text"; text: string }
  | { kind: "lifecycle-start" }
  | { kind: "lifecycle-end" };

export type LiveToolEntry = {
  key: string;
  toolName: string;
  commandText: string;
  outputText: string;
  ts: string | null;
};

export type ToolStreamPatch =
  | { kind: "tool-start"; key: string; toolName: string; commandText: string; ts: string | null }
  | { kind: "tool-output"; key: string; toolName: string; outputText: string; ts: string | null }
  | { kind: "tool-end"; key: string; toolName: string; outputText: string; ts: string | null };

export type MergedHistoryEntry =
  | { kind: "message"; item: SessionHistoryItem }
  | { kind: "tool"; key: string; toolName: string; commandText: string; outputText: string; ts: string | null };
