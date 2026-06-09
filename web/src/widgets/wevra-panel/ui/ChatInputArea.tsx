import { useState, useRef, useCallback, useEffect } from "react";
import { wsRequest } from "../../../shared/ws-client";
import type { WevraQuestionItem } from "../../../entities/wevra";
import type { WevraModelInfo } from "../../../entities/wevra";
import type { InlineQuestionHandle } from "./InlineQuestion";
import { InlineQuestion } from "./InlineQuestion";
import SendIcon from "@iconify-react/lucide/send";
import StopIcon from "@iconify-react/lucide/square";

interface ChatInputAreaProps {
  activeId: string;
  streaming: boolean;
  isBusy: boolean;
  models: WevraModelInfo[];
  defaultModel: string;
  onDefaultModelChange: (model: string) => void;
  onConfigModalOpen: () => void;
  thinkingLevels: string[];
  thinkingLevel: string;
  onThinkingLevelChange: (level: string) => void;
  ctxRing: {
    pctDisplay: number;
    r: number;
    circumference: number;
    offset: number;
    strokeColor: string;
    contextUsed: number;
    contextMax: number;
  } | null;
  onSend: (text: string) => void;
  onAbort: () => void;
  /** Question state from parent */
  questionOpen: boolean;
  questionConvId: string;
  questionItems: WevraQuestionItem[];
  questionOtherActive: boolean;
  onQuestionAnswer: (answer: {
    answers: Array<{
      question: string;
      selected: Array<{ label: string; description: string; isCustom?: boolean }>;
    }>;
  }) => void;
  onOtherChange: (info: { active: boolean; text: string; activeTabIdx: number }) => void;
}

export function ChatInputArea({
  activeId,
  streaming,
  isBusy,
  models,
  defaultModel,
  onDefaultModelChange,
  onConfigModalOpen,
  thinkingLevels,
  thinkingLevel,
  onThinkingLevelChange,
  ctxRing,
  onSend,
  onAbort,
  questionOpen,
  questionConvId,
  questionItems,
  questionOtherActive,
  onQuestionAnswer,
  onOtherChange,
}: ChatInputAreaProps) {
  const [input, setInput] = useState("");
  const [inputExpanded, setInputExpanded] = useState(false);
  const [activeTabIdx, setActiveTabIdx] = useState(0);
  const [allAnswered, setAllAnswered] = useState(false);
  // Internal tracking of whether current tab's Other is active (for immediate textarea visibility)
  const [localOtherActive, setLocalOtherActive] = useState(false);
  const [execMode, setExecMode] = useState<"plan" | "normal" | "auto">("normal");
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [showThinkingLevels, setShowThinkingLevels] = useState(false);
  const [showContextDetail, setShowContextDetail] = useState(false);
  const [contextMax, setContextMax] = useState(0);

  const formRef = useRef<HTMLFormElement>(null);
  const questionRef = useRef<InlineQuestionHandle>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Direct ref for InlineQuestion to toggle local Other state (bypasses callback chain)
  const otherToggleRef = useRef<(active: boolean, text: string) => void>(() => {});
  const modelRef = useRef<HTMLDivElement>(null);
  const thinkingLevelRef = useRef<HTMLDivElement>(null);
  const contextRef = useRef<HTMLDivElement>(null);

  const isQuestionActive = questionOpen && questionConvId === activeId;
  // Hide textarea only when question is active AND Other is NOT selected
  const hideTextarea = isQuestionActive && !localOtherActive;

  // Auto-focus textarea when Other is activated
  useEffect(() => {
    if (isQuestionActive && localOtherActive && textareaRef.current) {
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }, [isQuestionActive, localOtherActive]);

  // Keep otherToggleRef current so InlineQuestion can call it directly
  useEffect(() => {
    otherToggleRef.current = (active: boolean, text: string) => {
      setLocalOtherActive(active);
      onOtherChange({ active, text, activeTabIdx: activeTabIdx });
    };
  });

  const send = useCallback(
    (e?: React.FormEvent) => {
      e?.preventDefault();
      const text = input.trim();
      if (!text || isBusy || !activeId) return;
      onSend(text);
      setInput("");
    },
    [input, isBusy, activeId, onSend],
  );

  const keyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
      e.preventDefault();
      send();
    },
    [send],
  );

  return (
    <form ref={formRef} onSubmit={send}>
      <div className="min-w-0 px-3 pb-3 pt-2">
        {/* Inline question */}
        {isQuestionActive && questionItems.length > 0 && (
          <InlineQuestion
            ref={questionRef}
            questions={questionItems}
            onAnswer={onQuestionAnswer}
            otherToggleRef={otherToggleRef}
            onOtherChange={(info) => {
              if (info.activeTabIdx === activeTabIdx) {
                setLocalOtherActive(info.active);
                onOtherChange(info);
              }
            }}
            onTabChange={(fromTab, toTab) => {
              setActiveTabIdx(toTab);
              if (localOtherActive && questionRef.current) {
                questionRef.current.setOtherTextForTab(fromTab, input);
              }
              const newTabState = questionRef.current?.getTabState(toTab);
              if (newTabState) {
                setLocalOtherActive(newTabState.active);
                onOtherChange({ active: newTabState.active, text: newTabState.text, activeTabIdx: toTab });
                setInput(newTabState.text || "");
              }
            }}
            onAnswersChange={(done) => setAllAnswered(done)}
            onSkip={() => {
              onQuestionAnswer({ answers: [] });
              setInput("");
            }}
          />
        )}

        {/* Textarea container */}
        <div
          className={`group relative w-full min-w-0 border bg-[#141c24] transition-[box-shadow,border-color] ${
            isQuestionActive
              ? "rounded-b border-[rgba(50,215,186,0.45)] shadow-[0_0_10px_rgba(50,215,186,0.18)]"
              : isBusy
                ? "rounded border-[rgba(50,215,186,0.45)] shadow-[0_0_10px_rgba(50,215,186,0.18)]"
                : "rounded border-[rgba(34,50,63,0.5)] shadow-[0_0_6px_rgba(50,215,186,0.08)] focus-within:border-[rgba(50,215,186,0.45)] focus-within:shadow-[0_0_10px_rgba(50,215,186,0.18)]"
          }`}
        >
          {/* Expand button */}
          <button
            type="button"
            className={`absolute top-0 right-0 z-10 h-3.5 w-3.5 bg-transparent border-none cursor-pointer p-0 ${hideTextarea ? "hidden" : ""}`}
            onClick={() => setInputExpanded((v) => !v)}
            title={inputExpanded ? "Collapse" : "Expand"}
          >
            <span
              className={`block w-2 h-2 absolute top-0.5 right-0.5 border-t-2 border-r-2 rounded-tr-sm opacity-40 hover:opacity-80 transition-opacity ${inputExpanded ? "border-(--live)" : "border-(--muted)"}`}
            />
          </button>

          {/* Textarea */}
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              if (isQuestionActive && localOtherActive) {
                questionRef.current?.setOtherText(e.target.value);
              }
            }}
            onKeyDown={keyDown}
            rows={inputExpanded ? 10 : 3}
            placeholder={isQuestionActive && localOtherActive ? "Type your custom answer..." : "Type a message..."}
            className={`block w-full resize-none border-0 bg-transparent px-2 pt-1 text-sm text-(--text) outline-none placeholder:text-[rgba(142,163,179,0.35)] scrollbar-none [&::-webkit-scrollbar]:hidden ${
              hideTextarea ? "hidden" : ""
            } ${inputExpanded ? "min-h-40 max-h-[50vh]" : "min-h-16 max-h-55"}`}
            disabled={streaming && !(isQuestionActive && localOtherActive)}
          />

          {/* Toolbar */}
          {isQuestionActive ? (
            /* Question toolbar: count | skip | confirm */
            <div className="flex items-center justify-between px-2 py-1">
              <span className="text-sm text-(--muted)">
                {questionRef.current?.answeredCount() ?? 0}/{questionItems.length} answered
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  className="h-6 px-2 text-sm rounded  bg-transparent text-(--muted) hover:bg-[rgba(142,163,179,0.1)] hover:text-(--text) cursor-pointer transition-colors"
                  onClick={() => {
                    questionRef.current?.setOtherText(input);
                    questionRef.current?.skip?.();
                    // Skip ALL questions
                    onQuestionAnswer({ answers: [] });
                    setInput("");
                  }}
                >
                  Skip
                </button>
                <button
                  type="button"
                  className={`h-6 inline-flex items-center justify-center gap-1 border-none px-2 text-sm transition-colors ${
                    !allAnswered
                      ? "text-[#3a4a58] bg-transparent cursor-default rounded"
                      : "text-white bg-[#3ac5a0] cursor-pointer hover:bg-(--live) rounded"
                  }`}
                  disabled={!allAnswered}
                  onClick={() => {
                    if (!allAnswered) return;
                    questionRef.current?.setOtherText(input);
                    setTimeout(() => questionRef.current?.submit(), 0);
                    setInput("");
                  }}
                >
                  Confirm
                </button>
              </div>
            </div>
          ) : (
            /* Normal toolbar: mode | model | thinking | context | send */
            <div className="flex items-center justify-between px-2 py-1">
              <div className="flex items-center">
                {/* Mode */}
                <button
                  type="button"
                  className={`h-6 px-1 text-sm rounded cursor-pointer transition-colors ${
                    execMode === "plan"
                      ? "text-(--live)"
                      : execMode === "auto"
                        ? "text-[#f5a623]"
                        : "text-(--muted)"
                  } hover:bg-[rgba(142,163,179,0.1)] bg-transparent border-none`}
                  onClick={async () => {
                    const modes: Array<"plan" | "normal" | "auto"> = ["plan", "normal", "auto"];
                    const next = modes[(modes.indexOf(execMode) + 1) % 3];
                    setExecMode(next);
                    if (activeId) {
                      await wsRequest("wevra.tool-preferences.set-mode", { conversationId: activeId, mode: next });
                    }
                  }}
                  title={`Mode: ${execMode} (click to cycle)`}
                >
                  {execMode}
                </button>

                {/* Model */}
                {models.some((m) => m.enabled !== false) ? (
                  <div ref={modelRef} className="relative flex items-center">
                    <span className="mx-1 h-3.5 w-px bg-[rgba(142,163,179,0.2)]" />
                    <button
                      type="button"
                      className="h-6 px-1 text-sm rounded cursor-pointer transition-colors border-none bg-transparent text-(--muted) hover:bg-[rgba(142,163,179,0.1)] truncate max-w-[160px]"
                      onClick={() => setShowModelDropdown((v) => !v)}
                      title={defaultModel || "Select model"}
                    >
                      {defaultModel ? defaultModel.split("/").pop() : "model"}
                    </button>
                    {showModelDropdown && (
                      <div className="absolute bottom-full left-0 mb-2 w-max max-w-[280px] rounded border border-(--line) bg-[#141c24] py-0.5 shadow-lg z-50">
                        {models.filter((m) => m.enabled !== false).map((m) => {
                          const key = `${m.providerId}/${m.modelId}`;
                          return (
                            <button
                              key={key}
                              type="button"
                              className={`block w-full px-3 py-1 text-left text-xs border-none cursor-pointer transition-colors truncate ${
                                key === defaultModel
                                  ? "bg-[rgba(50,215,186,0.12)] text-(--live)"
                                  : "text-(--muted) bg-transparent hover:bg-[rgba(142,163,179,0.08)] hover:text-(--text)"
                              }`}
                              onClick={async () => {
                                onDefaultModelChange(key);
                                if (m.contextWindow) setContextMax(m.contextWindow);
                                setShowModelDropdown(false);
                                if (activeId) {
                                  await wsRequest("wevra.models.set-conversation-model", {
                                    conversationId: activeId,
                                    providerId: m.providerId,
                                    modelId: m.modelId,
                                  }).catch(() => {});
                                }
                                await wsRequest("wevra.models.set-default", {
                                  providerId: m.providerId,
                                  modelId: m.modelId,
                                }).catch(() => {});
                              }}
                            >
                              {m.label || m.modelId}
                            </button>
                          );
                        })}
                        <div className="border-t border-(--line) my-0.5" />
                        <button
                          type="button"
                          className="block w-full px-3 py-1 text-left text-xs border-none cursor-pointer text-(--live) bg-transparent hover:bg-[rgba(50,215,186,0.08)]"
                          onClick={() => {
                            setShowModelDropdown(false);
                            onConfigModalOpen();
                          }}
                        >
                          + Add model
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center">
                    <span className="mx-1 h-3.5 w-px bg-[rgba(142,163,179,0.2)]" />
                    <button
                      type="button"
                      className="h-6 px-1 text-sm rounded cursor-pointer transition-colors border-none bg-transparent text-(--live) hover:bg-[rgba(50,215,186,0.08)]"
                      onClick={onConfigModalOpen}
                      title="Add a model to get started"
                    >
                      + Add model
                    </button>
                  </div>
                )}

                {/* Thinking level */}
                {thinkingLevels.length > 0 && (
                  <div ref={thinkingLevelRef} className="relative flex items-center">
                    <span className="mx-1 h-3.5 w-px bg-[rgba(142,163,179,0.2)]" />
                    <button
                      type="button"
                      className={`h-6 px-1 text-sm rounded cursor-pointer transition-colors border-none bg-transparent ${
                        thinkingLevel === "off"
                          ? "text-[#6b8499]"
                          : thinkingLevel === "max"
                            ? "text-(--live)"
                            : "text-(--muted)"
                      } hover:bg-[rgba(142,163,179,0.1)]`}
                      onClick={() => setShowThinkingLevels((v) => !v)}
                      title={`Thinking: ${thinkingLevel}`}
                    >
                      {thinkingLevel}
                    </button>
                    {showThinkingLevels && (
                      <div className="absolute bottom-full left-0 mb-2 w-max rounded border border-(--line) bg-[#141c24] py-0.5 shadow-lg z-50">
                        {thinkingLevels.map((lv) => (
                          <button
                            key={lv}
                            type="button"
                            className={`block w-full px-3 py-1 text-left text-xs border-none cursor-pointer transition-colors ${
                              lv === thinkingLevel
                                ? "bg-[rgba(50,215,186,0.12)] text-(--live)"
                                : lv === "off"
                                  ? "text-[#6b8499] bg-transparent hover:bg-[rgba(142,163,179,0.08)]"
                                  : lv === "max"
                                    ? "text-(--text) bg-transparent hover:bg-[rgba(142,163,179,0.08)]"
                                    : "text-(--muted) bg-transparent hover:bg-[rgba(142,163,179,0.08)] hover:text-(--text)"
                            }`}
                            onClick={async () => {
                              onThinkingLevelChange(lv);
                              setShowThinkingLevels(false);
                              if (activeId) {
                                await wsRequest("wevra.models.set-thinking-level", {
                                  level: lv,
                                  conversationId: activeId,
                                }).catch(() => {});
                              }
                            }}
                          >
                            {lv}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Right side: context ring + send/stop */}
              <div className="flex items-center gap-1.5">
                {ctxRing && (
                  <div ref={contextRef} className="relative">
                    <button
                      type="button"
                      className="relative border-none bg-transparent cursor-pointer p-0 flex items-center justify-center"
                      onClick={() => setShowContextDetail((v) => !v)}
                      title={`${ctxRing.contextUsed.toLocaleString()} / ${ctxRing.contextMax.toLocaleString()} tokens (${ctxRing.pctDisplay}%)`}
                    >
                      <svg width="22" height="22" viewBox="0 0 22 22" className="block">
                        <circle cx="11" cy="11" r={ctxRing.r} fill="none" stroke="rgba(142,163,179,0.15)" strokeWidth="2" />
                        <circle
                          cx="11"
                          cy="11"
                          r={ctxRing.r}
                          fill="none"
                          stroke={ctxRing.strokeColor}
                          strokeWidth="2"
                          strokeDasharray={ctxRing.circumference}
                          strokeDashoffset={ctxRing.offset}
                          strokeLinecap="round"
                          transform="rotate(-90 11 11)"
                          className="transition-[stroke-dashoffset,stroke] duration-300"
                        />
                      </svg>
                    </button>
                    {showContextDetail && (
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-max rounded border border-(--line) bg-[#141c24] px-2.5 py-1.5 shadow-lg z-50">
                        <div className="text-[11px] text-(--text) font-medium text-center">
                          <span className="text-(--muted) font-normal">Already used: </span>
                          {ctxRing.pctDisplay}%
                        </div>
                        <div className="text-[10px] text-(--muted) text-center mt-0.5 whitespace-nowrap">
                          {ctxRing.contextUsed >= 1000000
                            ? `${(ctxRing.contextUsed / 1000000).toFixed(0)}m`
                            : `${(ctxRing.contextUsed / 1000).toFixed(0)}k`}{" "}
                          /{" "}
                          {ctxRing.contextMax >= 1000000
                            ? `${(ctxRing.contextMax / 1000000).toFixed(0)}m`
                            : `${(ctxRing.contextMax / 1000).toFixed(0)}k`}
                        </div>
                      </div>
                    )}
                  </div>
                )}
                {isBusy ? (
                  <button
                    className="h-6 inline-flex items-center justify-center gap-1 border-none px-2 text-sm rounded cursor-pointer transition-colors text-white bg-[#e05555] hover:bg-[#ff6b6b]"
                    type="button"
                    onClick={onAbort}
                  >
                    <StopIcon width="12" height="12" />
                    Stop
                  </button>
                ) : (
                  <button
                    className={`h-6 inline-flex items-center justify-center gap-1 border-none px-2 text-sm transition-colors ${
                      !input.trim()
                        ? "text-[#3a4a58] bg-transparent cursor-default rounded"
                        : "text-white bg-[#3ac5a0] cursor-pointer hover:bg-(--live) rounded"
                    }`}
                    type="submit"
                    disabled={!input.trim()}
                  >
                    <SendIcon width="14" height="14" />
                    Send
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </form>
  );
}
