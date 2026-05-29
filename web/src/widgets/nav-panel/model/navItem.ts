import type { ComponentType } from "react";

export type NavItem = {
  label: string;
  icon: ComponentType<{
    width?: string;
    height?: string;
    className?: string;
  }>;
};
