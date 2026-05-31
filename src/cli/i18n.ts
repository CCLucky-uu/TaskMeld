import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import i18next from "i18next";

import zhCli from "./locales/zh.json";
import enCli from "./locales/en.json";

const resolveLocale = (): string => {
  // 1. env override
  if (process.env.TASKMELD_LOCALE) return process.env.TASKMELD_LOCALE.trim();

  // 2. config.json
  try {
    const configPath = join(homedir(), ".taskmeld", "config.json");
    const raw = readFileSync(configPath, "utf8");
    const config = JSON.parse(raw) as { locale?: string };
    if (config.locale && ["zh", "en"].includes(config.locale)) {
      return config.locale;
    }
  } catch {
    // config file not found or invalid, fall through
  }

  return "en";
};

i18next.init({
  lng: resolveLocale(),
  resources: {
    zh: { cli: zhCli },
    en: { cli: enCli },
  },
  defaultNS: "cli",
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

export const t = i18next.t.bind(i18next);
