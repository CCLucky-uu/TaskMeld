import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import LayoutGridIcon from "@iconify-react/lucide/layout-grid";
import ListIcon from "@iconify-react/lucide/list";
import { controlInputClassName } from "../../../shared/ui/surfaceClassNames";
import { AgentListCardItem, filterAgentCards } from "./filterAgents";

const monoClassName = "font-[JetBrains_Mono,monospace]";
const statusTagBaseClassName = "inline-flex w-fit items-center rounded-none px-2 py-[2px] text-[12px] uppercase";
const statusTagToneClassName: Record<"busy" | "idle", string> = {
  busy: "bg-[rgba(255,184,77,0.16)] text-[var(--warn)]",
  idle: "bg-[rgba(50,215,186,0.15)] text-[var(--live)]",
};
const actionButtonClassName =
  "mt-0 inline-flex h-8 items-center justify-center border border-(--line) bg-[rgba(15,23,29,0.6)] px-3 text-xs text-(--text) hover:bg-[rgba(19,34,43,0.82)]";
const primaryActionButtonClassName =
  "mt-0 inline-flex h-8 items-center justify-center border border-(--live-25) bg-[rgba(50,215,186,0.1)] px-3 text-xs font-semibold text-(--live) hover:bg-[rgba(50,215,186,0.18)]";
const viewToggleButtonClassName =
  "mt-0 inline-flex h-8 w-8 items-center justify-center border border-(--line) bg-[rgba(15,23,29,0.6)] text-(--text) hover:bg-[rgba(19,34,43,0.82)]";
const filterGroupShellClassName =
  "inline-flex h-8 items-stretch overflow-hidden border border-(--line) bg-[rgba(15,23,29,0.6)]";
const filterGroupButtonClassName =
  "mt-0 inline-flex h-full appearance-none items-center justify-center border-0 border-r border-(--line) bg-transparent px-3 text-xs text-(--text) last:border-r-0 hover:bg-[rgba(19,34,43,0.82)]";
const filterGroupButtonActiveClassName =
  "!bg-[rgba(50,215,186,0.2)] !text-(--live) font-semibold shadow-[inset_0_0_0_1px_rgba(50,215,186,0.45)]";
const gridTileClassName =
  "bg-[rgba(9,15,21,0.1)] [background-image:repeating-linear-gradient(-45deg,rgba(150,170,190,0.07)_0,rgba(150,170,190,0.07)_2px,transparent_2px,transparent_8px)]";

type AgentListCardProps = {
  agents: AgentListCardItem[];
  onOpenAgentSession: (agentId: string) => void;
  onOpenAgentOutput: (agentId: string) => void;
};

export function AgentListCard({ agents, onOpenAgentSession, onOpenAgentOutput }: AgentListCardProps) {
  const [searchKeyword, setSearchKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "busy" | "idle">("all");
  const [viewMode, setViewMode] = useState<"card" | "list">("card");
  const { t } = useTranslation('agent');

  const filteredAgents = useMemo(() => {
    const searched = filterAgentCards(agents, searchKeyword);
    if (statusFilter === "all") return searched;
    return searched.filter((agent) => agent.workStatus === statusFilter);
  }, [agents, searchKeyword, statusFilter]);

  return (
    <section data-center-card data-agent-card className="grid min-h-0 min-w-0 flex-1 grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
      {/* 顶部仅保留检索与筛选工具，减少低价值统计信息占位。 */}
      <div className={`flex h-[66px] items-center border-b border-(--line) ${gridTileClassName}`}>
        <div className="flex w-full items-center gap-0 overflow-hidden px-8">
          <input
            className={`${controlInputClassName} m-0 h-8 min-w-[260px] flex-[1_1_420px] py-0 leading-none`}
            value={searchKeyword}
            onChange={(event) => setSearchKeyword(event.target.value)}
            placeholder={t('searchPlaceholder')}
            aria-label={t('searchLabel')}
          />
          <span className={`${gridTileClassName} h-8 w-4 shrink-0`} aria-hidden="true" />
          {/* 状态筛选只影响展示，不改动任何业务行为。 */}
          <div className={filterGroupShellClassName} role="group" aria-label={t('statusFilter')}>
            <button
              type="button"
              className={`${filterGroupButtonClassName} ${statusFilter === "all" ? filterGroupButtonActiveClassName : ""}`}
              onClick={() => setStatusFilter("all")}
            >
              {t('all')}
            </button>
            <button
              type="button"
              className={`${filterGroupButtonClassName} ${statusFilter === "busy" ? filterGroupButtonActiveClassName : ""}`}
              onClick={() => setStatusFilter("busy")}
            >
              {t('busy')}
            </button>
            <button
              type="button"
              className={`${filterGroupButtonClassName} ${statusFilter === "idle" ? filterGroupButtonActiveClassName : ""}`}
              onClick={() => setStatusFilter("idle")}
            >
              {t('idle')}
            </button>
          </div>
          <span className={`${gridTileClassName} h-8 w-4 shrink-0`} aria-hidden="true" />
          {/* 视图模式切换只影响展示，不影响任何智能体交互逻辑。 */}
          <button
            type="button"
            className={viewToggleButtonClassName}
            onClick={() => setViewMode((current) => (current === "card" ? "list" : "card"))}
            aria-label={viewMode === "card" ? t('switchToList') : t('switchToCard')}
            title={viewMode === "card" ? t('switchToList') : t('switchToCard')}
          >
            {viewMode === "card" ? <ListIcon className="h-4 w-4" /> : <LayoutGridIcon className="h-4 w-4" />}
          </button>
          <span className={`${gridTileClassName} h-8 w-4 shrink-0`} aria-hidden="true" />
          <span className={`${monoClassName} ml-auto text-xs text-(--muted)`}>
            {filteredAgents.length}/{agents.length}
          </span>
        </div>
      </div>
      <div className="min-h-0 overflow-y-auto">
        {filteredAgents.length && viewMode === "card" ? (
          <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(310px,1fr))] gap-3 p-3">
            {filteredAgents.map((agent) => (
              <li key={agent.id} className="m-0 min-w-0">
                <div
                  className="grid min-h-[238px] grid-rows-[auto_auto_1fr_auto] gap-2 border border-[#29414f] bg-[linear-gradient(180deg,rgba(18,31,38,0.92)_0%,rgba(14,24,30,0.92)_100%)] p-3 text-left text-(--text)"
                  role="button"
                  tabIndex={0}
                  onClick={() => onOpenAgentSession(agent.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onOpenAgentSession(agent.id);
                    }
                  }}
                >
                <div className="flex items-center justify-between gap-2">
                  <strong className="truncate text-sm">{agent.id}</strong>
                  <span className={`${statusTagBaseClassName} ${statusTagToneClassName[agent.workStatus === "busy" ? "busy" : "idle"]}`}>
                    {agent.workStatus === "busy" ? t('busy') : t('idle')}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="border border-(--line) bg-[rgba(10,18,24,0.65)] px-2 py-1.5">
                    <p className="m-0 text-[10px] text-(--muted)">{t('role')}</p>
                    <p className={`${monoClassName} m-0 mt-0.5 truncate text-xs text-(--text)`}>{agent.role}</p>
                  </div>
                  <div className="border border-(--line) bg-[rgba(10,18,24,0.65)] px-2 py-1.5">
                    <p className="m-0 text-[10px] text-(--muted)">{t('recentNode')}</p>
                    <p className={`${monoClassName} m-0 mt-0.5 truncate text-xs text-(--text)`}>
                      {agent.lastExecution?.nodeId ?? "-"}
                    </p>
                  </div>
                </div>
                <div className="grid content-start gap-1 border border-(--line) bg-[rgba(10,18,24,0.65)] p-2">
                  <small className={`${monoClassName} text-xs text-(--muted)`}>{t('outputPreview')}</small>
                  <p className="m-0 min-h-[calc(1.35em*2)] overflow-hidden text-xs leading-[1.35] text-[var(--muted)] [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] break-words">
                    {agent.outputPreview || t('noOutput')}
                  </p>
                  <small className={`${monoClassName} text-xs text-(--muted)`}>{t('eventPreview')}</small>
                  <p className="m-0 min-h-[calc(1.35em*2)] overflow-hidden text-xs leading-[1.35] text-[var(--muted)] [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] break-words">
                    {agent.eventPreview || t('noEvent')}
                  </p>
                </div>
                <div className="mt-auto grid gap-2 border-t border-(--line) pt-2">
                  <small className={`${monoClassName} self-end text-xs leading-[1.2] text-[var(--muted)]`}>
                  {agent.lastActiveAt ? new Date(agent.lastActiveAt).toLocaleString(undefined, { hour12: false }) : "-"}
                  </small>
                  <div className="flex items-center justify-end gap-2">
                    <button
                      className={actionButtonClassName}
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpenAgentOutput(agent.id);
                      }}
                    >
                      {t('viewOutput')}
                    </button>
                    <button
                      className={primaryActionButtonClassName}
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpenAgentSession(agent.id);
                      }}
                    >
                      {t('openSession')}
                    </button>
                  </div>
                </div>
                </div>
              </li>
            ))}
          </ul>
        ) : filteredAgents.length && viewMode === "list" ? (
          <div className="px-0 py-0">
            <ul className="m-0 list-none p-0">
              {filteredAgents.map((agent) => (
                <li
                  key={agent.id}
                  className="grid cursor-pointer grid-cols-[minmax(140px,220px)_96px_minmax(160px,1fr)_minmax(120px,1fr)_170px_auto] items-center gap-2 border-b border-(--line) px-2.5 py-2 text-sm text-(--text) transition-colors hover:bg-[rgba(19,34,43,0.55)] last:border-b-0"
                  role="button"
                  tabIndex={0}
                  onClick={() => onOpenAgentSession(agent.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onOpenAgentSession(agent.id);
                    }
                  }}
                >
                  <div className="min-w-0">
                    <p className="m-0 truncate font-semibold">{agent.id}</p>
                    <p className={`${monoClassName} m-0 mt-0.5 truncate text-xs text-(--muted)`}>{agent.role}</p>
                  </div>
                  <span className={`${statusTagBaseClassName} ${statusTagToneClassName[agent.workStatus === "busy" ? "busy" : "idle"]}`}>
                    {agent.workStatus === "busy" ? t('busy') : t('idle')}
                  </span>
                  <p className="m-0 truncate text-xs text-(--muted)">{agent.outputPreview || t('noOutput')}</p>
                  <p className="m-0 truncate text-xs text-(--muted)">{agent.eventPreview || t('noEvent')}</p>
                  <p className={`${monoClassName} m-0 text-xs text-(--muted)`}>
                    {agent.lastActiveAt ? new Date(agent.lastActiveAt).toLocaleString(undefined, { hour12: false }) : "-"}
                  </p>
                  <div className="flex items-center justify-end gap-2">
                    <button
                      className={actionButtonClassName}
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpenAgentOutput(agent.id);
                      }}
                    >
                      {t('viewOutput')}
                    </button>
                    <button
                      className={primaryActionButtonClassName}
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpenAgentSession(agent.id);
                      }}
                    >
                      {t('openSession')}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className={`${monoClassName} m-0 px-3 pt-3 pb-2 text-[var(--muted)]`}>{t('noMatch')}</p>
        )}
      </div>
    </section>
  );
}
