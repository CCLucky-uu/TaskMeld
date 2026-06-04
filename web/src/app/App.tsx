import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ControlPlanePage } from "../pages/control-plane/ui/ControlPlanePage";
import type { NavKey } from "../widgets/nav-panel/model/navItem";
import { WevraChatPanel } from "../widgets/wevra-panel/ui/WevraChatPanel";
import i18n from "../shared/i18n";

const PIPELINE_ROUTE_PATH = "/pipeline";
const LOG_ROUTE_PATH = "/logs";
const AGENTS_ROUTE_PATH = "/agents";
const ARTIFACTS_ROUTE_PATH = "/artifacts";
const OVERVIEW_ROUTE_PATH = "/overview";
const SETTINGS_ROUTE_PATH = "/settings";
const LANDING_ROUTE_PATH = "/";

const normalizePathname = (pathname: string): string => {
  const normalized = pathname.trim();
  if (!normalized || normalized === "/") return LANDING_ROUTE_PATH;
  if (normalized.startsWith(OVERVIEW_ROUTE_PATH)) return OVERVIEW_ROUTE_PATH;
  if (normalized.startsWith(AGENTS_ROUTE_PATH)) return AGENTS_ROUTE_PATH;
  if (normalized.startsWith(PIPELINE_ROUTE_PATH)) return PIPELINE_ROUTE_PATH;
  if (normalized.startsWith(ARTIFACTS_ROUTE_PATH)) return ARTIFACTS_ROUTE_PATH;
  if (normalized.startsWith(LOG_ROUTE_PATH)) return LOG_ROUTE_PATH;
  if (normalized.startsWith(SETTINGS_ROUTE_PATH)) return SETTINGS_ROUTE_PATH;
  return LANDING_ROUTE_PATH;
};

export default function App() {
  const { t } = useTranslation("nav");
  const [currentLocation, setCurrentLocation] = useState(() => ({
    path: normalizePathname(window.location.pathname),
    search: window.location.search,
  }));

  // Sync <html lang> with i18n locale for screen readers and CSS :lang() selectors
  useEffect(() => {
    document.documentElement.lang = i18n.language === "zh" ? "zh-CN" : i18n.language;
  }, [i18n.language]);

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

  const ROUTE_MAP: Record<NavKey, string> = {
    overview: OVERVIEW_ROUTE_PATH,
    agents: AGENTS_ROUTE_PATH,
    pipeline: PIPELINE_ROUTE_PATH,
    pipelineRuns: OVERVIEW_ROUTE_PATH,
    artifacts: ARTIFACTS_ROUTE_PATH,
    logs: LOG_ROUTE_PATH,
    settings: SETTINGS_ROUTE_PATH,
  };

  const handleNavigateByNav = useCallback(
    (label: NavKey, pipelineId?: string) => {
      const path = ROUTE_MAP[label] ?? OVERVIEW_ROUTE_PATH;
      const query = label === "pipeline" && pipelineId?.trim()
        ? `pipeline=${encodeURIComponent(pipelineId.trim())}`
        : "";
      navigate(path, query);
    },
    [navigate],
  );

  let content: React.ReactNode;

  if (currentLocation.path === PIPELINE_ROUTE_PATH) {
    content = (
      <ControlPlanePage
        pageRoute="pipeline"
        initialActive="pipeline"
        onNavigateByNav={handleNavigateByNav}
        onNavigateHome={() => navigate(LANDING_ROUTE_PATH)}
        focusPipelineId={focusPipelineId || undefined}
      />
    );
  } else if (currentLocation.path === LOG_ROUTE_PATH) {
    content = (
      <ControlPlanePage
        pageRoute="logs"
        initialActive="logs"
        onNavigateByNav={handleNavigateByNav}
        onNavigateHome={() => navigate(LANDING_ROUTE_PATH)}
      />
    );
  } else if (currentLocation.path === AGENTS_ROUTE_PATH) {
    content = (
      <ControlPlanePage
        pageRoute="agents"
        initialActive="agents"
        onNavigateByNav={handleNavigateByNav}
        onNavigateHome={() => navigate(LANDING_ROUTE_PATH)}
      />
    );
  } else if (currentLocation.path === ARTIFACTS_ROUTE_PATH) {
    content = (
      <ControlPlanePage
        pageRoute="artifacts"
        initialActive="artifacts"
        onNavigateByNav={handleNavigateByNav}
        onNavigateHome={() => navigate(LANDING_ROUTE_PATH)}
      />
    );
  } else if (currentLocation.path === OVERVIEW_ROUTE_PATH) {
    content = (
      <ControlPlanePage
        pageRoute="home"
        initialActive="overview"
        onNavigateByNav={handleNavigateByNav}
        onNavigateHome={() => navigate(LANDING_ROUTE_PATH)}
      />
    );
  } else if (currentLocation.path === SETTINGS_ROUTE_PATH) {
    content = (
      <ControlPlanePage
        pageRoute="settings"
        initialActive="settings"
        onNavigateByNav={handleNavigateByNav}
        onNavigateHome={() => navigate(LANDING_ROUTE_PATH)}
      />
    );
  } else {
    content = (
      <ControlPlanePage
        pageRoute="home"
        initialActive="overview"
        onNavigateByNav={handleNavigateByNav}
        onNavigateHome={() => navigate(OVERVIEW_ROUTE_PATH)}
      />
    );
  }

  return (
    <>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-(--z-tooltip) focus:inline-flex focus:h-10 focus:items-center focus:border focus:border-[var(--live)] focus:bg-[var(--panel)] focus:px-4 focus:text-sm focus:font-medium focus:text-[var(--live)] focus:shadow-lg focus:outline-none"
      >
        {t("skipToContent")}
      </a>
      {content}
      <WevraChatPanel />
    </>
  );
}
