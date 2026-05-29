import { useMemo, useState } from "react";
import {
  fetchStoredArtifactsExport,
  fetchStoredArtifactContent,
  fetchStoredArtifacts,
  type StoredArtifactContent,
  type StoredArtifactItem,
} from "../../../entities/artifact";
import type { ArtifactFilterState, ArtifactNodeOption, ArtifactPipelineOption } from "./types";
import { buildArtifactDateGroups, resolveArtifactQuery, toDateInputValue } from "./utils";

const buildDefaultFilterState = (): ArtifactFilterState => {
  const today = toDateInputValue(new Date());
  return {
    preset: "today",
    pipelineId: "",
    nodeIds: [],
    statuses: [],
    kinds: [],
    customFrom: today,
    customTo: today,
  };
};

const formatExportTime = (at: Date): string => {
  const yyyy = at.getFullYear();
  const mm = String(at.getMonth() + 1).padStart(2, "0");
  const dd = String(at.getDate()).padStart(2, "0");
  const hh = String(at.getHours()).padStart(2, "0");
  const mi = String(at.getMinutes()).padStart(2, "0");
  const ss = String(at.getSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
};

export const useArtifactBoard = (pipelineOptions: ArtifactPipelineOption[]) => {
  const [draftFilters, setDraftFilters] = useState<ArtifactFilterState>(buildDefaultFilterState);
  const [appliedFilters, setAppliedFilters] = useState<ArtifactFilterState>(buildDefaultFilterState);
  const [items, setItems] = useState<StoredArtifactItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");

  const [selectedItemKey, setSelectedItemKey] = useState("");
  const [contentLoadingKey, setContentLoadingKey] = useState("");
  const [contentError, setContentError] = useState("");
  const [contentCache, setContentCache] = useState<Record<string, StoredArtifactContent | null>>({});

  const groups = useMemo(() => buildArtifactDateGroups(items), [items]);
  const selectedContent = selectedItemKey ? contentCache[selectedItemKey] ?? null : null;

  const loadArtifacts = async (filters: ArtifactFilterState) => {
    const query = resolveArtifactQuery(filters);
    if (!query) {
      setError("自定义日期范围无效，请检查开始/结束日期。");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const rows = await fetchStoredArtifacts({
        pipelineId: query.pipelineId,
        nodeId: query.nodeId,
        dateFrom: query.dateFrom,
        dateTo: query.dateTo,
        status: filters.statuses.length > 0 ? filters.statuses.join(",") : undefined,
        kind: filters.kinds.length > 0 ? filters.kinds.join(",") : undefined,
        limit: 20000,
      });
      setItems(rows);
      setSelectedItemKey("");
      setContentError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  const applyFilters = async () => {
    setAppliedFilters(draftFilters);
    await loadArtifacts(draftFilters);
  };

  const resetFilters = async () => {
    const next = buildDefaultFilterState();
    setDraftFilters(next);
    setAppliedFilters(next);
    await loadArtifacts(next);
  };

  const refresh = async () => {
    await loadArtifacts(appliedFilters);
  };

  const exportFilteredArtifacts = async () => {
    const query = resolveArtifactQuery(appliedFilters);
    if (!query) {
      setError("导出失败：当前筛选条件无效。");
      return;
    }
    setExporting(true);
    setError("");
    try {
      const data = await fetchStoredArtifactsExport({
        pipelineId: query.pipelineId,
        nodeId: query.nodeId,
        status: appliedFilters.statuses.length > 0 ? appliedFilters.statuses.join(",") : undefined,
        kind: appliedFilters.kinds.length > 0 ? appliedFilters.kinds.join(",") : undefined,
        batchRunId: appliedFilters.batchRunId || undefined,
        dateFrom: query.dateFrom,
        dateTo: query.dateTo,
        limit: 20000,
      });
      // 导出文件只保留产物内容本身，结构按 日期/流水线/节点 三层分组。
      const rawJson = JSON.stringify(data, null, 2);
      const blob = new Blob([rawJson], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `artifacts-export-${formatExportTime(new Date())}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(false);
    }
  };

  const selectItem = async (item: StoredArtifactItem) => {
    const key = `${item.pipelineId}:${item.relativePath}`;
    setSelectedItemKey(key);
    setContentError("");
    if (Object.prototype.hasOwnProperty.call(contentCache, key)) return;
    setContentLoadingKey(key);
    try {
      const content = await fetchStoredArtifactContent({
        pipelineId: item.pipelineId,
        relativePath: item.relativePath,
      });
      setContentCache((prev) => ({ ...prev, [key]: content }));
    } catch (err) {
    setContentCache((prev) => ({ ...prev, [key]: null }));
      setContentError(err instanceof Error ? err.message : String(err));
    } finally {
      setContentLoadingKey("");
    }
  };

  const selectedItem = selectedItemKey
    ? items.find((item) => `${item.pipelineId}:${item.relativePath}` === selectedItemKey)
    : undefined;

  // 产物目录可能覆盖历史流水线，这里把已有选项和当前结果里的流水线做并集，避免筛选器丢值。
  const mergedPipelineOptions = useMemo(() => {
    const map = new Map<string, ArtifactPipelineOption>();
    for (const item of pipelineOptions) {
      if (!item.id.trim()) continue;
      map.set(item.id, item);
    }
    for (const row of items) {
      if (!row.pipelineId.trim()) continue;
      if (!map.has(row.pipelineId)) {
        map.set(row.pipelineId, { id: row.pipelineId, title: row.pipelineTitle || row.pipelineId });
      }
    }
    return [...map.values()].sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));
  }, [pipelineOptions, items]);

  // 节点筛选选项来自当前结果，避免引入额外接口并保持和实际产物一致。
  const mergedNodeOptions = useMemo(() => {
    const set = new Set<string>();
    for (const row of items) {
      const nodeId = row.nodeId?.trim();
      if (!nodeId) continue;
      set.add(nodeId);
    }
    return [...set]
      .sort((a, b) => a.localeCompare(b, "zh-CN"))
      .map<ArtifactNodeOption>((id) => ({ id }));
  }, [items]);

  return {
    draftFilters,
    setDraftFilters,
    appliedFilters,
    items,
    groups,
    loading,
    error,
    selectedItemKey,
    selectedItem,
    selectedContent,
    contentLoadingKey,
    contentError,
    mergedPipelineOptions,
    mergedNodeOptions,
    exporting,
    applyFilters,
    resetFilters,
    refresh,
    exportFilteredArtifacts,
    selectItem,
  };
};
