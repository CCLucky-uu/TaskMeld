/* 表单控件统一从这里出样式：
   业务组件只允许在外层补尺寸/布局，不再各自覆盖颜色、边框、hover、focus。
   否则同样是输入框，会在智能体、流水线、弹窗里长成三套，后续维护会越来越散。 */
export const controlInputClassName =
  "block w-full min-w-0 max-w-full overflow-auto border border-[#29414f] bg-[rgba(18,31,38,0.9)] px-2 py-2 text-[var(--text)] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] outline-none transition-[border-color,background-color,box-shadow] focus-visible:border-[#3b5868] focus-visible:bg-[rgba(24,39,47,0.92)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--live)] focus-visible:outline-offset-1";
export const controlInputMonoClassName =
  "block w-full min-w-0 max-w-full overflow-auto border border-[#29414f] bg-[rgba(18,31,38,0.9)] px-2 py-2 text-[var(--text)] font-[JetBrains_Mono,monospace] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] outline-none transition-[border-color,background-color,box-shadow] focus-visible:border-[#3b5868] focus-visible:bg-[rgba(24,39,47,0.92)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--live)] focus-visible:outline-offset-1";
// 当输入框本身放在二级容器里时，需要再压深一层，避免和容器底色糊在一起。
export const controlInputElevatedClassName =
  "block w-full min-w-0 max-w-full overflow-auto border border-[#29414f] bg-[rgba(12,21,27,0.96)] px-2 py-2 text-[var(--text)] shadow-[inset_0_1px_0_rgba(255,255,255,0.025)] outline-none transition-[border-color,background-color,box-shadow] focus-visible:border-[#3b5868] focus-visible:bg-[rgba(16,27,34,0.98)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--live)] focus-visible:outline-offset-1";
export const controlInputElevatedMonoClassName =
  "block w-full min-w-0 max-w-full overflow-auto border border-[#29414f] bg-[rgba(12,21,27,0.96)] px-2 py-2 text-[var(--text)] font-[JetBrains_Mono,monospace] shadow-[inset_0_1px_0_rgba(255,255,255,0.025)] outline-none transition-[border-color,background-color,box-shadow] focus-visible:border-[#3b5868] focus-visible:bg-[rgba(16,27,34,0.98)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--live)] focus-visible:outline-offset-1";
export const controlSingleLineClassName =
  "block w-full min-w-0 max-w-full overflow-hidden border border-[#29414f] bg-[rgba(18,31,38,0.9)] px-2 py-2 text-ellipsis whitespace-nowrap text-[var(--text)] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] outline-none transition-[border-color,background-color,box-shadow] focus-visible:border-[#3b5868] focus-visible:bg-[rgba(24,39,47,0.92)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--live)] focus-visible:outline-offset-1";
export const controlSingleLineMonoClassName =
  "block w-full min-w-0 max-w-full overflow-hidden border border-[#29414f] bg-[rgba(18,31,38,0.9)] px-2 py-2 text-ellipsis whitespace-nowrap text-[var(--text)] font-[JetBrains_Mono,monospace] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] outline-none transition-[border-color,background-color,box-shadow] focus-visible:border-[#3b5868] focus-visible:bg-[rgba(24,39,47,0.92)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--live)] focus-visible:outline-offset-1";
export const controlTextAreaClassName =
  "block w-full min-w-full max-w-full resize-y overflow-auto overflow-wrap-anywhere break-words border border-[#29414f] bg-[rgba(18,31,38,0.9)] px-2 py-2 text-[var(--text)] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] outline-none transition-[border-color,background-color,box-shadow] focus-visible:border-[#3b5868] focus-visible:bg-[rgba(24,39,47,0.92)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--live)] focus-visible:outline-offset-1";
export const controlTextAreaMonoClassName =
  "block w-full min-w-full max-w-full resize-y overflow-auto overflow-wrap-anywhere break-words border border-[#29414f] bg-[rgba(18,31,38,0.9)] px-2 py-2 text-[var(--text)] font-[JetBrains_Mono,monospace] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] outline-none transition-[border-color,background-color,box-shadow] focus-visible:border-[#3b5868] focus-visible:bg-[rgba(24,39,47,0.92)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--live)] focus-visible:outline-offset-1";

export const modalMaskBaseClassName =
  "fixed inset-0 z-[var(--z-modal-mask)] bg-[rgba(5,10,14,0.62)] transition-opacity duration-200";
export const modalMaskOpenClassName = "pointer-events-auto opacity-100";
export const modalMaskClosedClassName = "pointer-events-none opacity-0";

export const modalFrameBaseClassName =
  "fixed inset-0 z-[var(--z-modal)] grid place-items-center transition-opacity duration-200";
export const modalFrameOpenClassName = "pointer-events-auto opacity-100";
export const modalFrameClosedClassName = "pointer-events-none opacity-0";

export const modalPanelBaseClassName =
  "overflow-auto border border-[var(--line)] bg-[linear-gradient(180deg,var(--panel)_0%,var(--panel-2)_100%)] ";
export const modalPanelDefaultSizeClassName =
  "overflow-auto border border-[var(--line)] bg-[linear-gradient(180deg,var(--panel)_0%,var(--panel-2)_100%)] p-[14px] max-h-[88vh] w-[min(760px,94vw)] max-[760px]:h-screen max-[760px]:max-h-screen max-[760px]:w-screen";

export const drawerCloseClassName =
  "inline-flex h-8 w-8 appearance-none items-center justify-center rounded-none border-0 bg-transparent p-0 text-[var(--text)] shadow-none outline-none transition-[background-color,color] hover:bg-[rgba(142,163,179,0.08)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--live)] focus-visible:outline-offset-1";
export const modalSublineClassName = "m-0 mx-3 mb-[10px] text-xs text-[var(--muted)]";

/** 表单控件错误态覆写：追加到 controlInputClassName 后替换边框和底色 */
export const controlInputErrorOverrideClassName =
  "!border-[var(--bad)] !bg-[rgba(255,107,107,0.06)] focus-visible:!border-[var(--bad)] focus-visible:!outline-[var(--bad)]";

/** 表单字段错误提示文字 */
export const fieldErrorClassName = "mt-1 block text-xs text-[var(--bad)]";
