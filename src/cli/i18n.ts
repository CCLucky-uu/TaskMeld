import i18next from "i18next";

import zhCli from "./locales/zh.json";
import enCli from "./locales/en.json";

i18next.init({
  lng: process.env.TASKMELD_LOCALE ?? "zh",
  resources: {
    zh: { cli: zhCli },
    en: { cli: enCli },
  },
  defaultNS: "cli",
  fallbackLng: "zh",
  interpolation: { escapeValue: false },
});

export const t = i18next.t.bind(i18next);
