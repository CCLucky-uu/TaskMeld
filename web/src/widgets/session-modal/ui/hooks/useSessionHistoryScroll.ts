import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { LiveToolEntry } from "../../model/session-modal-types";

type UseSessionHistoryScrollParams = {
  open: boolean;
  activePanel: "session" | "files";
  selectedSessionId: string;
  historySignature: string;
  liveTools: LiveToolEntry[];
  isThinking: boolean;
};

export const useSessionHistoryScroll = ({
  open,
  activePanel,
  selectedSessionId,
  historySignature,
  liveTools,
  isThinking,
}: UseSessionHistoryScrollParams) => {
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [historyViewportWidth, setHistoryViewportWidth] = useState(0);
  const [historyViewportHeight, setHistoryViewportHeight] = useState(0);
  const [historyScrollTop, setHistoryScrollTop] = useState(0);
  const historyScrollerRef = useRef<HTMLDivElement | null>(null);
  const historyResizeObserverRef = useRef<ResizeObserver | null>(null);
  const lastHistoryKeyRef = useRef("");
  const historyAutoScrollRef = useRef(true);
  const historyUserInteractedRef = useRef(false);
  const pendingBottomSnapRef = useRef(false);
  const lastScrollTopRef = useRef(0);
  const lastPanelRef = useRef<"session" | "files">("session");
  const lastSessionIdRef = useRef("");
  const enterSnapRaf1Ref = useRef<number | null>(null);
  const enterSnapRaf2Ref = useRef<number | null>(null);
  const enterSnapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const forceSnapHistoryBottom = useCallback(() => {
    const scroller = historyScrollerRef.current;
    if (!scroller) {
      pendingBottomSnapRef.current = true;
      return;
    }
    scroller.scrollTop = scroller.scrollHeight;
    lastScrollTopRef.current = scroller.scrollTop;
    historyAutoScrollRef.current = true;
    historyUserInteractedRef.current = false;
    setShowScrollToBottom(false);
    pendingBottomSnapRef.current = false;
  }, []);

  const resetHistoryScrollTracking = useCallback(() => {
    historyAutoScrollRef.current = true;
    historyUserInteractedRef.current = false;
    lastHistoryKeyRef.current = "";
    setShowScrollToBottom(false);
  }, []);

  useEffect(() => {
    return () => {
      if (enterSnapRaf1Ref.current !== null) cancelAnimationFrame(enterSnapRaf1Ref.current);
      if (enterSnapRaf2Ref.current !== null) cancelAnimationFrame(enterSnapRaf2Ref.current);
      if (enterSnapTimerRef.current !== null) clearTimeout(enterSnapTimerRef.current);
      historyResizeObserverRef.current?.disconnect();
      historyResizeObserverRef.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    if (!open || activePanel !== "session") return;
    forceSnapHistoryBottom();
  }, [open, activePanel, selectedSessionId, forceSnapHistoryBottom]);

  useEffect(() => {
    if (!open) return;
    const switchedToSession = lastPanelRef.current !== "session" && activePanel === "session";
    const switchedSessionId =
      activePanel === "session" && selectedSessionId && selectedSessionId !== lastSessionIdRef.current;
    lastPanelRef.current = activePanel;
    if (selectedSessionId) {
      lastSessionIdRef.current = selectedSessionId;
    }
    if (!switchedToSession && !switchedSessionId) return;
    if (enterSnapRaf1Ref.current !== null) cancelAnimationFrame(enterSnapRaf1Ref.current);
    if (enterSnapRaf2Ref.current !== null) cancelAnimationFrame(enterSnapRaf2Ref.current);
    if (enterSnapTimerRef.current !== null) clearTimeout(enterSnapTimerRef.current);

    const scheduleSnap = () => {
      if (historyUserInteractedRef.current) return;
      const scroller = historyScrollerRef.current;
      if (!scroller) {
        pendingBottomSnapRef.current = true;
        return;
      }
      scroller.scrollTop = scroller.scrollHeight;
      lastScrollTopRef.current = scroller.scrollTop;
      historyAutoScrollRef.current = true;
      setShowScrollToBottom(false);
    };

    scheduleSnap();
    enterSnapRaf1Ref.current = requestAnimationFrame(() => {
      scheduleSnap();
      enterSnapRaf2Ref.current = requestAnimationFrame(() => {
        scheduleSnap();
      });
    });
    enterSnapTimerRef.current = setTimeout(() => {
      scheduleSnap();
    }, 90);
  }, [open, activePanel, selectedSessionId]);

  useEffect(() => {
    if (activePanel !== "session") return;
    const key = [
      historySignature,
      liveTools.map((item) => `${item.key}:${item.outputText.length}`).join("|"),
      isThinking ? "thinking" : "",
    ].join("::");
    if (key === lastHistoryKeyRef.current) return;
    lastHistoryKeyRef.current = key;
    if (!historyAutoScrollRef.current) return;
    forceSnapHistoryBottom();
  }, [historySignature, liveTools, isThinking, activePanel, forceSnapHistoryBottom]);

  const scrollHistoryToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const scroller = historyScrollerRef.current;
    if (!scroller) return;
    scroller.scrollTo({ top: scroller.scrollHeight, behavior });
    lastScrollTopRef.current = scroller.scrollHeight;
    historyAutoScrollRef.current = true;
    historyUserInteractedRef.current = false;
    setShowScrollToBottom(false);
  }, []);

  const setHistoryScrollerNode = useCallback((node: HTMLDivElement | null) => {
    historyResizeObserverRef.current?.disconnect();
    historyResizeObserverRef.current = null;
    historyScrollerRef.current = node;
    if (!node) {
      setHistoryViewportWidth(0);
      setHistoryViewportHeight(0);
      setHistoryScrollTop(0);
      return;
    }
    setHistoryViewportWidth(node.clientWidth);
    setHistoryViewportHeight(node.clientHeight);
    setHistoryScrollTop(node.scrollTop);
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (!entry) return;
        setHistoryViewportWidth(Math.round(entry.contentRect.width));
        setHistoryViewportHeight(Math.round(entry.contentRect.height));
      });
      observer.observe(node);
      historyResizeObserverRef.current = observer;
    }
    lastScrollTopRef.current = node.scrollTop;
    if (!pendingBottomSnapRef.current) return;
    node.scrollTop = node.scrollHeight;
    lastScrollTopRef.current = node.scrollTop;
    historyAutoScrollRef.current = true;
    historyUserInteractedRef.current = false;
    setShowScrollToBottom(false);
    pendingBottomSnapRef.current = false;
    requestAnimationFrame(() => {
      if (historyScrollerRef.current !== node) return;
      node.scrollTop = node.scrollHeight;
      lastScrollTopRef.current = node.scrollTop;
    });
  }, []);

  const handleHistoryScroll = useCallback(() => {
    const scroller = historyScrollerRef.current;
    if (!scroller) return;
    const previousTop = lastScrollTopRef.current;
    const currentTop = scroller.scrollTop;
    setHistoryScrollTop(currentTop);
    setHistoryViewportHeight(scroller.clientHeight);
    const distanceToBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    const atBottom = distanceToBottom <= 4;
    const scrollingUp = currentTop < previousTop;
    if (atBottom) {
      historyAutoScrollRef.current = true;
      setShowScrollToBottom(false);
      lastScrollTopRef.current = currentTop;
      return;
    }
    if (!historyUserInteractedRef.current) {
      lastScrollTopRef.current = currentTop;
      return;
    }
    if (scrollingUp || distanceToBottom > 4) {
      historyAutoScrollRef.current = false;
      setShowScrollToBottom(true);
    }
    lastScrollTopRef.current = currentTop;
  }, []);

  const markHistoryUserInteracted = useCallback(() => {
    historyUserInteractedRef.current = true;
  }, []);

  return {
    showScrollToBottom,
    historyViewportWidth,
    historyViewportHeight,
    historyScrollTop,
    setHistoryScrollerNode,
    handleHistoryScroll,
    markHistoryUserInteracted,
    scrollHistoryToBottom,
    resetHistoryScrollTracking,
  };
};
