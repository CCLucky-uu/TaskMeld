import BotIcon from "@iconify-react/lucide/bot";
import BoxesIcon from "@iconify-react/lucide/boxes";
import FileTextIcon from "@iconify-react/lucide/file-text";
import HistoryIcon from "@iconify-react/lucide/history";
import LayoutDashboardIcon from "@iconify-react/lucide/layout-dashboard";
import WorkflowIcon from "@iconify-react/lucide/workflow";
import type { NavItem } from "../../../widgets/nav-panel/model/navItem";

export const controlPlaneNavItems: NavItem[] = [
  { key: "overview", label: "nav.overview", icon: LayoutDashboardIcon },
  { key: "agents", label: "nav.agents", icon: BotIcon },
  { key: "pipeline", label: "nav.pipeline", icon: WorkflowIcon },
  { key: "pipelineRuns", label: "nav.pipelineRuns", icon: HistoryIcon },
  { key: "artifacts", label: "nav.artifacts", icon: BoxesIcon },
  { key: "logs", label: "nav.logs", icon: FileTextIcon },
];
