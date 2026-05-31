import type { ComponentType } from "react";

export const NAV_KEYS = ["overview", "agents", "pipeline", "pipelineRuns", "artifacts", "logs"] as const;
export type NavKey = (typeof NAV_KEYS)[number];

export type NavItem = {
  key: NavKey;
  label: string;
  icon: ComponentType<{
    width?: string;
    height?: string;
    className?: string;
  }>;
};
