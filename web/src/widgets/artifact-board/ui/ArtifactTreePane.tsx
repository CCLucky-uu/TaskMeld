import { useTranslation } from "react-i18next";
import type { StoredArtifactItem } from "../../../entities/artifact";
import type { ArtifactDateGroup } from "../model/types";

type ArtifactTreePaneProps = {
  groups: ArtifactDateGroup[];
  selectedItemKey: string;
  loading: boolean;
  error: string;
  onSelect: (item: StoredArtifactItem) => void;
};

const monoClassName = "font-[JetBrains_Mono,monospace]";

const formatTime = (value: string): string => {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return "-";
  const date = new Date(parsed);
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
};

export function ArtifactTreePane({
  groups,
  selectedItemKey,
  loading,
  error,
  onSelect,
}: ArtifactTreePaneProps) {
  const { t } = useTranslation("artifact");
  return (
    <section className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] border border-(--line) bg-[rgba(12,21,27,0.85)]">
      <div className="border-b border-(--line) px-2 py-1.5 text-xs text-(--muted)">{t("artifactDirectory")}</div>
      <div className="min-h-0 overflow-auto px-2 py-1.5">
        {loading ? <p className={`${monoClassName} m-0 text-xs text-(--muted)`}>{t("loading")}</p> : null}
        {!loading && error ? <p className={`${monoClassName} m-0 text-xs text-(--bad)`}>{t("loadFailed", { error })}</p> : null}
        {!loading && !error && groups.length === 0 ? (
          <p className={`${monoClassName} m-0 text-xs text-(--muted)`}>{t("noArtifacts")}</p>
        ) : null}
        {!error && groups.map((dateGroup) => (
          <details key={dateGroup.dateKey} open className="group">
            <summary
              className={`${monoClassName} flex cursor-pointer items-center gap-1 px-1 py-0.5 text-xs text-(--text) marker:text-(--muted) hover:bg-[rgba(142,163,179,0.08)]`}
            >
              <span className="truncate">{dateGroup.dateKey}</span>
              <span className="text-(--muted)">({dateGroup.total})</span>
            </summary>
            {/* File-tree indentation lines in place of multi-layer card borders. */}
            <div className="ml-3 border-l border-[rgba(142,163,179,0.2)] pl-2">
              {dateGroup.pipelines.map((pipelineGroup) => (
                <details key={`${dateGroup.dateKey}:${pipelineGroup.pipelineId}`} open className="group mt-0.5">
                  <summary
                    className={`${monoClassName} flex cursor-pointer items-center gap-1 px-1 py-0.5 text-xs text-(--text) marker:text-(--muted) hover:bg-[rgba(142,163,179,0.08)]`}
                  >
                    <span className="truncate">
                      {pipelineGroup.pipelineId} - {pipelineGroup.pipelineTitle}
                    </span>
                    <span className="text-(--muted)">({pipelineGroup.total})</span>
                  </summary>
                  <div className="ml-3 border-l border-[rgba(142,163,179,0.18)] pl-2">
                    {pipelineGroup.runs.map((runGroup) => (
                      <details key={`${pipelineGroup.pipelineId}:${runGroup.runId}`} open className="group mt-0.5">
                        <summary
                          className={`${monoClassName} flex cursor-pointer items-center gap-1 px-1 py-0.5 text-xs text-(--text) marker:text-(--muted) hover:bg-[rgba(142,163,179,0.08)]`}
                        >
                          <span className="truncate">{runGroup.runId}</span>
                          <span className="text-[rgba(142,163,179,0.78)]">({runGroup.items.length})</span>
                        </summary>
                        <div className="ml-3 border-l border-[rgba(142,163,179,0.16)] pl-2">
                          {runGroup.items.map((item) => {
                            const key = `${item.pipelineId}:${item.relativePath}`;
                            const selected = key === selectedItemKey;
                            return (
                              <button
                                key={key}
                                type="button"
                                // File row forced flat: strip default button 3D look and card feel.
                                className={`${monoClassName} mt-0.5 grid w-full cursor-pointer appearance-none grid-cols-[auto_1fr] items-center gap-x-2 border-0 bg-transparent px-1.5 py-0.5 text-left text-xs shadow-none outline-none ${
                                  selected
                                    ? "bg-[rgba(50,215,186,0.16)] text-(--text)"
                                    : "text-(--muted) hover:bg-[rgba(142,163,179,0.1)] hover:text-(--text)"
                                }`}
                                onClick={() => {
                                  onSelect(item);
                                }}
                              >
                                <span className="text-[rgba(142,163,179,0.88)]">{formatTime(item.updatedAt)}</span>
                                <span className="truncate">{item.fileName}</span>
                              </button>
                            );
                          })}
                        </div>
                      </details>
                    ))}
                  </div>
                </details>
              ))}
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}
