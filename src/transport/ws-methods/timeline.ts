import type { WsMethodRegistry } from "./types";

export const registerTimelineWsMethods = (registry: WsMethodRegistry): void => {
  registry.register("timeline.list", (_params, ctx) => {
    const items = ctx.services.getTimeline();
    return { ok: true, payload: { items } };
  });
};
