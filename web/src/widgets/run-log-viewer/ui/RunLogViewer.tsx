import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CloseIcon } from "../../../shared/ui";
import { panelHeaderClassName } from "../../../shared/ui/panelClasses";
import {
  controlInputMonoClassName,
  drawerCloseClassName,
  modalFrameBaseClassName,
  modalFrameClosedClassName,
  modalFrameOpenClassName,
  modalMaskBaseClassName,
  modalMaskClosedClassName,
  modalMaskOpenClassName,
  modalPanelBaseClassName,
  modalSublineClassName,
} from "../../../shared/ui/surfaceClassNames";
import { useRunLogViewer } from "../model/useRunLogViewer";
import { predictRunLogDetailHeight, predictRunLogRowHeight, stringifyRunLogDetail } from "../model/log-height-predict";

type RunLogViewerProps = {
  open: boolean;
  runId: string;
  onClose: () => void;
};

const levelKey: Record<"info" | "warn" | "error", string> = {
  info: "levelInfo",
  warn: "levelWarn",
  error: "levelError",
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
const monoClassName = "font-[JetBrains_Mono,monospace]";
const fieldLabelClassName = "mb-1.5 block text-xs text-[var(--muted)]";
const actionButtonClassName =
  "mt-0 cursor-pointer border border-[var(--live-25)] bg-transparent px-[10px] py-2 font-semibold text-[var(--live)] hover:bg-[rgba(50,215,186,0.1)]";

export function RunLogViewer({ open, runId, onClose }: RunLogViewerProps) {
  const { t } = useTranslation("log");
  const vm = useRunLogViewer(open, runId);
  const listRef = useRef<HTMLDivElement | null>(null);
  const detailRef = useRef<HTMLDivElement | null>(null);
  const [listWidth, setListWidth] = useState(520);
  const [detailWidth, setDetailWidth] = useState(420);

  useEffect(() => {
    if (!open) return;
    const updateWidths = () => {
      setListWidth(Math.max(260, (listRef.current?.clientWidth ?? 520) - 34));
      setDetailWidth(Math.max(220, (detailRef.current?.clientWidth ?? 420) - 30));
    };
    updateWidths();
    const observer = new ResizeObserver(() => updateWidths());
    if (listRef.current) observer.observe(listRef.current);
    if (detailRef.current) observer.observe(detailRef.current);
    window.addEventListener("resize", updateWidths);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateWidths);
    };
  }, [open]);

  const detailText = useMemo(
    () => stringifyRunLogDetail(vm.selectedItem?.detail),
    [vm.selectedItem],
  );
  const detailHeight = useMemo(
    () => predictRunLogDetailHeight(vm.selectedItem?.detail, detailWidth),
    [vm.selectedItem, detailWidth],
  );

  return (
    <>
      <div className={`${modalMaskBaseClassName} ${open ? modalMaskOpenClassName : modalMaskClosedClassName}`} onClick={onClose} aria-hidden={!open} />
      <aside className={`${modalFrameBaseClassName} ${open ? modalFrameOpenClassName : modalFrameClosedClassName}`} aria-hidden={!open} onClick={onClose}>
        <div
          className={`${modalPanelBaseClassName} grid max-h-[92vh] w-[min(1400px,97vw)] grid-rows-[auto_auto_auto_minmax(0,1fr)] gap-3 max-[760px]:h-screen max-[760px]:max-h-screen max-[760px]:w-screen`}
          onClick={(event) => event.stopPropagation()}
        >
          <div className={panelHeaderClassName}>
            <div>
              <h2>{t("runLog")}</h2>
              <p className={`${modalSublineClassName} ${monoClassName}`}>run={runId || "-"}</p>
            </div>
            <button className={drawerCloseClassName} type="button" onClick={onClose} aria-label={t("common:action.close")}>
              <CloseIcon />
            </button>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <label className="min-w-55 flex-[1_1_240px]">
              <span className={fieldLabelClassName}>{t("searchKeyword")}</span>
              <input
                className={controlInputMonoClassName}
                value={vm.keywordDraft}
                onChange={(event) => vm.setKeywordDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") vm.applyFilters();
                }}
                placeholder={t("searchPlaceholder")}
              />
            </label>
            <label className="min-w-40 flex-[0_1_180px]">
              <span className={fieldLabelClassName}>{t("sortOrder")}</span>
              <select className={controlInputMonoClassName} value={vm.order} onChange={(event) => vm.setOrder(event.target.value as "asc" | "desc")}>
                <option value="desc">{t("sortNewestFirst")}</option>
                <option value="asc">{t("sortOldestFirst")}</option>
              </select>
            </label>
            <div className="min-w-55 flex-[1_1_320px]">
              <span className={fieldLabelClassName}>{t("level")}</span>
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
            </div>
            <div className="flex flex-wrap gap-2">
              <button className={actionButtonClassName} type="button" onClick={vm.applyFilters}>{t("applyFilters")}</button>
              <button className={actionButtonClassName} type="button" onClick={vm.resetFilters}>{t("reset")}</button>
              <a className={actionButtonClassName} href={vm.rawUrl} target="_blank" rel="noreferrer">{t("rawNdjson")}</a>
            </div>
          </div>

          <div className={`${monoClassName} grid gap-3 text-xs text-(--muted)`}>
            <span>{t("loaded", { loaded: vm.items.length, total: vm.total })}</span>
            <span>{t("parseFailed", { count: vm.parseErrorCount })}</span>
            <span>{vm.keyword ? `keyword=${vm.keyword}` : "keyword=-"}</span>
          </div>

          <div className="grid min-h-0 gap-3 min-[761px]:grid-cols-[minmax(420px,1.2fr)_minmax(340px,0.95fr)] max-[760px]:grid-cols-1">
            <section className="grid min-h-0 grid-rows-[minmax(0,1fr)] overflow-hidden border border-(--line) bg-[rgba(15,23,29,0.72)]" ref={listRef}>
              {vm.error ? <div className={`${monoClassName} grid min-h-45 place-items-center p-6 text-center text-xs text-(--muted)`}>{t("loadFailed", { error: vm.error })}</div> : null}
              {!vm.error && vm.items.length === 0 && !vm.loading ? <div className={`${monoClassName} grid min-h-45 place-items-center p-6 text-center text-xs text-(--muted)`}>{t("noMatch")}</div> : null}
              {vm.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`${runLogRowBaseClassName} ${vm.selectedItem?.id === item.id ? "border-(--live) shadow-[inset_0_0_0_1px_rgba(138,180,255,0.18)]" : ""}`}
                  style={{ minHeight: `${predictRunLogRowHeight(item.text, listWidth)}px` }}
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
              ))}
              {vm.loading ? <div className={`${monoClassName} grid min-h-45 place-items-center p-6 text-center text-xs text-(--muted)`}>{t("loading")}</div> : null}
            </section>

            <aside className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] border border-(--line) bg-[rgba(15,23,29,0.72)]" ref={detailRef}>
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
                <div className={`${monoClassName} grid min-h-45 place-items-center p-6 text-center text-xs text-(--muted)`}>{t("selectToViewDetail")}</div>
              )}
            </aside>
          </div>
        </div>
      </aside>
    </>
  );
}
