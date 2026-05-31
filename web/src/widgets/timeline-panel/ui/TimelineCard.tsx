import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { TimelineItem } from "../../../entities/timeline";
import { CloseIcon } from "../../../shared/ui";
import { panelHeaderClassName } from "../../../shared/ui/panelClasses";
import {
  drawerCloseClassName,
  modalFrameBaseClassName,
  modalFrameClosedClassName,
  modalFrameOpenClassName,
  modalMaskBaseClassName,
  modalMaskClosedClassName,
  modalMaskOpenClassName,
  modalPanelBaseClassName,
} from "../../../shared/ui/surfaceClassNames";

type TimelineCardProps = {
  timeline: TimelineItem[];
  onOpenRunLog?: () => void;
};

type CollapsedTimelineEntry = {
  id: string;
  ts: string;
  level: "info" | "warn" | "error";
  text: string;
  detail: string;
  kind: "collapsed";
};

type DisplayTimelineEntry = (TimelineItem & { kind: "item" }) | CollapsedTimelineEntry;

const monoClassName = "font-[JetBrains_Mono,monospace]";
const actionButtonClassName =
  "mt-0 cursor-pointer border border-[var(--live-25)] bg-transparent px-[10px] py-2 font-semibold text-[var(--live)] hover:bg-[rgba(50,215,186,0.1)]";
const levelTagBaseClassName = "inline-flex w-fit items-center rounded-none px-2 py-[2px] text-xs uppercase";
const levelTagToneClassName: Record<"info" | "warn" | "error", string> = {
  info: "bg-[rgba(142,163,179,0.2)] text-[#a5b9c8]",
  warn: "bg-[rgba(255,184,77,0.16)] text-[var(--warn)]",
  error: "bg-[rgba(255,107,107,0.16)] text-[var(--bad)]",
};

const AGENT_START_PATTERN = /^Agent\s+([^\s]+)\s+开始工作\b/;
const AGENT_END_PATTERN = /^Agent\s+([^\s]+)\s+结束工作\b/;
const AGENT_DETAIL_PATTERN = /^Agent\s+([^\s]+)\s+(?!开始工作\b|结束工作\b).+/;
const SESSION_AGENT_PATTERN = /^agent:([^:]+):/i;

type TimelineAgentMeta = {
  agentId: string | null;
  runId: string | null;
  kind: "start" | "end" | "detail" | "other";
};

type DisplayLifecycleInfo = {
  text: string;
  dedupeKey: string;
} | null;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const getString = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);

const getAgentIdFromSessionKey = (sessionKey: string | null) => {
  if (!sessionKey) return null;
  const matched = sessionKey.match(SESSION_AGENT_PATTERN);
  return matched?.[1]?.trim() || null;
};

const stringifyTimelineDetail = (item: Pick<TimelineItem, "text" | "detail">) => {
  if (item.detail === undefined) return item.text;
  if (typeof item.detail === "string") return item.detail;
  try {
    return JSON.stringify(item.detail, null, 2);
  } catch {
    return String(item.detail);
  }
};

const buildCollapsedEntry = (
  agentId: string,
  items: TimelineItem[],
  suffixKey: string,
  idSuffix: string,
  t: TFunction<"timeline">,
): CollapsedTimelineEntry => ({
  id: `collapsed:${agentId}:${idSuffix}`,
  ts: items[0]?.ts ?? "-",
  level: items.some((entry) => entry.level === "error")
    ? "error"
    : items.some((entry) => entry.level === "warn")
      ? "warn"
      : "info",
  text: t("agentDetail", { suffix: t(suffixKey), count: items.length }),
  detail: items.map((entry) => `[${entry.ts}] ${entry.text}\n${stringifyTimelineDetail(entry)}`).join("\n\n"),
  kind: "collapsed",
});

const inferLifecycleKind = (payload: Record<string, unknown>) => {
  const stream = getString(payload.stream)?.toLowerCase();
  const data = isRecord(payload.data) ? payload.data : null;
  const phase = getString(data?.phase)?.toLowerCase();
  const state = getString(data?.state)?.toLowerCase();
  const status = getString(data?.status)?.toLowerCase();
  const marker = phase ?? state ?? status ?? null;

  if (stream === "lifecycle") {
    if (marker === "start" || marker === "running" || marker === "in_progress") return "start";
    if (
      marker === "end" ||
      marker === "done" ||
      marker === "completed" ||
      marker === "success" ||
      marker === "failed" ||
      marker === "idle"
    ) {
      return "end";
    }
  }
  return "detail";
};

const getTimelineAgentMeta = (item: TimelineItem): TimelineAgentMeta => {
  const startMatch = item.text.match(AGENT_START_PATTERN);
  if (startMatch) {
    return { agentId: startMatch[1], runId: null, kind: "start" };
  }

  const endMatch = item.text.match(AGENT_END_PATTERN);
  if (endMatch) {
    return { agentId: endMatch[1], runId: null, kind: "end" };
  }

  const detailMatch = item.text.match(AGENT_DETAIL_PATTERN);
  if (detailMatch) {
    return { agentId: detailMatch[1], runId: null, kind: "detail" };
  }

  if (!isRecord(item.detail) || item.detail.type !== "event") {
    return { agentId: null, runId: null, kind: "other" };
  }

  const eventName = getString(item.detail.event)?.toLowerCase();
  if (eventName !== "agent" && eventName !== "chat") {
    return { agentId: null, runId: null, kind: "other" };
  }

  const payload = isRecord(item.detail.payload) ? item.detail.payload : null;
  const agentId = getAgentIdFromSessionKey(getString(payload?.sessionKey));
  const runId = getString(payload?.runId);
  if (!agentId) {
    return { agentId: null, runId, kind: "other" };
  }

  if (eventName === "agent" && payload) {
    return { agentId, runId, kind: inferLifecycleKind(payload) };
  }
  if (eventName === "chat") {
    const data = payload && isRecord(payload.data) ? payload.data : null;
    const state = getString(data?.state)?.toLowerCase();
    if (state === "final" || state === "done" || state === "end" || state === "completed") {
      return { agentId, runId, kind: "end" };
    }
    return { agentId, runId, kind: "detail" };
  }

  return { agentId, runId, kind: "detail" };
};

const buildLifecycleDisplayInfo = (item: TimelineItem, t: TFunction<"timeline">): DisplayLifecycleInfo => {
  const meta = getTimelineAgentMeta(item);
  if (!meta.agentId || (meta.kind !== "start" && meta.kind !== "end")) {
    return null;
  }

  const lifecycleLabel = t(meta.kind === "start" ? "agentStart" : "agentEnd");
  const detailSource = isRecord(item.detail) ? getString(item.detail.source) : null;
  const text = AGENT_START_PATTERN.test(item.text) || AGENT_END_PATTERN.test(item.text)
    ? item.text
    : `Agent ${meta.agentId} ${lifecycleLabel} (${meta.runId ? `run:${meta.runId}` : "run:unknown"}${detailSource ? `, ${detailSource}` : ""})`;

  return {
    text,
    dedupeKey: `${meta.agentId}::${meta.runId ?? "unknown"}::${meta.kind}::${item.ts}`,
  };
};

const shouldHideRawGatewayEventLine = (item: TimelineItem) => {
  if (AGENT_START_PATTERN.test(item.text) || AGENT_END_PATTERN.test(item.text)) {
    return false;
  }
  if (!isRecord(item.detail) || item.detail.type !== "event") return false;
  const eventName = getString(item.detail.event)?.toLowerCase();
  // agent/chat 原始 gateway 事件已经被更高层的“开始工作 / 结束工作”语义吸收，
  // 继续直接展示只会让时间线出现两套重复表述。
  return eventName === "agent" || eventName === "chat";
};

const isSameAgentRun = (meta: TimelineAgentMeta, agentId: string, runId: string | null) => {
  if (meta.agentId !== agentId) return false;
  if (!runId || !meta.runId) return true;
  return meta.runId === runId;
};

const buildDisplayTimeline = (timeline: TimelineItem[], t: TFunction<"timeline">): DisplayTimelineEntry[] => {
  const chronological = [...timeline].reverse();
  const hiddenIds = new Set<string>();
  const startIndexesByAgentRun = new Map<string, number[]>();
  const collapsedByStartIndex = new Map<number, CollapsedTimelineEntry>();
  const lifecycleDedupeKeys = new Set<string>();

  // timeline 存储顺序是“最新在前”，这里先转成时间正序计算工作区间，
  // 否则开始/结束边界会反过来，折叠结果就会失真。
  for (let index = 0; index < chronological.length; index += 1) {
    const item = chronological[index];
    const meta = getTimelineAgentMeta(item);
    if (!meta.agentId) continue;
    const agentRunKey = `${meta.agentId}::${meta.runId ?? "unknown"}`;

    if (meta.kind === "start") {
      const indexes = startIndexesByAgentRun.get(agentRunKey) ?? [];
      indexes.push(index);
      startIndexesByAgentRun.set(agentRunKey, indexes);
      continue;
    }

    if (meta.kind !== "end") continue;
    const agentId = meta.agentId;
    const startIndexes = startIndexesByAgentRun.get(agentRunKey) ?? [];
    const startIndex = startIndexes.pop();
    if (startIndexes.length === 0) {
      startIndexesByAgentRun.delete(agentRunKey);
    } else {
      startIndexesByAgentRun.set(agentRunKey, startIndexes);
    }
    if (startIndex === undefined) continue;

    const hiddenItems = chronological.slice(startIndex + 1, index).filter((entry) => {
      const entryMeta = getTimelineAgentMeta(entry);
      return entryMeta.kind === "detail" && isSameAgentRun(entryMeta, agentId, meta.runId);
    });
    if (hiddenItems.length === 0) continue;
    for (const hidden of hiddenItems) {
      hiddenIds.add(hidden.id);
    }
    collapsedByStartIndex.set(
      startIndex,
      buildCollapsedEntry(agentId, hiddenItems, "collapsed", item.id, t),
    );
  }

  // Agent 尚未结束时，把开始事件之后到当前最新的一段也折成一条“进行中”占位。
  for (const [agentRunKey, startIndexes] of startIndexesByAgentRun.entries()) {
    const [agentId, runIdRaw] = agentRunKey.split("::");
    const runId = runIdRaw === "unknown" ? null : runIdRaw;
    for (const startIndex of startIndexes) {
      const hiddenItems = chronological.slice(startIndex + 1).filter(
        (entry) => {
          if (hiddenIds.has(entry.id)) return false;
          const entryMeta = getTimelineAgentMeta(entry);
          return entryMeta.kind === "detail" && isSameAgentRun(entryMeta, agentId, runId);
        },
      );
      if (hiddenItems.length === 0) continue;
      for (const hidden of hiddenItems) {
        hiddenIds.add(hidden.id);
      }
      const lastHidden = hiddenItems[hiddenItems.length - 1];
      collapsedByStartIndex.set(
        startIndex,
        buildCollapsedEntry(agentId, hiddenItems, "inProgress", `open:${lastHidden.id}`, t),
      );
    }
  }

  const displayChronological: DisplayTimelineEntry[] = [];
  for (let index = 0; index < chronological.length; index += 1) {
    const item = chronological[index];
    const lifecycleDisplay = buildLifecycleDisplayInfo(item, t);
    if (!hiddenIds.has(item.id)) {
      if (lifecycleDisplay) {
        if (!lifecycleDedupeKeys.has(lifecycleDisplay.dedupeKey)) {
          lifecycleDedupeKeys.add(lifecycleDisplay.dedupeKey);
          displayChronological.push({ ...item, text: lifecycleDisplay.text, kind: "item" });
        }
      } else if (!shouldHideRawGatewayEventLine(item)) {
        displayChronological.push({ ...item, kind: "item" });
      }
    }
    const collapsed = collapsedByStartIndex.get(index);
    if (collapsed) {
      displayChronological.push(collapsed);
    }
  }

  return displayChronological.reverse();
};

export function TimelineCard({ timeline, onOpenRunLog }: TimelineCardProps) {
  const { t } = useTranslation("timeline");
  const displayTimeline = useMemo(() => buildDisplayTimeline(timeline, t), [timeline, t]);
  const [selectedTimelineId, setSelectedTimelineId] = useState("");
  const selectedTimeline = useMemo(
    () => displayTimeline.find((item) => item.id === selectedTimelineId) ?? null,
    [displayTimeline, selectedTimelineId],
  );

  useEffect(() => {
    if (selectedTimelineId && !selectedTimeline) {
      setSelectedTimelineId("");
    }
  }, [selectedTimeline, selectedTimelineId]);

  useEffect(() => {
    if (!selectedTimeline) return;
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedTimelineId("");
      }
    };
    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, [selectedTimeline]);

  const renderDetail = (item: DisplayTimelineEntry) => {
    if (item.kind === "collapsed") return item.detail;
    return stringifyTimelineDetail(item);
  };

  return (
    <>
      <section data-runtime-card className="grid min-w-0 min-h-0 grid-rows-[auto_1fr]">
        <div className={panelHeaderClassName}>
          <h2>{t("timeline")}</h2>
          <div className="flex flex-wrap items-center gap-2.5">
            <span className={monoClassName}>{t("displayCount", { displayed: displayTimeline.length, total: timeline.length })}</span>
            {onOpenRunLog ? (
              <button className={actionButtonClassName} type="button" onClick={onOpenRunLog}>
                {t("viewFullLog")}
              </button>
            ) : null}
          </div>
        </div>
        <ul className="m-0 grid min-h-0 list-none gap-0 overflow-auto p-0">
          {displayTimeline.map((line, index) => (
            <li
              key={line.id || `${line.ts}-${line.text}-${index}`}
              className={`border-b border-(--line) last:border-b-0 ${line.kind === "collapsed" ? "collapsed" : ""}`}
            >
              <button className={`line-trigger appearance-none border-0 grid w-full grid-cols-[88px_1fr] gap-2.5 rounded-none px-2 py-2.25 text-left text-(--text) shadow-none max-[760px]:grid-cols-1 max-[760px]:gap-1.25 ${line.kind === "collapsed" ? "bg-[rgba(142,163,179,0.06)]" : "bg-transparent"} hover:bg-[rgba(142,163,179,0.08)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--live)] focus-visible:outline-offset-[-1px]`} type="button" onClick={() => setSelectedTimelineId(line.id)}>
                <span className="text-xs text-(--muted) font-[JetBrains_Mono,monospace]">{line.ts}</span>
                <p className={`m-0 overflow-wrap-anywhere font-[JetBrains_Mono,monospace] text-[13px] ${line.kind === "collapsed" ? "text-[var(--muted)]" : ""}`}>{line.text}</p>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <div
        className={`${modalMaskBaseClassName} ${selectedTimeline ? modalMaskOpenClassName : modalMaskClosedClassName}`}
        onClick={() => setSelectedTimelineId("")}
        aria-hidden={!selectedTimeline}
      />
      <aside
        className={`${modalFrameBaseClassName} ${selectedTimeline ? modalFrameOpenClassName : modalFrameClosedClassName}`}
        aria-hidden={!selectedTimeline}
        onClick={() => setSelectedTimelineId("")}
      >
        <div className={`${modalPanelBaseClassName} grid w-[min(760px,94vw)] gap-2.5 max-[760px]:h-screen max-[760px]:max-h-screen max-[760px]:w-screen`} onClick={(event) => event.stopPropagation()}>
          <div className={panelHeaderClassName}>
            <h2>{t("eventDetail")}</h2>
            <button className={drawerCloseClassName} type="button" onClick={() => setSelectedTimelineId("")} aria-label={t("close")}>
              <CloseIcon />
            </button>
          </div>
          {selectedTimeline ? (
            <>
              <div className={`${monoClassName} flex items-center justify-between gap-2.5 border border-(--line) px-2.5 py-2 text-xs`}>
                <span>{selectedTimeline.ts}</span>
                <span className={`${levelTagBaseClassName} ${levelTagToneClassName[selectedTimeline.level]}`}>
                  {selectedTimeline.level === "error" ? t("error") : selectedTimeline.level === "warn" ? t("warning") : t("info")}
                </span>
              </div>
              <div className="max-h-[min(60vh,540px)] overflow-auto border border-(--line) bg-[#0f171d] max-[760px]:h-full max-[760px]:max-h-none">
                <pre className="m-0 whitespace-pre-wrap wrap-break-word p-3 font-[JetBrains_Mono,monospace] text-[13px] leading-[1.45]">{renderDetail(selectedTimeline)}</pre>
              </div>
            </>
          ) : null}
        </div>
      </aside>
    </>
  );
}
