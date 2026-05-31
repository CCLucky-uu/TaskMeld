import { TimelineItem } from "./types";
import { wsRequest } from "../../shared/api/ws-client";

type TimelineResponse = {
  items?: TimelineItem[];
};

export async function fetchTimeline(): Promise<TimelineItem[]> {
  const data = await wsRequest<TimelineResponse>("timeline.list");
  return Array.isArray(data.items) ? data.items : [];
}
