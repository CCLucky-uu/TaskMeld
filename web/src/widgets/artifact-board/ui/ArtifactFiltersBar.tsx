import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { controlInputClassName, controlInputMonoClassName } from "../../../shared/ui/surfaceClassNames";
import type { ArtifactFilterState, ArtifactNodeOption, ArtifactPipelineOption } from "../model/types";

type ArtifactFiltersBarProps = {
  filters: ArtifactFilterState;
  pipelineOptions: ArtifactPipelineOption[];
  nodeOptions: ArtifactNodeOption[];
  loading: boolean;
  exporting: boolean;
  onChangeFilters: (updater: (prev: ArtifactFilterState) => ArtifactFilterState) => void;
  onApply: () => void;
  onReset: () => void;
  onRefresh: () => void;
  onExport: () => void;
};

const monoClassName = "font-[JetBrains_Mono,monospace]";
const quickButtonBaseClassName =
  "inline-flex h-7 items-center justify-center border px-2 text-xs transition-[background-color,color,border-color]";
const quickButtonActiveClassName = "border-[var(--live-25)] bg-[rgba(50,215,186,0.16)] text-[var(--live)]";
const quickButtonInactiveClassName =
  "border-[var(--line)] bg-[rgba(15,23,29,0.55)] text-[var(--muted)] hover:bg-[rgba(24,39,47,0.72)] hover:text-[var(--text)]";
const inputClassName = `${controlInputClassName} h-8 px-2 py-1 text-xs`;
const actionButtonClassName =
  "inline-flex h-8 items-center justify-center border border-[var(--line)] bg-[rgba(15,23,29,0.62)] px-3 text-xs text-[var(--text)] hover:bg-[rgba(19,34,43,0.82)] disabled:cursor-not-allowed disabled:opacity-50";

const nodePickerClassName = "relative min-w-0";
const nodePickerTriggerClassName = `${controlInputMonoClassName} h-8 cursor-pointer overflow-hidden px-2 py-1 text-ellipsis whitespace-nowrap text-xs`;
const nodePickerTriggerOpenClassName = "border-[#3b5868] bg-[rgba(24,39,47,0.92)]";
const nodeDropdownClassName =
  "absolute inset-x-0 top-[calc(100%+4px)] z-[4] grid max-h-[180px] overflow-y-auto overflow-x-hidden border border-[#29414f] bg-[rgba(18,31,38,0.98)] px-0 py-0 text-[var(--text)] shadow-none";
const nodeOptionClassName =
  "grid min-w-0 cursor-pointer grid-cols-[10px_minmax(0,1fr)] items-center gap-x-3 px-2 py-1.5 text-xs leading-[1.2] text-[var(--text)] transition-[background-color,color] hover:bg-[rgba(22,36,44,0.9)]";
const nodeOptionCheckedClassName = "bg-[rgba(50,215,186,0.12)]";
const nodeCheckboxClassName =
  "m-0 h-[10px] w-[10px] cursor-pointer appearance-none border border-[var(--line)] bg-transparent transition-[border-color,background-color] hover:border-[#2a3c4b] checked:border-[var(--live)] checked:bg-[var(--live)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--live)] focus-visible:outline-offset-1";
const nodeEmptyClassName = "mx-2 my-1.5 text-xs text-[var(--muted)]";

export function ArtifactFiltersBar({
  filters,
  pipelineOptions,
  nodeOptions,
  loading,
  exporting,
  onChangeFilters,
  onApply,
  onReset,
  onRefresh,
  onExport,
}: ArtifactFiltersBarProps) {
  const { t } = useTranslation("artifact");
  const [nodePickerOpen, setNodePickerOpen] = useState(false);
  const nodePickerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!nodePickerOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (nodePickerRef.current && !nodePickerRef.current.contains(event.target as Node)) {
        setNodePickerOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [nodePickerOpen]);

  const selectedNodeLabel =
    filters.nodeIds.length === 0
      ? t("common:common.all")
      : filters.nodeIds.length <= 3
        ? filters.nodeIds.join(", ")
        : `${filters.nodeIds.slice(0, 3).join(", ")} ${t("nodeSummary", { count: filters.nodeIds.length })}`;

  const toggleNode = (nodeId: string, checked: boolean) => {
    if (!nodeId.trim()) return;
    onChangeFilters((prev) => {
      const next = checked
        ? Array.from(new Set([...prev.nodeIds, nodeId]))
        : prev.nodeIds.filter((id) => id !== nodeId);
      return { ...prev, nodeIds: next };
    });
  };

  return (
    <section className="grid gap-2 border border-(--line) bg-[rgba(13,22,28,0.82)] px-3 py-2">
      <div className="grid gap-2 lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-start">
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              { key: "today", label: t("common:time.today") },
              { key: "7d", label: t("common:time.last7d") },
              { key: "30d", label: t("common:time.last30d") },
              { key: "custom", label: t("common:time.custom") },
            ] as const
          ).map((option) => (
            <button
              key={option.key}
              type="button"
              className={`${quickButtonBaseClassName} ${filters.preset === option.key ? quickButtonActiveClassName : quickButtonInactiveClassName}`}
              onClick={() => {
                onChangeFilters((prev) => ({ ...prev, preset: option.key }));
              }}
              disabled={loading}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <input
            className={inputClassName}
            type="date"
            value={filters.customFrom}
            onChange={(event) => {
              const value = event.target.value;
              onChangeFilters((prev) => ({ ...prev, customFrom: value, preset: "custom" }));
            }}
            disabled={loading}
          />
          <input
            className={inputClassName}
            type="date"
            value={filters.customTo}
            onChange={(event) => {
              const value = event.target.value;
              onChangeFilters((prev) => ({ ...prev, customTo: value, preset: "custom" }));
            }}
            disabled={loading}
          />
          <select
            className={inputClassName}
            value={filters.pipelineId}
            onChange={(event) => {
              const value = event.target.value;
              onChangeFilters((prev) => ({ ...prev, pipelineId: value }));
            }}
            disabled={loading}
          >
            <option value="">{t("allPipelines")}</option>
            {pipelineOptions.map((pipeline) => (
              <option key={pipeline.id} value={pipeline.id}>
                {pipeline.id} - {pipeline.title}
              </option>
            ))}
          </select>
          <select
            className={inputClassName}
            value={filters.statuses.join(",")}
            onChange={(event) => {
              const value = event.target.value;
              onChangeFilters((prev) => ({ ...prev, statuses: value ? value.split(",") : [] }));
            }}
            disabled={loading}
          >
            <option value="">{t("allStatus")}</option>
            <option value="success">success</option>
            <option value="failed">failed</option>
            <option value="rejected">rejected</option>
            <option value="success,failed">success + failed</option>
          </select>
          <select
            className={inputClassName}
            value={filters.kinds.join(",")}
            onChange={(event) => {
              const value = event.target.value;
              onChangeFilters((prev) => ({ ...prev, kinds: value ? value.split(",") : [] }));
            }}
            disabled={loading}
          >
            <option value="">{t("allTypes")}</option>
            <option value="artifact">artifact</option>
            <option value="envelope">envelope</option>
            <option value="adapter">adapter</option>
            <option value="group">group</option>
          </select>
          <div className={nodePickerClassName} ref={nodePickerRef}>
            <div
              className={`${nodePickerTriggerClassName} ${nodePickerOpen ? nodePickerTriggerOpenClassName : ""}`}
              title={selectedNodeLabel}
              role="button"
              tabIndex={loading ? -1 : 0}
              onClick={() => {
                if (loading) return;
                setNodePickerOpen((prev) => !prev);
              }}
              onKeyDown={(event) => {
                if (loading) return;
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setNodePickerOpen((prev) => !prev);
                }
              }}
              aria-label={t("editNodeFilter")}
            >
              {selectedNodeLabel}
            </div>
            {nodePickerOpen ? (
              <div className={nodeDropdownClassName}>
                <label
                  className={`${nodeOptionClassName} ${filters.nodeIds.length === 0 ? nodeOptionCheckedClassName : ""}`}
                >
                  <input
                    type="checkbox"
                    className={nodeCheckboxClassName}
                    checked={filters.nodeIds.length === 0}
                    onChange={() => {
                      // Empty array means "all nodes" — consistent with the query-layer semantics.
                      onChangeFilters((prev) => ({ ...prev, nodeIds: [] }));
                    }}
                  />
                  <span className="block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{t("allNodes")}</span>
                </label>
                {nodeOptions.length ? (
                  nodeOptions.map((node) => (
                    <label
                      key={node.id}
                      className={`${nodeOptionClassName} ${filters.nodeIds.includes(node.id) ? nodeOptionCheckedClassName : ""}`}
                    >
                      <input
                        type="checkbox"
                        className={nodeCheckboxClassName}
                        checked={filters.nodeIds.includes(node.id)}
                        onChange={(event) => toggleNode(node.id, event.target.checked)}
                      />
                      <span className="block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{node.id}</span>
                    </label>
                  ))
                ) : (
                  <p className={nodeEmptyClassName}>{t("noNodesAvailable")}</p>
                )}
              </div>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-start gap-1.5 lg:justify-end">
          <button type="button" className={actionButtonClassName} onClick={onApply} disabled={loading}>
            {t("applyFilters")}
          </button>
          <button type="button" className={actionButtonClassName} onClick={onReset} disabled={loading}>
            {t("reset")}
          </button>
          <button type="button" className={actionButtonClassName} onClick={onRefresh} disabled={loading}>
            {t("refresh")}
          </button>
          <button type="button" className={actionButtonClassName} onClick={onExport} disabled={loading || exporting}>
            {exporting ? t("exporting") : t("export")}
          </button>
        </div>
      </div>
      <p className={`${monoClassName} m-0 text-xs text-(--muted)`}>
        {t("timeRange")}：
        {filters.preset === "today"
          ? t("common:time.today")
          : filters.preset === "7d"
            ? t("recentDays", { count: 7 })
            : filters.preset === "30d"
              ? t("recentDays", { count: 30 })
              : t("common:time.custom")}{" "}
        |{t("pipeline")}：{filters.pipelineId || t("common:common.all")} | {t("node")}：{selectedNodeLabel}
      </p>
    </section>
  );
}
