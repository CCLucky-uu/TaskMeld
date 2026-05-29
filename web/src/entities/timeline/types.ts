export type TimelineLevel = "info" | "warn" | "error";

export type TimelineItem = {
  id: string;
  ts: string;
  createdAt: string;
  text: string;
  level: TimelineLevel;
  detail?: unknown;
};
