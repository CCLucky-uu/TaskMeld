import { useTranslation } from "react-i18next";
import { TaskMeldIcon } from "../../../shared/ui";
import type { NavItem, NavKey } from "../model/navItem";

type NavPanelProps = {
  navItems: NavItem[];
  active: NavKey;
  onChangeActive: (item: NavKey) => void;
  onNavigateHome?: () => void;
  protocol: number | null;
  scopes: string[];
  collapsed?: boolean;
  /** Callback when the mobile floating drawer should close */
  onCloseDrawer?: () => void;
  /** Render mode: inline = embedded in layout (desktop), overlay = floating drawer (mobile) */
  variant?: "inline" | "overlay";
};

export function NavPanel({
  navItems,
  active,
  onChangeActive,
  onNavigateHome,
  collapsed = false,
  onCloseDrawer,
  variant = "inline",
}: NavPanelProps) {
  const { t } = useTranslation("nav");
  const isOverlay = variant === "overlay";
  // Desktop: collapsed controls wide/narrow; mobile overlay: always show full content, collapsed controls slide in/out
  const showLabels = isOverlay ? true : !collapsed;
  const showCentered = isOverlay ? false : collapsed;

  const asideClassName = isOverlay
    ? `fixed left-0 top-0 bottom-0 z-50 w-52 bg-[var(--bg)] border-r border-[var(--line)] transition-transform duration-300 ease-in-out flex min-h-0 flex-col overflow-auto ${
        collapsed ? "-translate-x-full" : "translate-x-0"
      }`
    : "flex min-h-0 flex-col overflow-auto border-r border-[var(--line)]";

  return (
    <aside className={asideClassName}>
      {/* Branding sits at the top of the sidebar, forming a stable starting area together with navigation. */}
      <button
        className={`m-0 flex w-full cursor-pointer items-center border-0 border-b border-(--line) bg-transparent px-3 py-2.5 min-h-[60px] text-left font-inherit text-inherit leading-inherit transition-[background-color] hover:bg-[rgba(142,163,179,0.06)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--live)] focus-visible:outline-offset-[-2px] ${showCentered ? "justify-center" : "gap-2"}`}
        type="button"
        onClick={() => {
          // Home (/) and Overview (/overview) are semantically separate: prefer home, fall back to overview.
          if (onNavigateHome) {
            onNavigateHome();
          } else {
            onChangeActive("overview");
          }
          // Close floating drawer on mobile after click
          onCloseDrawer?.();
        }}
        aria-label={t('backToHome')}
        title={t('backToHome')}
      >
        <TaskMeldIcon className="h-7 w-7 shrink-0 text-(--live)" />
        {showLabels ? (
          <strong className="truncate text-[18px] leading-[1.1] font-bold text-(--live)">
            TaskMeld
          </strong>
        ) : null}
      </button>
      {navItems.map(({ key, label, icon: Icon }) => (
        <div key={key}>
          <button
            className={`w-full cursor-pointer border-0 py-2.5 min-h-[44px] font-medium transition-[background-color,color,box-shadow] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--live)] focus-visible:outline-offset-[-2px] ${showCentered ? "px-0 text-center" : "px-3 text-left"} ${
              active === key
                ? "bg-[rgba(50,215,186,0.12)] text-(--live) shadow-[inset_3px_0_0_0_var(--live)]"
                : "bg-transparent text-(--muted) hover:bg-[rgba(142,163,179,0.08)] hover:text-(--text)"
            }`}
            onClick={() => {
              onChangeActive(key);
              // Close drawer on mobile after clicking a nav item
              onCloseDrawer?.();
            }}
          >
            {/* Icon and label share one clickable hit zone to improve sidebar scan efficiency. */}
            <span className={`flex items-center ${showCentered ? "justify-center" : "gap-2.5"}`}>
              <Icon width="20" height="20" className="shrink-0" />
              {showLabels ? <span>{t(label)}</span> : null}
            </span>
          </button>
        </div>
      ))}
    </aside>
  );
}
