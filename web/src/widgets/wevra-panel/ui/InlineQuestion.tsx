import { useState, useCallback, useMemo, forwardRef, useImperativeHandle, useEffect } from "react";
import type { WevraQuestionItem } from "../../../entities/wevra";

function findNextUnanswered(
  from: number,
  total: number,
  answers: Record<number, Set<string>>,
  otherTexts: Record<number, string>,
): number | null {
  for (let offset = 1; offset < total; offset++) {
    const idx = (from + offset) % total;
    const sel = answers[idx] ?? new Set<string>();
    const hasOther = sel.has("__other__") && (otherTexts[idx] ?? "").trim();
    const hasRegular = Array.from(sel).some((s) => s !== "__other__");
    if (!hasRegular && !hasOther) return idx;
  }
  return null;
}

export interface InlineQuestionHandle {
  setOtherText: (text: string) => void;
  setOtherTextForTab: (tabIdx: number, text: string) => void;
  getTabState: (tabIdx: number) => { active: boolean; text: string };
  submit: () => void;
  skip: () => void;
  answeredCount: () => number;
}

interface InlineQuestionProps {
  questions: WevraQuestionItem[];
  onAnswer: (answer: {
    answers: Array<{
      question: string;
      selected: Array<{ label: string; description: string; isCustom?: boolean }>;
    }>;
  }) => void;
  /** Notifies parent: is any tab's Other active? What text does the current tab have? */
  onOtherChange: (info: { active: boolean; text: string; activeTabIdx: number }) => void;
  /** Direct ref for immediate Other state toggle (bypasses callback chain) */
  otherToggleRef?: React.MutableRefObject<(active: boolean, text: string) => void>;
  /** Fires when any answer changes. `allDone` = every question has an answer. */
  onAnswersChange?: (allDone: boolean) => void;
  /** User clicked Skip — skip ALL questions */
  onSkip?: () => void;
  /** Notifies parent: current tab changed */
  onTabChange?: (fromTab: number, toTab: number) => void;
}

export const InlineQuestion = forwardRef<InlineQuestionHandle, InlineQuestionProps>(function InlineQuestion(
  { questions, onAnswer, onOtherChange, onTabChange, otherToggleRef, onAnswersChange, onSkip },
  ref,
) {
  const [activeTab, setActiveTab] = useState(0);
  const [answers, setAnswers] = useState<Record<number, Set<string>>>({});
  const [otherTexts, setOtherTexts] = useState<Record<number, string>>({});
  const [otherActive, setOtherActive] = useState<Record<number, boolean>>({});

  const isMulti = questions.length > 1;
  const current = questions[activeTab];
  const currentSelected = answers[activeTab] ?? new Set<string>();
  const currentShowOther = otherActive[activeTab] ?? false;
  const currentOtherText = otherTexts[activeTab] ?? "";

  const switchTab = useCallback(
    (idx: number) => {
      const fromTab = activeTab;
      setActiveTab(idx);
      onTabChange?.(fromTab, idx);
    },
    [activeTab, onTabChange],
  );

  const allAnswered = useMemo(() => {
    for (let i = 0; i < questions.length; i++) {
      const sel = answers[i] ?? new Set<string>();
      const hasRegular = Array.from(sel).some((s) => s !== "__other__");
      const hasOther = sel.has("__other__") && (otherTexts[i] ?? "").trim();
      if (!hasRegular && !hasOther) return false;
    }
    return true;
  }, [answers, otherTexts, questions.length]);

  // Expose methods to parent via ref
  useImperativeHandle(ref, () => ({
    setOtherText(text: string) {
      setOtherTexts((prev) => ({ ...prev, [activeTab]: text }));
    },
    setOtherTextForTab(tabIdx: number, text: string) {
      setOtherTexts((prev) => {
        const next = { ...prev, [tabIdx]: text };
        // Check if this text change affects "all answered" status
        setAnswers((prevAnswers) => {
          notifyAnswersChange(prevAnswers, next, otherActive);
          return prevAnswers;
        });
        return next;
      });
    },
    getTabState(tabIdx: number) {
      return {
        active: otherActive[tabIdx] ?? false,
        text: otherTexts[tabIdx] ?? "",
      };
    },
    submit() {
      if (!allAnswered) return;
      const result: Array<{
        question: string;
        selected: Array<{ label: string; description: string; isCustom?: boolean }>;
      }> = [];
      for (let i = 0; i < questions.length; i++) {
        const q = questions[i];
        const sel = answers[i] ?? new Set<string>();
        const selected: Array<{ label: string; description: string; isCustom?: boolean }> = [];
        for (const s of sel) {
          if (s === "__other__") {
            const t = (otherTexts[i] ?? "").trim();
            if (t) selected.push({ label: t, description: "User custom input", isCustom: true });
          } else {
            const opt = q.options.find((o) => o.label === s);
            selected.push({ label: s, description: opt?.description ?? s });
          }
        }
        result.push({ question: q.question, selected });
      }
      onAnswer({ answers: result });
    },
    skip() {
      if (isMulti) {
        const nextTab = findNextUnanswered(activeTab, questions.length, answers, otherTexts);
        if (nextTab !== null) switchTab(nextTab);
      }
    },
    answeredCount() {
      let count = 0;
      for (let i = 0; i < questions.length; i++) {
        const sel = answers[i] ?? new Set<string>();
        const hasRegular = Array.from(sel).some((s) => s !== "__other__");
        const hasOther = sel.has("__other__") && (otherTexts[i] ?? "").trim();
        if (hasRegular || hasOther) count++;
      }
      return count;
    },
  }), [activeTab, allAnswered, questions, answers, otherTexts, otherActive, onAnswer, isMulti, switchTab]);

  const setSelectedForTab = useCallback(
    (tabIdx: number, updater: (prev: Set<string>) => Set<string>) => {
      setAnswers((prev) => ({ ...prev, [tabIdx]: updater(prev[tabIdx] ?? new Set()) }));
    },
    [],
  );

  // Fire onAnswersChange after any answer/otherText change
  const notifyAnswersChange = useCallback(
    (nextAnswers: Record<number, Set<string>>, nextOtherTexts: Record<number, string>, nextOtherActive: Record<number, boolean>) => {
      if (!onAnswersChange) return;
      for (let i = 0; i < questions.length; i++) {
        const sel = nextAnswers[i] ?? new Set<string>();
        const hasRegular = Array.from(sel).some((s) => s !== "__other__");
        const hasOther = (nextOtherActive[i] ?? false) && sel.has("__other__") && (nextOtherTexts[i] ?? "").trim();
        if (!hasRegular && !hasOther) {
          onAnswersChange(false);
          return;
        }
      }
      onAnswersChange(true);
    },
    [questions.length, onAnswersChange],
  );

  // Notify parent on mount that no questions are answered yet
  useEffect(() => {
    onAnswersChange?.(false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = useCallback(
    (label: string) => {
      if (label === "__other__") {
        const isShowing = otherActive[activeTab] ?? false;
        const nextOtherActive = { ...otherActive, [activeTab]: !isShowing };
        const nextOtherTexts = { ...otherTexts, [activeTab]: isShowing ? "" : (otherTexts[activeTab] ?? "") };

        if (isShowing) {
          setSelectedForTab(activeTab, (prev) => {
            const next = new Set(prev);
            next.delete("__other__");
            return next;
          });
        } else {
          if (!current.multiSelect) {
            setSelectedForTab(activeTab, () => new Set(["__other__"]));
          } else {
            setSelectedForTab(activeTab, (prev) => new Set(prev).add("__other__"));
          }
        }
        setOtherActive(nextOtherActive);
        setOtherTexts(nextOtherTexts);
        onOtherChange({
          active: !isShowing,
          text: isShowing ? "" : (otherTexts[activeTab] ?? ""),
          activeTabIdx: activeTab,
        });
        // Also call directly via ref for immediate UI update
        otherToggleRef?.current(!isShowing, isShowing ? "" : (otherTexts[activeTab] ?? ""));
        // notifyAnswersChange uses next state snapshot — read from current + patches
        setAnswers((prevAnswers) => {
          notifyAnswersChange(prevAnswers, nextOtherTexts, nextOtherActive);
          return prevAnswers; // no change to answers
        });
        return;
      }

      if (current.multiSelect) {
        setSelectedForTab(activeTab, (prev) => {
          const next = new Set(prev);
          if (next.has(label)) next.delete(label);
          else next.add(label);
          return next;
        });
      } else {
        setOtherActive((prev) => ({ ...prev, [activeTab]: false }));
        setOtherTexts((prev) => ({ ...prev, [activeTab]: "" }));
        setSelectedForTab(activeTab, () => new Set([label]));
        onOtherChange({ active: false, text: "", activeTabIdx: activeTab });
        if (isMulti) {
          const nextTab = findNextUnanswered(activeTab, questions.length, answers, otherTexts);
          if (nextTab !== null) switchTab(nextTab);
        }
      }
      // For non-other toggles, notify after state update
      setAnswers((prev) => {
        const nextOtherActive = { ...otherActive, [activeTab]: false };
        notifyAnswersChange(prev, otherTexts, nextOtherActive);
        return prev;
      });
    },
    [activeTab, current, setSelectedForTab, otherActive, otherTexts, onOtherChange, isMulti, questions.length, answers, switchTab, notifyAnswersChange],
  );


  return (
    <div className="rounded-t border border-b-0 border-[rgba(50,215,186,0.45)] bg-[#141c24] overflow-hidden shadow-[0_0_10px_rgba(50,215,186,0.18)]">
      {/* Tab bar — multi only */}
      {isMulti && (
        <div className="flex items-center px-2.5 overflow-x-auto scrollbar-none [&::-webkit-scrollbar]:hidden">
          {questions.map((q, idx) => {
            const sel = answers[idx] ?? new Set<string>();
            const hasRegular = Array.from(sel).some((s) => s !== "__other__");
            const hasOther = sel.has("__other__") && (otherTexts[idx] ?? "").trim();
            const isAnswered = hasRegular || hasOther;
            const isActive = idx === activeTab;
            return (
              <button
                key={idx}
                type="button"
                className={`shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-b text-[11px] border border-t-0 transition-colors cursor-pointer ${
                  isActive
                    ? "border-[rgba(50,215,186,0.35)] bg-[rgba(50,215,186,0.08)] text-(--text)"
                    : "border-transparent text-(--muted) hover:text-(--text)"
                }`}
                onClick={() => switchTab(idx)}
              >
                <span className={`w-1.5 h-1.5 rounded-sm ${isAnswered ? "bg-(--live)" : "border border-[rgba(142,163,179,0.35)]"}`} />
                {q.header || `Q${idx + 1}`}
              </button>
            );
          })}
        </div>
      )}

      {/* Question text */}
      <div className="px-3 pt-2.5 pb-2">
        {!isMulti && current.header && (
          <span className="text-[10px] font-semibold uppercase tracking-wider text-(--live) mb-1 block">
            {current.header}
          </span>
        )}
        <p className="text-[12.5px] leading-[1.45] text-(--text) m-0">{current.question}</p>
      </div>

      {/* Options */}
      <div className="px-0">
        {current.options.map((opt, optIdx) => {
          const isSelected = currentSelected.has(opt.label);
          return (
            <div key={opt.label}>
              {optIdx > 0 && <div className="border-b border-[rgba(142,163,179,0.1)] mx-3" />}
              <button
                type="button"
                className={`w-full text-left px-3 py-2 bg-transparent border-none outline-none transition-colors cursor-pointer ${
                  isSelected
                    ? "text-(--text) bg-[rgba(50,215,186,0.06)]"
                    : "text-(--muted) hover:bg-[rgba(142,163,179,0.05)] hover:text-(--text)"
                }`}
                onClick={() => toggle(opt.label)}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`shrink-0 inline-flex items-center justify-center w-3 h-3 rounded-sm border text-[8px] ${
                      isSelected
                        ? "border-(--live) bg-(--live) text-white"
                        : "border-[rgba(142,163,179,0.3)] bg-transparent"
                    }`}
                  >
                    {isSelected && "✓"}
                  </span>
                  <span className="text-[12px] font-medium">{opt.label}</span>
                </div>
                {opt.description && (
                  <p className="text-[11px] leading-[1.35] text-[rgba(142,163,179,0.55)] m-0 mt-0.5 ml-[22px]">
                    {opt.description}
                  </p>
                )}
              </button>
            </div>
          );
        })}

        <div className="border-b border-[rgba(142,163,179,0.1)] mx-3" />

        <button
          type="button"
          className={`w-full text-left px-3 py-2 bg-transparent border-none outline-none transition-colors cursor-pointer ${
            currentShowOther
              ? "text-(--text) bg-[rgba(50,215,186,0.04)]"
              : "text-(--muted) hover:bg-[rgba(142,163,179,0.05)] hover:text-(--text)"
          }`}
          onClick={() => toggle("__other__")}
        >
          <div className="flex items-center gap-2">
            <span
              className={`shrink-0 inline-flex items-center justify-center w-3 h-3 rounded-sm border text-[8px] ${
                currentShowOther
                  ? "border-(--live) bg-(--live) text-white"
                  : "border-[rgba(142,163,179,0.3)] bg-transparent"
              }`}
            >
              {currentShowOther && "✓"}
            </span>
            <span className="text-[12px] font-medium">Other...</span>
            {currentShowOther && (
              <span className="text-[10px] text-(--muted) ml-1">↓ type below</span>
            )}
          </div>
        </button>
      </div>
    </div>
  );
});
