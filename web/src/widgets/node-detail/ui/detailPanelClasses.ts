import { actionRowClassName, panelHeaderClassName } from "../../../shared/ui/panelClasses";

// 右侧详情栏必须先锁定在主内容区可用高度内，再把滚动交给自身处理。
// 否则详情内容一多就会把整行 grid 撑高，连带影响中间流水线区域的滚动边界。
export const detailPanelShellClassName = "h-full min-h-0 min-w-0 overflow-hidden";
export const detailPanelClassName = "detail-panel grid h-full min-h-0 content-start gap-[10px] overflow-x-hidden overflow-y-auto p-3";
export const detailPanelHeadClassName = panelHeaderClassName;
export const detailPanelTitleClassName = "shrink whitespace-nowrap";
export const detailPanelStatusClassName = "detail-head-status ml-auto flex min-w-0 flex-nowrap items-center justify-end gap-2";
export const detailPanelActionRowClassName = actionRowClassName;
