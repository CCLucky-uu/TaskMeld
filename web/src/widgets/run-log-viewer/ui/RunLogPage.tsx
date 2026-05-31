import { ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { fetchRunLogRuns } from "../../../entities/run-log";
import { panelHeaderClassName } from "../../../shared/ui/panelClasses";
import { controlInputMonoClassName } from "../../../shared/ui/surfaceClassNames";
import { useRunLogViewer } from "../model/useRunLogViewer";
import { predictRunLogDetailHeight, predictRunLogRowHeight, stringifyRunLogDetail } from "../model/log-height-predict";

type RunLogPageProps = {
  currentRunId: string;
};

const levelKey: Record<"info" | "warn" | "error", string> = {
  info: "levelInfo",
  warn: "levelWarn",
  error: "levelError",
};

const ROW_GAP = 10;
const LIST_OVERSCAN_PX = 480;
const LIST_FALLBACK_HEIGHT = 640;

type VirtualLogRow = {
  key: string;
  estimatedHeight: number;
  render: () => ReactNode;
};

type PositionedLogRow = {
  key: string;
  top: number;
  render: () => ReactNode;
};

const runLogLevelGroupClassName = "flex flex-wrap gap-2";
const runLogLevelLabelBaseClassName = "inline-flex cursor-pointer items-center gap-1.5 rounded-none px-2 py-[2px] text-xs uppercase";
const runLogLevelLabelToneClassName: Record<"info" | "warn" | "error", string> = {
  info: "bg-[rgba(142,163,179,0.2)] text-[#a5b9c8]",
  warn: "bg-[rgba(255,184,77,0.16)] text-[var(--warn)]",
  error: "bg-[rgba(255,107,107,0.16)] text-[var(--bad)]",
};
const runLogRowBaseClassName =
  "grid w-full gap-2 border border-[var(--line)] bg-[linear-gradient(180deg,rgba(15,23,29,0.92)_0%,rgba(11,17,22,0.92)_100%)] px-3 py-2.5 text-left text-[var(--text)]";
const runLogPaneTitleClassName =
  "m-0 flex items-center justify-between border-b border-[var(--line)] bg-[rgba(15,23,29,0.9)] p-3";
const runLogRunButtonClassName =
  "cursor-pointer border px-[10px] text-(--muted)  py-[10px] text-left border-transparent bg-transparent hover:border-[var(--line)] hover:bg-[#15212a]";
const monoClassName = "font-[JetBrains_Mono,monospace]";
const ghostActionButtonClassName =
  "mt-0 cursor-pointer border border-[var(--live-25)] bg-transparent px-[10px] py-2 font-semibold text-[var(--live)] hover:bg-[rgba(50,215,186,0.1)]";

export function RunLogPage({ currentRunId }: RunLogPageProps) {
  const { t } = useTranslation("log");
  const [availableRuns, setAvailableRuns] = useState<string[]>([]);
  const [selectedRunId, setSelectedRunId] = useState(currentRunId);
  const [listWidth, setListWidth] = useState(520);
  const [detailWidth, setDetailWidth] = useState(420);
  const [listScrollTop, setListScrollTop] = useState(0);
  const [listViewportHeight, setListViewportHeight] = useState(0);
  const measuredHeightsRef = useRef<Map<string, number>>(new Map());
  const rowObserverRef = useRef<ResizeObserver | null>(null);
  const listCanvasRef = useRef<HTMLDivElement | null>(null);
  const [measureVersion, setMeasureVersion] = useState(0);
  const vm = useRunLogViewer(true, selectedRunId);

  useEffect(() => {
    setSelectedRunId((prev) => prev || currentRunId);
  }, [currentRunId]);

  useEffect(() => {
    let alive = true;
    void fetchRunLogRuns()
      .then((runs) => {
        if (!alive) return;
        setAvailableRuns(runs);
        if (!selectedRunId && runs.length > 0) {
          setSelectedRunId(runs[0]);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [selectedRunId]);

  const detailText = stringifyRunLogDetail(vm.selectedItem?.detail);
  const detailHeight = predictRunLogDetailHeight(vm.selectedItem?.detail, detailWidth);

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

  const virtualRows = useMemo<VirtualLogRow[]>(() => {
    const rows: VirtualLogRow[] = vm.items.map((item) => ({
      key: item.id,
      estimatedHeight: predictRunLogRowHeight(item.text, listWidth),
      render: () => (
        <button
          type="button"
          className={`${runLogRowBaseClassName} ${vm.selectedItem?.id === item.id ? "border-(--live) shadow-[inset_0_0_0_1px_rgba(138,180,255,0.18)]" : ""}`}
          onClick={() => vm.setSelectedId(item.id)}
        >
          <div className={`${monoClassName} flex items-center justify-between gap-3 text-xs text-(--muted)`}>
            <span>{new Date(item.ts).toLocaleString(undefined, { hour12: false })}</span>
            <span className={`${runLogLevelLabelBaseClassName} ${runLogLevelLabelToneClassName[item.level]}`}>
              {t(levelKey[item.level])}
            </span>
          </div>
          <p className="m-0 wrap-break-word whitespace-pre-wrap font-[JetBrains_Mono,monospace] text-[13px] leading-normal">{item.text}</p>
        </button>
      ),
    }));

    return rows;
  }, [vm.items, vm.selectedItem?.id, vm.setSelectedId, listWidth]);

  const { totalHeight, visibleRows } = useMemo(() => {
    const measured = measuredHeightsRef.current;
    const viewportHeight = listViewportHeight > 0 ? listViewportHeight : LIST_FALLBACK_HEIGHT;
    const startY = Math.max(0, listScrollTop - LIST_OVERSCAN_PX);
    const endY = listScrollTop + viewportHeight + LIST_OVERSCAN_PX;

    let cursor = 0;
    const tops: number[] = new Array(virtualRows.length);
    const heights: number[] = new Array(virtualRows.length);
    for (let index = 0; index < virtualRows.length; index += 1) {
      const row = virtualRows[index]!;
      tops[index] = cursor;
      const rowHeight = measured.get(row.key) ?? row.estimatedHeight;
      heights[index] = rowHeight;
      cursor += rowHeight + ROW_GAP;
    }
    const canvasHeight = cursor > 0 ? cursor - ROW_GAP : 0;

    let startIndex = 0;
    while (startIndex < virtualRows.length) {
      const top = tops[startIndex]!;
      const height = heights[startIndex]!;
      if (top + height >= startY) break;
      startIndex += 1;
    }

    let endIndex = startIndex;
    while (endIndex < virtualRows.length) {
      const top = tops[endIndex]!;
      if (top > endY) break;
      endIndex += 1;
    }

    const positioned: PositionedLogRow[] = [];
    for (let index = startIndex; index < endIndex; index += 1) {
      const row = virtualRows[index]!;
      positioned.push({
        key: row.key,
        top: tops[index]!,
        render: row.render,
      });
    }

    return {
      totalHeight: canvasHeight,
      visibleRows: positioned,
    };
  }, [virtualRows, measureVersion, listScrollTop, listViewportHeight]);

  const visibleRowSignature = useMemo(
    () => visibleRows.map((row) => row.key).join("|"),
    [visibleRows],
  );

  useLayoutEffect(() => {
    const canvas = listCanvasRef.current;
    const observer = rowObserverRef.current;
    if (!canvas || !observer) return;
    observer.disconnect();
    const nodes = canvas.querySelectorAll<HTMLDivElement>("[data-virtual-run-log-row][data-row-key]");
    nodes.forEach((node) => observer.observe(node));
  }, [visibleRowSignature]);

  return (
    <section data-center-card data-run-log-page className="grid h-full min-h-0 min-w-0 flex-1 grid-rows-[auto_minmax(0,1fr)] gap-3 overflow-hidden">
      <div className={panelHeaderClassName}>
        <div>
          <h2>{t("logCenter")}</h2>
        </div>
        <a
          className={ghostActionButtonClassName}
          href={vm.rawUrl}
          target="_blank"
          rel="noreferrer"
        >
          {t("rawNdjson")}
        </a>
      </div>

      <div className="grid h-full min-h-0 gap-3 min-[1181px]:grid-cols-[minmax(220px,260px)_minmax(420px,1.15fr)_minmax(360px,0.95fr)] max-[1180px]:grid-cols-1">
        <aside className="h-full min-h-0 overflow-hidden">
          <section className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden border border-(--line) bg-[rgba(15,23,29,0.72)]">
            <div className={runLogPaneTitleClassName}>
              <h2>{t("runList")}</h2>
              <span className={monoClassName}>{availableRuns.length}</span>
            </div>
            <div className="grid min-h-0 gap-2 overflow-auto p-2.5">
              {(availableRuns.length > 0 ? availableRuns : [currentRunId]).map((runId) => (
                <button
                  key={runId}
                  type="button"
                  className={`${runLogRunButtonClassName} ${selectedRunId === runId ? "border-(--live) bg-[rgba(50,215,186,0.12)] text-(--text) shadow-[inset_3px_0_0_0_var(--live)]" : ""}`}
                  onClick={() => setSelectedRunId(runId)}
                >
                  {runId}
                </button>
              ))}
            </div>
          </section>
        </aside>

        <section
          className="grid h-full min-h-0 grid-rows-[auto_auto_minmax(0,1fr)] overflow-hidden border border-(--line) bg-[rgba(15,23,29,0.72)]"
          ref={(node) => {
            if (node) setListWidth(Math.max(260, node.clientWidth - 34));
          }}
        >
          <div className={runLogPaneTitleClassName}>
            <h2>{t("logList")}</h2>
            <span className={monoClassName}>{vm.total}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2.5 border-b border-(--line) bg-[rgba(15,23,29,0.82)] p-3">
            <input
              className={`${controlInputMonoClassName} min-w-0 flex-[1_1_240px]`}
              value={vm.keywordDraft}
              onChange={(event) => vm.setKeywordDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") vm.applyFilters();
              }}
              placeholder={t("keywordSearch")}
            />
            <div className={runLogLevelGroupClassName}>
              {(["info", "warn", "error"] as const).map((level) => (
                <label key={level} className={`${runLogLevelLabelBaseClassName} ${runLogLevelLabelToneClassName[level]}`}>
                  <input
                    type="checkbox"
                    checked={vm.selectedLevels.includes(level)}
                    onChange={(event) => vm.toggleLevel(level, event.target.checked)}
                  />
                  <span>{t(levelKey[level])}</span>
                </label>
              ))}
            </div>
            <button
              className={ghostActionButtonClassName}
              type="button"
              onClick={() => vm.setOrder(vm.order === "desc" ? "asc" : "desc")}
            >
              {vm.order === "desc" ? t("sortNewestFirst") : t("sortOldestFirst")}
            </button>
          </div>
          <div
            className="relative min-h-0 overflow-auto p-3"
            onScroll={(event) => setListScrollTop(event.currentTarget.scrollTop)}
            ref={(node) => {
              if (!node) return;
              setListViewportHeight(node.clientHeight);
              setListScrollTop(node.scrollTop);
              setListWidth(Math.max(260, node.clientWidth - 34));
            }}
          >
            {vm.error ? <div className={`${monoClassName} grid min-h-45 place-items-center p-6 text-center text-xs text-(--muted)`}>{t("loadFailed", { error: vm.error })}</div> : null}
            {!vm.error && vm.items.length === 0 && !vm.loading ? <div className={`${monoClassName} grid min-h-45 place-items-center p-6 text-center text-xs text-(--muted)`}>{t("noMatch")}</div> : null}
            {!vm.error && vm.items.length > 0 ? (
              <div ref={listCanvasRef} className="relative w-full" style={{ height: `${Math.max(totalHeight, 0)}px` }}>
                {visibleRows.map((row) => (
                  <div
                    key={row.key}
                    className="absolute inset-x-0 grid content-start"
                    data-virtual-run-log-row="true"
                    data-row-key={row.key}
                    style={{ transform: `translateY(${Math.round(row.top)}px)` }}
                  >
                    {row.render()}
                  </div>
                ))}
              </div>
            ) : null}
            {vm.error ? null : vm.items.length === 0 && !vm.loading ? null : (
              <div className="sticky right-0 bottom-0 mt-2 flex items-center justify-end gap-2">
                {vm.hasMore ? (
                  <button
                    type="button"
                    disabled={vm.loadingMore}
                    onClick={() => { void vm.loadMore(); }}
                    className={`${monoClassName} cursor-pointer border border-[var(--live-25)] bg-[rgba(7,12,16,0.84)] px-2 py-0.75 text-xs leading-[1.2] text-[var(--live)] hover:bg-[rgba(50,215,186,0.12)] disabled:opacity-50 disabled:cursor-wait`}
                  >
                    {vm.loadingMore ? t("loadingMore") : t("loadMore")}
                  </button>
                ) : null}
                <div className={`${monoClassName} w-fit border border-[rgba(142,163,179,0.28)] bg-[rgba(7,12,16,0.84)] px-1.5 py-0.75 text-xs leading-[1.2] text-[#9ab1c2]`}>
                  {t("renderedStatus", { rendered: visibleRows.length, loaded: virtualRows.length, total: vm.total })}
                </div>
              </div>
            )}
          </div>
        </section>

        <aside
          className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] border border-(--line) bg-[rgba(15,23,29,0.72)]"
          ref={(node) => {
            if (node) setDetailWidth(Math.max(220, node.clientWidth - 30));
          }}
        >
          {vm.selectedItem ? (
            <>
              <div className="border-b border-(--line) p-3">
                <div className="grid gap-2">
                  <strong className="text-sm leading-normal">{vm.selectedItem.text}</strong>
                  <div className={`${monoClassName} flex flex-wrap gap-2.5 text-xs text-(--muted)`}>
                    <span>{vm.selectedItem.ts}</span>
                    <span>{vm.selectedItem.level}</span>
                    <span>{vm.selectedItem.runId}</span>
                  </div>
                </div>
              </div>
              <div className="min-h-0 overflow-auto" style={{ minHeight: `${detailHeight}px` }}>
                <pre className="m-0 p-3 font-[JetBrains_Mono,monospace] text-[13px] leading-normal wrap-break-word whitespace-pre-wrap text-(--text)">{detailText}</pre>
              </div>
            </>
          ) : (
            <div className={`${monoClassName} grid min-h-45 place-items-center p-6 text-center text-xs text-(--muted)`}>{t("selectToViewDetailCenter")}</div>
          )}
        </aside>
      </div>
    </section>
  );
}
