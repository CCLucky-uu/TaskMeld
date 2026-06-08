import { layout, prepare } from "@chenglou/pretext";

const MESSAGE_FONT = '13px "Space Grotesk", sans-serif';
const MESSAGE_LINE_HEIGHT = 19;
const TOOL_FONT = '12.5px "JetBrains Mono", monospace';
const TOOL_LINE_HEIGHT = 18;
const MIN_BUBBLE_WIDTH = 240;
const MAX_BUBBLE_WIDTH = 780;
const BUBBLE_WIDTH_RATIO = 0.92;
const BUBBLE_HORIZONTAL_GUTTER = 22;
const BUBBLE_STATIC_CHROME_HEIGHT = 36;
const TOOL_MIN_WIDTH = 180;
const TOOL_COLLAPSED_ROW_HEIGHT = 34;
const TOOL_SUBROW_HEIGHT = 34;
const TOOL_COMMAND_CHROME_HEIGHT = 18;
const TOOL_OUTPUT_CHROME_HEIGHT = 18;
const TOOL_EXPANDED_EDGE_CHROME_HEIGHT = 2;
const TOOL_COMMAND_MAX_HEIGHT = 220;
const TOOL_OUTPUT_MAX_HEIGHT = 260;

type PredictOptions = {
  viewportWidth: number;
};

const heightCache = new Map<string, number>();
const toolHeightCache = new Map<string, number>();

const countMatches = (text: string, regex: RegExp): number => {
  let count = 0;
  for (const _ of text.matchAll(regex)) count += 1;
  return count;
};

const normalizeMarkdownForPrediction = (markdown: string): string => {
  const withoutFences = markdown.replace(/```[\s\S]*?```/g, "\n[code block]\n");
  return withoutFences
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\s{0,3}(#{1,6})\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s{0,3}(?:[-*+]|\d+\.)\s+/gm, "")
    .replace(/\*\*|__|\*|_|~~/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

const getBubbleContentWidth = ({ viewportWidth }: PredictOptions): number => {
  const outerWidth = Math.min(
    MAX_BUBBLE_WIDTH,
    Math.max(MIN_BUBBLE_WIDTH, Math.floor(viewportWidth * BUBBLE_WIDTH_RATIO)),
  );
  return Math.max(120, outerWidth - BUBBLE_HORIZONTAL_GUTTER);
};

const getToolOuterWidth = ({ viewportWidth }: PredictOptions): number =>
  Math.max(TOOL_MIN_WIDTH, Math.min(MAX_BUBBLE_WIDTH, Math.floor(viewportWidth * BUBBLE_WIDTH_RATIO)));

const getToolContentWidth = (options: PredictOptions): number => Math.max(120, getToolOuterWidth(options) - 20);

const getMarkdownBlockBonus = (markdown: string): number => {
  const headingCount = countMatches(markdown, /^\s{0,3}#{1,6}\s+/gm);
  const listCount = countMatches(markdown, /^\s{0,3}(?:[-*+]|\d+\.)\s+/gm);
  const blockQuoteCount = countMatches(markdown, /^\s{0,3}>\s?/gm);
  const codeFenceCount = countMatches(markdown, /```[\s\S]*?```/g);
  const hardBreakCount = countMatches(markdown, /\n{2,}/g);
  return headingCount * 8 + listCount * 4 + blockQuoteCount * 6 + codeFenceCount * 12 + hardBreakCount * 3;
};

export const predictMessageMinHeight = (markdown: string, options: PredictOptions): number => {
  const normalized = normalizeMarkdownForPrediction(markdown);
  const contentWidth = getBubbleContentWidth(options);
  const key = `${contentWidth}::${normalized}`;
  const cached = heightCache.get(key);
  if (cached !== undefined) return cached;

  if (!normalized) {
    const emptyHeight = BUBBLE_STATIC_CHROME_HEIGHT + MESSAGE_LINE_HEIGHT;
    heightCache.set(key, emptyHeight);
    return emptyHeight;
  }

  const prepared = prepare(normalized, MESSAGE_FONT, { whiteSpace: "pre-wrap" });
  const { lineCount } = layout(prepared, contentWidth, MESSAGE_LINE_HEIGHT);
  const textHeight = Math.max(1, lineCount) * MESSAGE_LINE_HEIGHT;
  const predicted = BUBBLE_STATIC_CHROME_HEIGHT + textHeight + getMarkdownBlockBonus(markdown);
  const clamped = Math.max(BUBBLE_STATIC_CHROME_HEIGHT + MESSAGE_LINE_HEIGHT, predicted);
  heightCache.set(key, clamped);
  return clamped;
};

type PredictToolOptions = PredictOptions & {
  commandText: string;
  outputText: string;
  toolCollapsed: boolean;
  toolOutputCollapsed: boolean;
};

export const predictToolCardMinHeight = ({
  viewportWidth,
  commandText,
  outputText,
  toolCollapsed,
  toolOutputCollapsed,
}: PredictToolOptions): number => {
  if (toolCollapsed) return TOOL_COLLAPSED_ROW_HEIGHT;

  const contentWidth = getToolContentWidth({ viewportWidth });
  const key = [contentWidth, toolCollapsed ? "1" : "0", toolOutputCollapsed ? "1" : "0", commandText, outputText].join(
    "::",
  );
  const cached = toolHeightCache.get(key);
  if (cached !== undefined) return cached;

  const normalizedCommand = commandText.trim() || "-";
  const preparedCommand = prepare(normalizedCommand, TOOL_FONT, { whiteSpace: "pre-wrap" });
  const commandLineCount = Math.max(1, layout(preparedCommand, contentWidth, TOOL_LINE_HEIGHT).lineCount);
  const commandHeight = Math.min(
    TOOL_COMMAND_MAX_HEIGHT,
    commandLineCount * TOOL_LINE_HEIGHT + TOOL_COMMAND_CHROME_HEIGHT,
  );

  let total = TOOL_COLLAPSED_ROW_HEIGHT + commandHeight + TOOL_SUBROW_HEIGHT + TOOL_EXPANDED_EDGE_CHROME_HEIGHT;

  if (!toolOutputCollapsed) {
    const normalizedOutput = outputText.trim() || "...";
    const preparedOutput = prepare(normalizedOutput, TOOL_FONT, { whiteSpace: "pre-wrap" });
    const outputLineCount = Math.max(1, layout(preparedOutput, contentWidth, TOOL_LINE_HEIGHT).lineCount);
    const outputHeight = Math.min(
      TOOL_OUTPUT_MAX_HEIGHT,
      outputLineCount * TOOL_LINE_HEIGHT + TOOL_OUTPUT_CHROME_HEIGHT,
    );
    total += outputHeight;
  }

  toolHeightCache.set(key, total);
  return total;
};
