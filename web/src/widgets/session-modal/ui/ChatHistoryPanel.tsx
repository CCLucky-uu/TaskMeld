import { memo, ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { SessionHistoryItem } from "../../../entities/session";
import { MarkdownViewer } from "../../../shared/ui";
import { LiveToolEntry, MergedHistoryEntry } from "../model/session-modal-types";
import { predictMessageMinHeight, predictToolCardMinHeight } from "../model/message-height-predict";

type ChatHistoryPanelProps = {
  historyStatusText: string;
  historyViewportWidth: number;
  historyViewportHeight: number;
  historyScrollTop: number;
  mergedHistory: MergedHistoryEntry[];
  liveTools: LiveToolEntry[];
  isThinking: boolean;
  liveAssistantId: string;
  collapsedToolMap: Record<string, boolean>;
  collapsedToolOutputMap: Record<string, boolean>;
  onToggleToolCollapsed: (key: string) => void;
  onToggleToolOutputCollapsed: (key: string) => void;
  onVirtualStatsChange?: (stats: { rendered: number; total: number }) => void;
};

type VirtualRow = {
  key: string;
  estimatedHeight: number;
  render: () => ReactNode;
};

type PositionedRow = {
  key: string;
  render: () => ReactNode;
  top: number;
};

const ROW_GAP = 10;
const OVERSCAN_PX = 560;
const FALLBACK_VIEWPORT_HEIGHT = 640;
const THINKING_ESTIMATED_HEIGHT = 88;
const STATUS_ESTIMATED_HEIGHT = 26;
const monoClassName = "font-[JetBrains_Mono,monospace]";

const getHistoryItemKey = (item: SessionHistoryItem): string => `${item.id}-${item.ts ?? ""}`;

const estimatePlainMessageHeight = (text: string): number => {
  const lines = Math.max(1, text.split(/\n+/).length);
  return 36 + lines * 20;
};

function renderToolCard(
  key: string,
  entry: { toolName: string; commandText: string; outputText: string },
  toolCollapsed: boolean,
  toolOutputCollapsed: boolean,
  onToggleToolCollapsed: (key: string) => void,
  onToggleToolOutputCollapsed: (key: string) => void,
): ReactNode {
  return (
    <article className={`${toolCollapsed ? "w-fit min-w-[180px] max-w-[min(72%,640px)]" : "w-[min(92%,780px)]"} max-w-full min-w-0 justify-self-start border border-[rgba(142,163,179,0.14)] bg-[rgba(255,255,255,0.01)]`}>
      <button className="flex w-full items-center justify-between gap-[10px] border-0 border-b border-[rgba(142,163,179,0.12)] bg-transparent px-[10px] py-2 text-left text-xs text-[#93a6b5] hover:bg-[rgba(142,163,179,0.04)]" type="button" onClick={() => onToggleToolCollapsed(key)}>
        <span>tool {entry.toolName}</span>
        <span className="inline-flex items-center justify-center leading-none text-[#7890a1]" aria-hidden="true">
          <svg viewBox="0 0 12 12" width="12" height="12" focusable="false" className={toolCollapsed ? "" : "rotate-90"}>
            <path
              d="M4 2.5L7.5 6L4 9.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </button>
      {!toolCollapsed ? (
        <>
          <div className={`${monoClassName} max-h-[220px] overflow-auto border-b border-[rgba(142,163,179,0.12)] bg-[rgba(7,12,16,0.5)] px-[10px] py-2 text-[12.5px] leading-[1.45] whitespace-pre-wrap break-words text-[#d1dbe3]`} title={entry.commandText}>
            {entry.commandText}
          </div>
          <button className="flex w-full items-center justify-between gap-[10px] border-0 border-b border-[rgba(142,163,179,0.12)] bg-transparent px-[10px] py-2 text-left text-xs text-[#93a6b5] hover:bg-[rgba(142,163,179,0.04)]" type="button" onClick={() => onToggleToolOutputCollapsed(key)}>
            <span>Tool output {entry.toolName}</span>
            <span className="inline-flex items-center justify-center leading-none text-[#7890a1]" aria-hidden="true">
              <svg viewBox="0 0 12 12" width="12" height="12" focusable="false" className={toolOutputCollapsed ? "" : "rotate-90"}>
                <path
                  d="M4 2.5L7.5 6L4 9.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          </button>
          {!toolOutputCollapsed ? (
            <div className="max-h-[260px] overflow-auto bg-[rgba(7,12,16,0.5)] px-[10px] py-2">
              <p className="m-0 whitespace-pre-wrap break-words font-[JetBrains_Mono,monospace] text-[12.5px] leading-[1.45] text-[#b4c3cf]">{entry.outputText || "..."}</p>
            </div>
          ) : null}
        </>
      ) : null}
    </article>
  );
}

export const ChatHistoryPanel = memo(function ChatHistoryPanel({
  historyStatusText,
  historyViewportWidth,
  historyViewportHeight,
  historyScrollTop,
  mergedHistory,
  liveTools,
  isThinking,
  liveAssistantId,
  collapsedToolMap,
  collapsedToolOutputMap,
  onToggleToolCollapsed,
  onToggleToolOutputCollapsed,
  onVirtualStatsChange,
}: ChatHistoryPanelProps) {
  const { t } = useTranslation("session");
  const measuredHeightsRef = useRef<Map<string, number>>(new Map());
  const rowObserverRef = useRef<ResizeObserver | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [measureVersion, setMeasureVersion] = useState(0);

  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    rowObserverRef.current = new ResizeObserver((entries) => {
      let hasChanged = false;
      const map = measuredHeightsRef.current;
      for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index]!;
        const key = (entry.target as HTMLElement).dataset["rowKey"];
        if (!key) continue;
        const measuredHeight = Math.max(1, Math.ceil(entry.contentRect.height));
        const previous = map.get(key);
        if (previous === measuredHeight) continue;
        map.set(key, measuredHeight);
        hasChanged = true;
      }
      if (hasChanged) setMeasureVersion((value) => value + 1);
    });
    return () => {
      rowObserverRef.current?.disconnect();
      rowObserverRef.current = null;
    };
  }, []);

  const rows = useMemo<VirtualRow[]>(() => {
    if (historyStatusText) {
      return [
        {
          key: "status",
          estimatedHeight: STATUS_ESTIMATED_HEIGHT,
          render: () => <p className={`${monoClassName} m-0 text-xs text-[var(--muted)]`}>{historyStatusText}</p>,
        },
      ];
    }

    const nextRows: VirtualRow[] = [];

    for (let index = 0; index < mergedHistory.length; index += 1) {
      const entry = mergedHistory[index]!;
      if (entry.kind === "tool") {
        const key = entry.key;
        const toolCollapsed = collapsedToolMap[key] ?? true;
        const toolOutputCollapsed = collapsedToolOutputMap[key] ?? true;
        nextRows.push({
          key: `history-tool:${key}`,
          estimatedHeight:
            historyViewportWidth > 0
              ? predictToolCardMinHeight({
                  viewportWidth: historyViewportWidth,
                  commandText: entry.commandText,
                  outputText: entry.outputText,
                  toolCollapsed,
                  toolOutputCollapsed,
                })
              : 42,
          render: () =>
            renderToolCard(
              key,
              entry,
              toolCollapsed,
              toolOutputCollapsed,
              onToggleToolCollapsed,
              onToggleToolOutputCollapsed,
            ),
        });
        continue;
      }

      const item = entry.item;
      const key = getHistoryItemKey(item);
      const showStreamingCaret = item.role === "assistant" && item.id === liveAssistantId;
      const useMarkdownBubble = item.role === "assistant" || item.role === "user";
      const modelTag =
        item.role === "assistant" && item.model
          ? item.modelProvider
            ? `${item.modelProvider}/${item.model}`
            : item.model
          : "";
      const estimatedHeight =
        historyViewportWidth > 0 && useMarkdownBubble
          ? predictMessageMinHeight(item.text, { viewportWidth: historyViewportWidth })
          : estimatePlainMessageHeight(item.text);

      nextRows.push({
        key: `history-msg:${key}`,
        estimatedHeight,
        render: () => (
          <article className={`${item.role === "user" ? "justify-self-end border-[rgba(50,215,186,0.15)] bg-[rgba(50,215,186,0.08)]" : item.role === "assistant" ? "justify-self-start border-[var(--line)]" : item.role === "tool" ? "justify-self-stretch w-full border-[rgba(142,163,179,0.24)] bg-[linear-gradient(180deg,rgba(255,255,255,0.05)_0%,rgba(255,255,255,0.02)_100%)]" : "justify-self-start border-[var(--line)] border-dashed opacity-90"} min-w-0 max-w-full w-[min(92%,780px)] border bg-[#0f171d] px-[10px] py-2`}>
            <header className={`${monoClassName} mb-1.5 flex items-center justify-between gap-[10px] text-xs text-[var(--muted)] ${item.role === "tool" ? "-mx-[10px] -mt-2 mb-2 border-b border-[rgba(142,163,179,0.22)] bg-[rgba(255,255,255,0.03)] px-[10px] py-[7px]" : ""}`}>
              <span>{item.role}</span>
              <div className="inline-flex items-center gap-2">
                {modelTag ? <span>{modelTag}</span> : null}
                <span>{item.ts ? new Date(item.ts).toLocaleString("zh-CN", { hour12: false }) : "-"}</span>
              </div>
            </header>
            {useMarkdownBubble ? (
              // Markdown 容器需要允许收缩，否则内部 code block 的最小内容宽度会外溢到气泡外。
              <div className="min-w-0 max-w-full overflow-hidden">
                <MarkdownViewer content={item.text} />
              </div>
            ) : (
              <p className={item.role === "tool" ? "m-0 whitespace-pre-wrap break-words font-[JetBrains_Mono,monospace] text-[12.5px] text-[#c6d2dd]" : "m-0 whitespace-pre-wrap break-words text-[13px] leading-[1.45]"}>
                {item.text}
                {showStreamingCaret ? <span className="ml-0.5 inline-block h-[1em] w-[6px] animate-pulse align-[-0.12em] bg-[var(--live)]" aria-hidden="true" /> : null}
              </p>
            )}
          </article>
        ),
      });
    }

    for (let index = 0; index < liveTools.length; index += 1) {
      const entry = liveTools[index]!;
      const key = `live-tool:${entry.key}`;
      const toolCollapsed = collapsedToolMap[key] ?? true;
      const toolOutputCollapsed = collapsedToolOutputMap[key] ?? true;
      nextRows.push({
        key,
        estimatedHeight:
          historyViewportWidth > 0
            ? predictToolCardMinHeight({
                viewportWidth: historyViewportWidth,
                commandText: entry.commandText,
                outputText: entry.outputText,
                toolCollapsed,
                toolOutputCollapsed,
              })
            : 42,
        render: () =>
          renderToolCard(
            key,
            entry,
            toolCollapsed,
            toolOutputCollapsed,
            onToggleToolCollapsed,
            onToggleToolOutputCollapsed,
          ),
      });
    }

    if (isThinking) {
      nextRows.push({
        key: "live-thinking",
        estimatedHeight: THINKING_ESTIMATED_HEIGHT,
        render: () => (
          <article className="justify-self-start min-w-0 max-w-full w-[min(92%,780px)] border border-[var(--line)] bg-[#0f171d] px-[10px] py-2 opacity-92">
            <header className={`${monoClassName} mb-1.5 flex items-center justify-between gap-[10px] text-xs text-[var(--muted)]`}>
              <span>assistant</span>
              <div className="inline-flex items-center gap-2">
                <span>{t("thinking")}</span>
              </div>
            </header>
            <p className="m-0 whitespace-pre-wrap break-words text-[13px] leading-[1.45] text-[var(--muted)]">
              {t("thinking")}<span className="inline-block w-[0.6ch] animate-pulse text-center">.</span>
              <span className="inline-block w-[0.6ch] animate-pulse text-center [animation-delay:0.2s]">.</span>
              <span className="inline-block w-[0.6ch] animate-pulse text-center [animation-delay:0.4s]">.</span>
            </p>
          </article>
        ),
      });
    }

    return nextRows;
  }, [
    t,
    historyStatusText,
    mergedHistory,
    liveTools,
    isThinking,
    liveAssistantId,
    collapsedToolMap,
    collapsedToolOutputMap,
    onToggleToolCollapsed,
    onToggleToolOutputCollapsed,
    historyViewportWidth,
  ]);

  const { totalHeight, visibleRows } = useMemo(() => {
    const measured = measuredHeightsRef.current;
    const viewportHeight = historyViewportHeight > 0 ? historyViewportHeight : FALLBACK_VIEWPORT_HEIGHT;
    const startY = Math.max(0, historyScrollTop - OVERSCAN_PX);
    const endY = historyScrollTop + viewportHeight + OVERSCAN_PX;

    let cursor = 0;
    const tops: number[] = new Array(rows.length);
    const heights: number[] = new Array(rows.length);
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index]!;
      tops[index] = cursor;
      const rowHeight = measured.get(row.key) ?? row.estimatedHeight;
      heights[index] = rowHeight;
      cursor += rowHeight + ROW_GAP;
    }
    const listHeight = cursor > 0 ? cursor - ROW_GAP : 0;

    if (rows.length === 0) return { totalHeight: 0, visibleRows: [] as PositionedRow[] };

    let startIndex = 0;
    while (startIndex < rows.length) {
      const top = tops[startIndex]!;
      const height = heights[startIndex]!;
      if (top + height >= startY) break;
      startIndex += 1;
    }

    let endIndex = startIndex;
    while (endIndex < rows.length) {
      const top = tops[endIndex]!;
      if (top > endY) break;
      endIndex += 1;
    }

    const positioned: PositionedRow[] = [];
    for (let index = startIndex; index < endIndex; index += 1) {
      const row = rows[index]!;
      positioned.push({
        key: row.key,
        render: row.render,
        top: tops[index]!,
      });
    }

    return { totalHeight: listHeight, visibleRows: positioned };
  }, [rows, measureVersion, historyScrollTop, historyViewportHeight]);

  const visibleRowKeySignature = useMemo(
    () => visibleRows.map((row) => row.key).join("|"),
    [visibleRows],
  );

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const observer = rowObserverRef.current;
    if (!canvas || !observer) return;
    observer.disconnect();
    const nodes = canvas.querySelectorAll<HTMLDivElement>("[data-virtual-history-row][data-row-key]");
    nodes.forEach((node) => observer.observe(node));
  }, [visibleRowKeySignature]);

  useEffect(() => {
    onVirtualStatsChange?.({ rendered: visibleRows.length, total: rows.length });
  }, [onVirtualStatsChange, visibleRows.length, rows.length]);

  if (rows.length === 0) return null;

  return (
    <div ref={canvasRef} className="relative w-full" style={{ height: `${Math.max(totalHeight, 0)}px` }}>
      {visibleRows.map((row) => (
        <div
          key={row.key}
          className="absolute inset-x-0 grid content-start"
          data-virtual-history-row="true"
          data-row-key={row.key}
          style={{ transform: `translateY(${Math.round(row.top)}px)` }}
        >
          {row.render()}
        </div>
      ))}
    </div>
  );
});
