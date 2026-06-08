import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

export const defaultLocale = "en";
export const supportedLocales = ["zh", "en"] as const;

const namespaceNames = [
  "common",
  "nav",
  "overview",
  "agent",
  "timeline",
  "log",
  "artifact",
  "session",
  "node-detail",
  "dispatch",
  "modal",
  "pipeline",
] as const;

type Namespace = (typeof namespaceNames)[number];

// Build-time: Vite resolves import.meta.glob to a map of lazy chunks, one per file.
// At runtime only the locale in use is loaded — the other 12 JSON files stay as
// separate chunks and never enter the main bundle.
const localeModules = import.meta.glob<Record<string, unknown>>("./locales/*/*.json");

/** Load a single locale's full set of namespace resources on demand. */
const loadLocaleResources = async (locale: string): Promise<Record<Namespace, Record<string, unknown>>> => {
  const resources = {} as Record<Namespace, Record<string, unknown>>;
  await Promise.all(
    namespaceNames.map(async (ns) => {
      const key = `./locales/${locale}/${ns}.json`;
      const loader = localeModules[key];
      if (loader) {
        resources[ns] = await loader();
      }
    }),
  );
  return resources;
};

// Detect the initial locale the same way i18next-browser-languagedetector does,
// but synchronously so we can start loading resources immediately.
const detectInitialLocale = (): string => {
  const qs = new URLSearchParams(window.location.search).get("lng");
  if (qs && (supportedLocales as readonly string[]).includes(qs)) return qs;
  const stored = localStorage.getItem("taskmeld-locale");
  if (stored && (supportedLocales as readonly string[]).includes(stored)) return stored;
  if (navigator.language.startsWith("zh")) return "zh";
  return defaultLocale;
};

const initialLocale = detectInitialLocale();

// Start loading the initial locale's resources immediately (does not block i18n.init).
const resourcePromise = loadLocaleResources(initialLocale);

// Init i18next synchronously with empty resources — the LanguageDetector plugin
// will set the language immediately, and resources arrive asynchronously.
i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {},
    defaultNS: "common",
    fallbackLng: defaultLocale,
    lng: initialLocale,
    interpolation: { escapeValue: false },
    detection: {
      order: ["querystring", "localStorage", "navigator"],
      lookupQuerystring: "lng",
      lookupLocalStorage: "taskmeld-locale",
      caches: ["localStorage"],
    },
  });

// Once the initial locale's resources are loaded, inject them into i18next.
// Exported as a promise so main.tsx can block React rendering until ready.
export const i18nReady = resourcePromise
  .then((resources) => {
    for (const ns of namespaceNames) {
      i18n.addResourceBundle(initialLocale, ns, resources[ns], true, true);
    }
  })
  .catch((err) => {
    console.error("Failed to load initial locale resources:", err);
  });

// When the user switches language, load the new locale on demand.
i18n.on("languageChanged", async (newLocale: string) => {
  if (!(supportedLocales as readonly string[]).includes(newLocale)) return;
  // Check if resources are already loaded (avoid double-loading)
  if (i18n.hasResourceBundle(newLocale, "common")) return;
  try {
    const resources = await loadLocaleResources(newLocale);
    for (const ns of namespaceNames) {
      i18n.addResourceBundle(newLocale, ns, resources[ns], true, true);
    }
    // Trigger re-render with the new translations
    i18n.emit("loaded");
  } catch (err) {
    console.error(`Failed to load locale resources for "${newLocale}":`, err);
  }
});

export default i18n;
