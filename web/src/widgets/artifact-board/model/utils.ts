import type { StoredArtifactItem } from "../../../entities/artifact";
import type {
  ArtifactDateGroup,
  ArtifactFilterState,
  ArtifactPipelineGroup,
  ArtifactQuery,
  ArtifactRangePreset,
  ArtifactRunGroup,
} from "./types";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const pad2 = (value: number) => String(value).padStart(2, "0");

export const toDateInputValue = (date: Date): string =>
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

const getPresetRange = (preset: ArtifactRangePreset, now = new Date()): { dateFrom: string; dateTo: string } => {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const dateTo = toDateInputValue(today);
  if (preset === "today") {
    return { dateFrom: dateTo, dateTo };
  }
  if (preset === "7d") {
    const from = new Date(today.getTime() - ONE_DAY_MS * 6);
    return { dateFrom: toDateInputValue(from), dateTo };
  }
  if (preset === "30d") {
    const from = new Date(today.getTime() - ONE_DAY_MS * 29);
    return { dateFrom: toDateInputValue(from), dateTo };
  }
  return { dateFrom: dateTo, dateTo };
};

export const resolveArtifactQuery = (filters: ArtifactFilterState): ArtifactQuery | null => {
  const nodeIdQuery = filters.nodeIds.length > 0 ? filters.nodeIds.join(",") : "";
  if (filters.preset === "custom") {
    if (!filters.customFrom || !filters.customTo) return null;
    if (filters.customFrom > filters.customTo) return null;
    return {
      dateFrom: filters.customFrom,
      dateTo: filters.customTo,
      ...(filters.pipelineId ? { pipelineId: filters.pipelineId } : {}),
      ...(nodeIdQuery ? { nodeId: nodeIdQuery } : {}),
    };
  }
  const presetRange = getPresetRange(filters.preset);
  return {
    ...presetRange,
    ...(filters.pipelineId ? { pipelineId: filters.pipelineId } : {}),
    ...(nodeIdQuery ? { nodeId: nodeIdQuery } : {}),
  };
};

const toUpdatedMs = (value: string): number => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const sortRuns = (runs: ArtifactRunGroup[]): ArtifactRunGroup[] =>
  [...runs].sort((a, b) => b.latestUpdatedAtMs - a.latestUpdatedAtMs);

const sortPipelines = (groups: ArtifactPipelineGroup[]): ArtifactPipelineGroup[] =>
  [...groups].sort((a, b) => b.latestUpdatedAtMs - a.latestUpdatedAtMs);

const sortDates = (groups: ArtifactDateGroup[]): ArtifactDateGroup[] =>
  [...groups].sort((a, b) => b.latestUpdatedAtMs - a.latestUpdatedAtMs);

export const buildArtifactDateGroups = (items: StoredArtifactItem[]): ArtifactDateGroup[] => {
  const dateMap = new Map<string, Map<string, Map<string, ArtifactRunGroup>>>();
  for (const item of items) {
    const dateKey = item.dateBucket || "unknown";
    const pipelineMap = dateMap.get(dateKey) ?? new Map<string, Map<string, ArtifactRunGroup>>();
    const runMap = pipelineMap.get(item.pipelineId) ?? new Map<string, ArtifactRunGroup>();
    const runId = item.runId?.trim() || "unknown";
    const currentRun = runMap.get(runId) ?? {
      runId,
      items: [],
      latestUpdatedAtMs: 0,
    };
    currentRun.items.push(item);
    currentRun.latestUpdatedAtMs = Math.max(currentRun.latestUpdatedAtMs, toUpdatedMs(item.updatedAt));
    runMap.set(runId, currentRun);
    pipelineMap.set(item.pipelineId, runMap);
    dateMap.set(dateKey, pipelineMap);
  }

  const dateGroups: ArtifactDateGroup[] = [];
  for (const [dateKey, pipelineMap] of dateMap.entries()) {
    const pipelineGroups: ArtifactPipelineGroup[] = [];
    for (const [pipelineId, runMap] of pipelineMap.entries()) {
      const runs = sortRuns(
        [...runMap.values()].map((run) => ({
          ...run,
          items: [...run.items].sort((a, b) => toUpdatedMs(b.updatedAt) - toUpdatedMs(a.updatedAt)),
        })),
      );
      const total = runs.reduce((sum, run) => sum + run.items.length, 0);
      const latestUpdatedAtMs = runs[0]?.latestUpdatedAtMs ?? 0;
      // Artifact list comes from the backend; pipelineTitle is already filled by pipelineId, just take the most recent entry.
      const pipelineTitle = runs[0]?.items[0]?.pipelineTitle ?? pipelineId;
      pipelineGroups.push({
        pipelineId,
        pipelineTitle,
        runs,
        total,
        latestUpdatedAtMs,
      });
    }
    const sortedPipelines = sortPipelines(pipelineGroups);
    dateGroups.push({
      dateKey,
      pipelines: sortedPipelines,
      total: sortedPipelines.reduce((sum, group) => sum + group.total, 0),
      latestUpdatedAtMs: sortedPipelines[0]?.latestUpdatedAtMs ?? 0,
    });
  }
  return sortDates(dateGroups);
};
