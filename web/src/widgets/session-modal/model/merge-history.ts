import { SessionHistoryItem } from "../../../entities/session";
import { MergedHistoryEntry } from "./session-modal-types";

export const mergeHistoryEntries = (history: SessionHistoryItem[]): MergedHistoryEntry[] => {
  const consumed = new Set<number>();
  const out: MergedHistoryEntry[] = [];

  for (let i = 0; i < history.length; i += 1) {
    if (consumed.has(i)) continue;
    const item = history[i];

    if (item.role !== "tool") {
      out.push({ kind: "message", item });
      continue;
    }

    if (item.toolEventType === "call") {
      let resultIndex = -1;
      for (let j = i + 1; j < history.length; j += 1) {
        if (consumed.has(j)) continue;
        const candidate = history[j];
        if (candidate.role !== "tool" || candidate.toolEventType !== "result") continue;
        const sameCallId = item.toolCallId && candidate.toolCallId && item.toolCallId === candidate.toolCallId;
        const sameName = item.toolName && candidate.toolName && item.toolName === candidate.toolName;
        if (sameCallId || sameName) {
          resultIndex = j;
          break;
        }
      }
      if (resultIndex >= 0) {
        const result = history[resultIndex];
        consumed.add(resultIndex);
        consumed.add(i);
        const commandText = (() => {
          const args = item.toolArgs;
          if (typeof args === "string" && args.trim()) return args.trim();
          if (args && typeof args === "object") {
            const obj = args as Record<string, unknown>;
            if (typeof obj.command === "string" && obj.command.trim()) return obj.command.trim();
            if (typeof obj.path === "string" && obj.path.trim()) return obj.path.trim();
            return JSON.stringify(obj);
          }
          return "-";
        })();
        out.push({
          kind: "tool",
          key: item.toolCallId ?? `${item.id}-${item.ts ?? ""}`,
          toolName: item.toolName ?? result.toolName ?? "tool",
          commandText,
          outputText: result.text,
          ts: result.ts ?? item.ts,
        });
      }
      continue;
    }

    if (item.toolEventType === "result" || !item.toolEventType) {
      consumed.add(i);
      out.push({
        kind: "tool",
        key: item.toolCallId ?? `${item.id}-${item.ts ?? ""}`,
        toolName: item.toolName ?? "tool",
        commandText: "-",
        outputText: item.text,
        ts: item.ts,
      });
    }
  }

  return out;
};
