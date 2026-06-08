import { actionRowClassName, panelHeaderClassName } from "../../../shared/ui/panelClasses";

// The right detail panel must first lock into the available height of the main content area, then delegate scrolling to itself.
// Otherwise, when detail content grows tall, the entire grid row stretches, pulling the middle pipeline area's scroll boundary along with it.
export const detailPanelShellClassName = "h-full min-h-0 min-w-0 overflow-hidden";
export const detailPanelClassName =
  "detail-panel grid h-full min-h-0 content-start gap-[10px] overflow-x-hidden overflow-y-auto p-3";
export const detailPanelHeadClassName = panelHeaderClassName;
export const detailPanelTitleClassName = "shrink whitespace-nowrap";
export const detailPanelStatusClassName =
  "detail-head-status ml-auto flex min-w-0 flex-nowrap items-center justify-end gap-2";
export const detailPanelActionRowClassName = actionRowClassName;
