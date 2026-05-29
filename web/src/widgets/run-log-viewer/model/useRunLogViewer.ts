import { useEffect, useMemo, useState } from "react";
import { fetchRunTimelineLogs, getRunTimelineRawUrl, type RunLogEntry, type RunLogLevel } from "../../../entities/run-log";

export const useRunLogViewer = (open: boolean, runId: string) => {
  const [items, setItems] = useState<RunLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [parseErrorCount, setParseErrorCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [keywordDraft, setKeywordDraft] = useState("");
  const [keyword, setKeyword] = useState("");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [selectedLevels, setSelectedLevels] = useState<RunLogLevel[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const clearLogState = (opts?: { keepError?: boolean }) => {
    // 切换 run 或离开日志页时立即卸载旧日志，避免多个 run 的大数组同时驻留内存。
    setItems([]);
    setTotal(0);
    setParseErrorCount(0);
    setNextOffset(null);
    setLoadingMore(false);
    setSelectedId("");
    if (!opts?.keepError) setError("");
  };

  useEffect(() => {
    if (!open || !runId.trim()) {
      clearLogState();
      setLoading(false);
      return;
    }

    let cancelled = false;
    clearLogState();
    setLoading(true);

    // 只允许当前 run 的请求回写状态，切换 run 后旧请求结果直接丢弃。
    void fetchRunTimelineLogs({
      runId,
      keyword,
      levels: selectedLevels,
      order,
    })
      .then((page) => {
        if (cancelled) return;
        setItems(page.items);
        setTotal(page.total);
        setParseErrorCount(page.parseErrorCount);
        setNextOffset(page.nextOffset);
        setSelectedId(page.items[0]?.id ?? "");
      })
      .catch((nextError) => {
        if (cancelled) return;
        setError(nextError instanceof Error ? nextError.message : String(nextError));
        clearLogState({ keepError: true });
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
      clearLogState();
      setLoading(false);
    };
  }, [open, runId, keyword, order, selectedLevels]);

  useEffect(() => {
    if (!open) return;
    setKeywordDraft(keyword);
  }, [open, keyword]);

  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedId) ?? items[0] ?? null,
    [items, selectedId],
  );

  const applyFilters = () => {
    setKeyword(keywordDraft.trim());
  };

  const loadMore = async () => {
    if (nextOffset === null || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await fetchRunTimelineLogs({
        runId,
        keyword,
        levels: selectedLevels,
        order,
        offset: nextOffset,
      });
      setItems((prev) => [...prev, ...page.items]);
      setTotal(page.total);
      setParseErrorCount(page.parseErrorCount);
      setNextOffset(page.nextOffset);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setLoadingMore(false);
    }
  };

  const toggleLevel = (level: RunLogLevel, checked: boolean) => {
    setSelectedLevels((prev) => {
      if (checked) return [...new Set([...prev, level])];
      return prev.filter((item) => item !== level);
    });
  };

  const resetFilters = () => {
    setKeywordDraft("");
    setKeyword("");
    setSelectedLevels([]);
    setOrder("desc");
  };

  return {
    items,
    total,
    parseErrorCount,
    loading,
    error,
    keywordDraft,
    setKeywordDraft,
    keyword,
    order,
    setOrder,
    selectedLevels,
    selectedItem,
    setSelectedId,
    applyFilters,
    toggleLevel,
    resetFilters,
    rawUrl: getRunTimelineRawUrl(runId),
    hasMore: nextOffset !== null,
    loadingMore,
    loadMore,
  };
};
