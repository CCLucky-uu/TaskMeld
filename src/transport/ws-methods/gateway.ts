import type { WsMethodRegistry } from "./types";

export const registerGatewayWsMethods = (registry: WsMethodRegistry): void => {
  registry.register("gateway.status", (_params, ctx) => {
    return {
      ok: true,
      payload: {
        status: ctx.services.getLatestStatus?.() ?? (ctx.services.client as { getStatus?: () => unknown })?.getStatus?.(),
        hello: ctx.services.getLatestHello?.(),
        lastFrame: ctx.services.getLastFrame?.(),
      },
    };
  });
};
