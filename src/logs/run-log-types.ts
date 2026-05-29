export type RunLogLevel = "info" | "warn" | "error";

export type RunLogEntry = {
  id: string;
  ts: string;
  level: RunLogLevel;
  runId: string;
  text: string;
  detail?: unknown;
};

export type RunLogQuery = {
  runId: string;
  offset?: number;
  limit?: number;
  levels?: RunLogLevel[];
  keyword?: string;
  order?: "asc" | "desc";
};

export type RunLogPage = {
  items: RunLogEntry[];
  total: number;
  offset: number;
  limit: number;
  nextOffset: number | null;
  hasMore: boolean;
  parseErrorCount: number;
};
