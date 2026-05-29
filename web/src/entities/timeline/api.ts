import { TimelineItem } from "./types";
import { requestJson } from "../../shared/api/client";

type TimelineResponse = {
  items?: TimelineItem[];
};

export async function fetchTimeline(): Promise<TimelineItem[]> {
  const data = await requestJson<TimelineResponse>("/api/timeline");
  return Array.isArray(data.items) ? data.items : [];
}
