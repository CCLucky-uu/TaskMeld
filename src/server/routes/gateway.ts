import type { Router } from "../types.js";

/**
 * 网关状态查询用 service shape。
 * 各字段来源于 ApiHandlerContext.app.gateway 的对应方法。
 */
type GatewayServices = {
  client: { getStatus: () => unknown };
  getLatestStatus: () => unknown;
  getLatestHello: () => unknown;
  getLastFrame: () => unknown;
};

/**
 * 注册 GET /api/gateway/status 路由。
 * 返回网关连接状态、最新 hello 消息和最后帧数据。
 */
export const registerGatewayRoutes = (router: Router): void => {
  router.register("GET", "/api/gateway/status", (ctx) => {
    const services = ctx.services as GatewayServices;
    ctx.sendJson(200, {
      status: services.getLatestStatus() ?? services.client.getStatus(),
      hello: services.getLatestHello(),
      lastFrame: services.getLastFrame(),
    });
  });
};
