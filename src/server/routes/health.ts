import type { Router } from "../types.js";

/**
 * 注册 GET /api/health 路由。
 * 返回服务端存活状态及当前 owner 摘要，供 CLI 校验 runtime metadata 是否仍指向同一实例。
 */
export const registerHealthRoutes = (router: Router): void => {
  router.register("GET", "/api/health", (ctx) => {
    ctx.sendJson(200, {
      ok: true,
      ...ctx.options.serverRuntimeIdentity,
    });
  });
};
