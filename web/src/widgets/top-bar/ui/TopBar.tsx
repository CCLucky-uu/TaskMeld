import { useTranslation } from "react-i18next";
import { GatewayStatus } from "../../../entities/gateway";
import ChevronRightIcon from "@iconify-react/lucide/chevron-right";

type TopBarProps = {
  runId: string;
  gateway: GatewayStatus;
  latencyMs: number | null;
  agentCount: number;
  sessionCount: number;
  statusLabel: Record<string, string>;
  navCollapsed: boolean;
  onToggleNav: () => void;
  routeText: string;
};

export function TopBar({ navCollapsed, onToggleNav, routeText }: TopBarProps) {
  const { t } = useTranslation("nav");
  const panelIcon = (side: "left" | "right", collapsed: boolean) => (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <rect x="1.5" y="1.5" width="13" height="13" rx="2" fill="none" stroke="currentColor" strokeWidth="1.2" />
      {side === "left" ? (
        <rect
          x="2.5"
          y="2.5"
          width="4.5"
          height="11"
          rx="1"
          fill={collapsed ? "none" : "currentColor"}
          stroke="currentColor"
          strokeWidth="1"
        />
      ) : (
        <rect
          x="9"
          y="2.5"
          width="4.5"
          height="11"
          rx="1"
          fill={collapsed ? "none" : "currentColor"}
          stroke="currentColor"
          strokeWidth="1"
        />
      )}
    </svg>
  );

  return (
    <header className="flex items-center justify-start gap-2.5 border-b border-r border-(--line) px-3 py-2 h-[60px]">
      <div className="flex min-w-0 items-center gap-2.5">
        <div className="inline-flex items-center gap-1.5">
          <button
            className={`mt-0 inline-flex min-h-[32px] min-w-[32px] items-center justify-center border border-(--line) bg-[rgba(15,23,29,0.55)] p-2 text-(--muted) transition-[background-color,color] hover:bg-[#15212a] hover:text-(--text) focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--live)] focus-visible:outline-offset-[-2px] ${navCollapsed ? "bg-[rgba(15,23,29,0.8)] text-(--text)" : ""}`}
            type="button"
            onClick={onToggleNav}
            aria-label={navCollapsed ? t("expandNav") : t("collapseNav")}
            title={navCollapsed ? t("expandNav") : t("collapseNav")}
          >
            {panelIcon("left", navCollapsed)}
          </button>
        </div>
        <div className="min-w-0 text-sm text-(--muted)">
          <span>{t("home")}</span>
          <span className="inline-flex px-1.5 align-middle text-(--muted)">
            <ChevronRightIcon className="h-3.5 w-3.5" />
          </span>
          <span className="text-(--text)">{routeText}</span>
        </div>
      </div>
    </header>
  );
}
