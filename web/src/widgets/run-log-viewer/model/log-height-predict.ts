import { layout, prepare } from "@chenglou/pretext";
import i18next from "i18next";

const TEXT_FONT = '13px "JetBrains Mono", monospace';
const TEXT_LINE_HEIGHT = 19;
const ROW_CHROME_HEIGHT = 54;
const DETAIL_CHROME_HEIGHT = 96;
const MIN_ROW_HEIGHT = 72;
const MAX_DETAIL_HEIGHT = 420;
const ROW_CACHE = new Map<string, number>();
const DETAIL_CACHE = new Map<string, number>();

const normalizeText = (text: string) => text.replace(/\t/g, "  ").trim() || "-";

const predictLines = (text: string, width: number) => {
  const prepared = prepare(normalizeText(text), TEXT_FONT, { whiteSpace: "pre-wrap" });
  return Math.max(1, layout(prepared, Math.max(120, width), TEXT_LINE_HEIGHT).lineCount);
};

export const predictRunLogRowHeight = (text: string, width: number) => {
  const key = `${width}::${text}`;
  const cached = ROW_CACHE.get(key);
  if (cached !== undefined) return cached;
  // The log list only shows summary text; using pretext for height estimation reduces first-paint jitter after paging.
  const predicted = Math.max(MIN_ROW_HEIGHT, ROW_CHROME_HEIGHT + predictLines(text, width) * TEXT_LINE_HEIGHT);
  ROW_CACHE.set(key, predicted);
  return predicted;
};

export const stringifyRunLogDetail = (detail: unknown) => {
  if (detail === undefined) return i18next.t("log:noDetail");
  if (typeof detail === "string") return detail;
  try {
    return JSON.stringify(detail, null, 2);
  } catch {
    return String(detail);
  }
};

export const predictRunLogDetailHeight = (detail: unknown, width: number) => {
  const text = stringifyRunLogDetail(detail);
  const key = `${width}::${text}`;
  const cached = DETAIL_CACHE.get(key);
  if (cached !== undefined) return cached;
  // The detail area is plain-text JSON; reuse pretext for estimation to avoid height flicker when toggling the detail drawer.
  const predicted = Math.min(MAX_DETAIL_HEIGHT, DETAIL_CHROME_HEIGHT + predictLines(text, width) * TEXT_LINE_HEIGHT);
  DETAIL_CACHE.set(key, predicted);
  return predicted;
};
