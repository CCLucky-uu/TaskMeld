import type { Router } from "../types.js";

/**
 * 时间线 service shape。
 */
type TimelineServices = {
  getTimeline: () => unknown[];
};

/**
 * 注册 GET /api/timeline 路由。
 * 返回合并后的全流水线时间线记录。
 */
export const registerTimelineRoutes = (router: Router): void => {
  router.register("GET", "/api/timeline", (ctx) => {
    const services = ctx.services as TimelineServices;
    ctx.sendJson(200, { items: services.getTimeline() });
  });
};
