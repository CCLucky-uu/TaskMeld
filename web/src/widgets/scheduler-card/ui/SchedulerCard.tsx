import { useTranslation } from "react-i18next";
import { actionRowClassName, panelHeaderClassName } from "../../../shared/ui/panelClasses";

const monoClassName = "font-[JetBrains_Mono,monospace]";
const actionButtonClassName =
  "mt-0 w-full cursor-pointer border border-[var(--live-25)] bg-transparent px-[10px] py-2 font-semibold text-[var(--live)] hover:bg-[rgba(50,215,186,0.1)]";
type SchedulerCardProps = {
  pipelineId: string;
  schedulerMode: string;
  schedulerEnabled: boolean;
  onToggleScheduler: () => void;
  onSwitchSchedulerMode: () => void;
  onManualTick: () => void;
  embedded?: boolean;
};

export function SchedulerCard({
  pipelineId,
  schedulerMode,
  schedulerEnabled,
  onToggleScheduler,
  onSwitchSchedulerMode,
  onManualTick,
  embedded = false,
}: SchedulerCardProps) {
  const { t } = useTranslation("common");
  const wrapperClassName = embedded ? "border-b border-(--line) bg-[rgba(15,23,29,0.42)] mb-3" : "";

  return (
    <section data-center-card={!embedded} className={wrapperClassName}>
      <div className={`mb-2 flex items-center justify-between gap-2 px-3 pt-0`}>
        <div className="font-[JetBrains_Mono,monospace] text-xs text-(--muted)">
          {t("scheduler.schedulerConfig", { pipelineId })}
        </div>
        <span className={monoClassName}>{`mode=${schedulerMode}`}</span>
      </div>
      <div className={`${actionRowClassName} mb-0.5 grid grid-cols-3 max-[980px]:grid-cols-2 max-[640px]:grid-cols-1`}>
        <button className={actionButtonClassName} type="button" onClick={onToggleScheduler}>
          {schedulerEnabled ? t("scheduler.disableScheduler") : t("scheduler.enableScheduler")}
        </button>
        <button className={actionButtonClassName} type="button" onClick={onSwitchSchedulerMode}>
          {t("scheduler.switchToMode", {
            mode: schedulerMode === "manual" ? t("scheduler.auto") : t("scheduler.manual"),
          })}
        </button>
        <button className={actionButtonClassName} type="button" onClick={onManualTick}>
          {t("scheduler.manualStep")}
        </button>
      </div>
    </section>
  );
}
