import BotIcon from "@iconify-react/lucide/bot";
import BoxesIcon from "@iconify-react/lucide/boxes";
import FileTextIcon from "@iconify-react/lucide/file-text";
import HistoryIcon from "@iconify-react/lucide/history";
import LayoutDashboardIcon from "@iconify-react/lucide/layout-dashboard";
import WorkflowIcon from "@iconify-react/lucide/workflow";
import type { NavItem } from "../../../widgets/nav-panel/model/navItem";

// 侧边导航配置独立维护，避免页面组件里混入图标选择逻辑。
export const controlPlaneNavItems: NavItem[] = [
  { label: "总览", icon: LayoutDashboardIcon },
  { label: "智能体", icon: BotIcon },
  { label: "流水线", icon: WorkflowIcon },
  { label: "运行记录", icon: HistoryIcon },
  { label: "产物", icon: BoxesIcon },
  { label: "日志", icon: FileTextIcon },
];
