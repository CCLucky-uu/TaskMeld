import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import zhCommon from "./locales/zh/common.json";
import zhNav from "./locales/zh/nav.json";
import zhOverview from "./locales/zh/overview.json";
import zhAgent from "./locales/zh/agent.json";
import zhScheduler from "./locales/zh/scheduler.json";
import zhTimeline from "./locales/zh/timeline.json";
import zhLog from "./locales/zh/log.json";
import zhArtifact from "./locales/zh/artifact.json";
import zhSession from "./locales/zh/session.json";
import zhNodeDetail from "./locales/zh/node-detail.json";
import zhDispatch from "./locales/zh/dispatch.json";
import zhModal from "./locales/zh/modal.json";
import zhPipeline from "./locales/zh/pipeline.json";

import enCommon from "./locales/en/common.json";
import enNav from "./locales/en/nav.json";
import enOverview from "./locales/en/overview.json";
import enAgent from "./locales/en/agent.json";
import enScheduler from "./locales/en/scheduler.json";
import enTimeline from "./locales/en/timeline.json";
import enLog from "./locales/en/log.json";
import enArtifact from "./locales/en/artifact.json";
import enSession from "./locales/en/session.json";
import enNodeDetail from "./locales/en/node-detail.json";
import enDispatch from "./locales/en/dispatch.json";
import enModal from "./locales/en/modal.json";
import enPipeline from "./locales/en/pipeline.json";

export const defaultLocale = "zh";
export const supportedLocales = ["zh", "en"] as const;

const resources = {
  zh: {
    common: zhCommon,
    nav: zhNav,
    overview: zhOverview,
    agent: zhAgent,
    scheduler: zhScheduler,
    timeline: zhTimeline,
    log: zhLog,
    artifact: zhArtifact,
    session: zhSession,
    "node-detail": zhNodeDetail,
    dispatch: zhDispatch,
    modal: zhModal,
    pipeline: zhPipeline,
  },
  en: {
    common: enCommon,
    nav: enNav,
    overview: enOverview,
    agent: enAgent,
    scheduler: enScheduler,
    timeline: enTimeline,
    log: enLog,
    artifact: enArtifact,
    session: enSession,
    "node-detail": enNodeDetail,
    dispatch: enDispatch,
    modal: enModal,
    pipeline: enPipeline,
  },
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    defaultNS: "common",
    fallbackLng: defaultLocale,
    interpolation: { escapeValue: false },
    detection: {
      order: ["querystring", "localStorage", "navigator"],
      lookupQuerystring: "lng",
      lookupLocalStorage: "taskmeld-locale",
      caches: ["localStorage"],
    },
  });

export default i18n;
