import { useCallback, useEffect, useState } from "react";
import { ControlPlanePage } from "../pages/control-plane/ui/ControlPlanePage";

const PIPELINE_ROUTE_PATH = "/pipeline";
const LOG_ROUTE_PATH = "/logs";
const AGENTS_ROUTE_PATH = "/agents";
const ARTIFACTS_ROUTE_PATH = "/artifacts";
const OVERVIEW_ROUTE_PATH = "/overview";
const LANDING_ROUTE_PATH = "/";

const normalizePathname = (pathname: string): string => {
  const normalized = pathname.trim();
  if (!normalized || normalized === "/") return LANDING_ROUTE_PATH;
  if (normalized.startsWith(OVERVIEW_ROUTE_PATH)) return OVERVIEW_ROUTE_PATH;
  if (normalized.startsWith(AGENTS_ROUTE_PATH)) return AGENTS_ROUTE_PATH;
  if (normalized.startsWith(PIPELINE_ROUTE_PATH)) return PIPELINE_ROUTE_PATH;
  if (normalized.startsWith(ARTIFACTS_ROUTE_PATH)) return ARTIFACTS_ROUTE_PATH;
  if (normalized.startsWith(LOG_ROUTE_PATH)) return LOG_ROUTE_PATH;
  return LANDING_ROUTE_PATH;
};

export default function App() {
  const [currentLocation, setCurrentLocation] = useState(() => ({
    path: normalizePathname(window.location.pathname),
    search: window.location.search,
  }));

  useEffect(() => {
    const handlePopState = () => {
      setCurrentLocation({
        path: normalizePathname(window.location.pathname),
        search: window.location.search,
      });
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const navigate = useCallback((targetPath: string, search = "") => {
    const nextPath = normalizePathname(targetPath);
    const normalizedSearch = search.startsWith("?") || !search ? search : `?${search}`;
    window.history.pushState({}, "", `${nextPath}${normalizedSearch}`);
    setCurrentLocation({ path: nextPath, search: normalizedSearch });
  }, []);

  const focusPipelineId =
    currentLocation.path === PIPELINE_ROUTE_PATH
      ? new URLSearchParams(currentLocation.search).get("pipeline")?.trim() ?? ""
      : "";

  const handleNavigateByNav = useCallback(
    (label: string, pipelineId?: string) => {
      if (label === "总览") {
        navigate(OVERVIEW_ROUTE_PATH);
        return;
      }
      if (label === "流水线") {
        navigate(
          PIPELINE_ROUTE_PATH,
          pipelineId?.trim() ? `pipeline=${encodeURIComponent(pipelineId.trim())}` : "",
        );
        return;
      }
      if (label === "智能体") {
        navigate(AGENTS_ROUTE_PATH);
        return;
      }
      if (label === "产物") {
        navigate(ARTIFACTS_ROUTE_PATH);
        return;
      }
      if (label === "日志") {
        navigate(LOG_ROUTE_PATH);
        return;
      }
      navigate(OVERVIEW_ROUTE_PATH);
    },
    [navigate],
  );

  let content: React.ReactNode;

  if (currentLocation.path === PIPELINE_ROUTE_PATH) {
    content = (
      <ControlPlanePage
        pageRoute="pipeline"
        initialActive="流水线"
        onNavigateByNav={handleNavigateByNav}
        onNavigateHome={() => navigate(LANDING_ROUTE_PATH)}
        focusPipelineId={focusPipelineId || undefined}
      />
    );
  } else if (currentLocation.path === LOG_ROUTE_PATH) {
    content = (
      <ControlPlanePage
        pageRoute="logs"
        initialActive="日志"
        onNavigateByNav={handleNavigateByNav}
        onNavigateHome={() => navigate(LANDING_ROUTE_PATH)}
      />
    );
  } else if (currentLocation.path === AGENTS_ROUTE_PATH) {
    content = (
      <ControlPlanePage
        pageRoute="agents"
        initialActive="智能体"
        onNavigateByNav={handleNavigateByNav}
        onNavigateHome={() => navigate(LANDING_ROUTE_PATH)}
      />
    );
  } else if (currentLocation.path === ARTIFACTS_ROUTE_PATH) {
    content = (
      <ControlPlanePage
        pageRoute="artifacts"
        initialActive="产物"
        onNavigateByNav={handleNavigateByNav}
        onNavigateHome={() => navigate(LANDING_ROUTE_PATH)}
      />
    );
  } else if (currentLocation.path === OVERVIEW_ROUTE_PATH) {
    content = (
      <ControlPlanePage
        pageRoute="home"
        initialActive="总览"
        onNavigateByNav={handleNavigateByNav}
        onNavigateHome={() => navigate(LANDING_ROUTE_PATH)}
      />
    );
  } else {
    content = (
      <ControlPlanePage
        pageRoute="home"
        initialActive="总览"
        onNavigateByNav={handleNavigateByNav}
        onNavigateHome={() => navigate(OVERVIEW_ROUTE_PATH)}
      />
    );
  }

  return (
    <>
      {/* 键盘导航跳过链接：仅聚焦时可见 */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-(--z-tooltip) focus:inline-flex focus:h-10 focus:items-center focus:border focus:border-[var(--live)] focus:bg-[var(--panel)] focus:px-4 focus:text-sm focus:font-medium focus:text-[var(--live)] focus:shadow-lg focus:outline-none"
      >
        跳到主内容
      </a>
      {content}
    </>
  );
}
