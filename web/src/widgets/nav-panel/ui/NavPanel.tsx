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
  /** 移动端浮层抽屉关闭回调 */
  onCloseDrawer?: () => void;
  /** 渲染模式：inline=嵌入布局（桌面端），overlay=浮层抽屉（移动端） */
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
  // 桌面端：collapsed 控制宽/窄；移动端浮层：始终展示完整内容，collapsed 控制滑入/滑出
  const showLabels = isOverlay ? true : !collapsed;
  const showCentered = isOverlay ? false : collapsed;

  const asideClassName = isOverlay
    ? `fixed left-0 top-0 bottom-0 z-50 w-52 bg-[var(--bg)] border-r border-[var(--line)] transition-transform duration-300 ease-in-out flex min-h-0 flex-col overflow-auto ${
        collapsed ? "-translate-x-full" : "translate-x-0"
      }`
    : "flex min-h-0 flex-col overflow-auto border-r border-[var(--line)]";

  return (
    <aside className={asideClassName}>
      {/* 品牌信息放到侧边栏顶部，和导航形成一个稳定的起点区域。 */}
      <button
        className={`m-0 flex w-full cursor-pointer items-center border-0 border-b border-(--line) bg-transparent px-3 py-2.5 min-h-[60px] text-left font-inherit text-inherit leading-inherit transition-[background-color] hover:bg-[rgba(142,163,179,0.06)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--live)] focus-visible:outline-offset-[-2px] ${showCentered ? "justify-center" : "gap-2"}`}
        type="button"
        onClick={() => {
          // 主页（/）和总览（/overview）语义分离：优先跳主页，未提供时回退到总览。
          if (onNavigateHome) {
            onNavigateHome();
          } else {
            onChangeActive("overview");
          }
          // 移动端浮层点击后关闭抽屉
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
              // 移动端浮层点击导航项后关闭抽屉
              onCloseDrawer?.();
            }}
          >
            {/* 图标和文案保持同一点击热区，提升侧边导航扫描效率。 */}
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
