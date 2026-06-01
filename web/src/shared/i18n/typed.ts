/**
 * Type-safe translation wrappers.
 *
 * Use `useTypedTranslation(ns)` instead of `useTranslation(ns)` to get
 * compile-time validation of translation keys. Key typos become build errors
 * instead of silently returning the key string.
 *
 * Example:
 *   const { t } = useTypedTranslation("common");
 *   t("status.running");        // ✅ OK
 *   t("status.runnign");        // ❌ TS error — typo caught at build time
 */

import { useTranslation } from "react-i18next";
import type { TranslationKey, TranslationKeyMap } from "./translation-keys";

type Namespace = keyof TranslationKeyMap;

/** Extract the bare key type for a given namespace (without the "ns:" prefix). */
type BareKey<NS extends Namespace> = TranslationKeyMap[NS];

/**
 * Typed t-function: only accepts keys that exist in the given namespace.
 * Use with `useTypedTranslation` or cast from an existing `t` function.
 */
export type TypedTFunc<NS extends Namespace = never> = NS extends Namespace
  ? (key: BareKey<NS>, options?: Record<string, unknown>) => string
  : (key: TranslationKey, options?: Record<string, unknown>) => string;

/**
 * Like `useTranslation(ns)` but the returned `t()` only accepts keys that
 * actually exist in that namespace's locale JSON.
 */
export function useTypedTranslation<NS extends Namespace>(
  ns: NS,
): { t: TypedTFunc<NS>; i18n: ReturnType<typeof useTranslation>["i18n"] } {
  const { t, i18n } = useTranslation(ns);
  return { t: t as unknown as TypedTFunc<NS>, i18n };
}

/**
 * Like `useTranslation(nsArray)` but the returned `t()` accepts any
 * namespaced key (e.g. "common:status.running") from the loaded namespaces.
 */
export function useTypedTranslationMulti<NS extends Namespace>(
  ns: NS[],
): { t: TypedTFunc; i18n: ReturnType<typeof useTranslation>["i18n"] } {
  const { t, i18n } = useTranslation(ns);
  return { t: t as unknown as TypedTFunc, i18n };
}
