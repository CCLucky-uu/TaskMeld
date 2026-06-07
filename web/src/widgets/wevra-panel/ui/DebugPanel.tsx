import { useEffect, useRef, useState, useCallback } from "react";
import { debugBus, type DebugEvent } from "../lib/debug-bus";

type Entry = { id: number; event: DebugEvent; ts: number };
let entryId = 0;

export function DebugPanel({ onClose }: { onClose: () => void }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return debugBus.subscribe((event) => {
      setEntries((prev) => [...prev, { id: ++entryId, event, ts: Date.now() }]);
    });
  }, []);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries, autoScroll]);

  const toggleExpand = useCallback((id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clear = useCallback(() => setEntries([]), []);

  return (
    <div className="flex flex-col h-full border-l border-(--line) bg-(--bg) w-[420px] min-w-[320px]">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-(--line) shrink-0 font-mono">
        <span className="text-xs font-semibold text-(--muted)">DEBUG</span>
        <div className="flex gap-2">
          <button
            onClick={clear}
            className="text-xs text-(--muted) hover:opacity-80 appearance-none border-none outline-none bg-transparent cursor-pointer"
          >
            Clear
          </button>
          <button
            onClick={onClose}
            className="text-xs text-(--muted) hover:opacity-80 appearance-none border-none outline-none bg-transparent cursor-pointer"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Entries */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto text-xs font-mono">
        {entries.length === 0 && <div className="p-4 text-(--muted) text-center">等待事件...</div>}
        {entries.map((entry) => (
          <div key={entry.id} className="border-b border-(--line)">
            <button
              onClick={() => toggleExpand(entry.id)}
              className="w-full text-left px-3 py-1.5 hover:bg-(--panel-2) flex items-center gap-2 appearance-none border-none outline-none bg-transparent text-(--text) cursor-pointer"
            >
              <TypeBadge type={entry.event.type} />
              <span className="text-(--muted)">{formatTime(entry.ts)}</span>
              <span className="text-(--muted) truncate flex-1">{summarize(entry.event)}</span>
            </button>
            {expanded.has(entry.id) && (
              <pre className="px-3 py-2 bg-(--panel-2) text-(--text) whitespace-pre-wrap break-all overflow-x-auto max-h-[400px] overflow-y-auto text-[11px] leading-relaxed">
                {JSON.stringify(entry.event.data, null, 2)}
              </pre>
            )}
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-3 py-1.5 border-t border-(--line) shrink-0">
        <label className="flex items-center gap-1.5 text-xs text-(--muted) cursor-pointer">
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
            className="accent-(--live)"
          />
          Auto-scroll
        </label>
        <span className="text-xs text-(--muted)">{entries.length} events</span>
      </div>
    </div>
  );
}

function TypeBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    request: "bg-blue-500/20 text-blue-400",
    stream_chunk: "bg-yellow-500/20 text-yellow-400",
    response: "bg-green-500/20 text-green-400",
    error: "bg-red-500/20 text-red-400",
  };
  return (
    <span
      className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${colors[type] ?? "bg-gray-500/20 text-gray-400"}`}
    >
      {type.toUpperCase()}
    </span>
  );
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}:${d.getSeconds().toString().padStart(2, "0")}.${d.getMilliseconds().toString().padStart(3, "0")}`;
}

function summarize(event: DebugEvent): string {
  switch (event.type) {
    case "request": {
      const raw = event.data.raw as Record<string, unknown> | undefined;
      const msgCount = (raw?.messages as unknown[])?.length ?? 0;
      const toolCount = (raw?.tools as unknown[])?.length ?? 0;
      return `${msgCount} messages, ${toolCount} tools`;
    }
    case "stream_chunk": {
      const raw = event.data.raw;
      const text = typeof raw === "string" ? raw : JSON.stringify(raw);
      return text.slice(0, 80);
    }
    case "response":
      return `finishReason=${(event.data.parsed as Record<string, unknown>)?.finishReason ?? "?"}`;
    case "error":
      return event.data.message?.slice(0, 80) ?? "";
    default:
      return "";
  }
}
