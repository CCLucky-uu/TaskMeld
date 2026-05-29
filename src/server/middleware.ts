import type { RequestContext } from "./types";

export type Middleware = (
  ctx: RequestContext,
  next: () => Promise<void>,
) => Promise<void> | void;

export const composeMiddleware = <C extends RequestContext>(
  ...middlewares: Middleware[]
) => {
  return (ctx: C, handler: (ctx: C) => Promise<void> | void) => {
    const execute = (index: number): Promise<void> => {
      if (index >= middlewares.length) {
        return Promise.resolve(handler(ctx)).then(() => {});
      }

      let nextCalled = false;
      const next = (): Promise<void> => {
        if (nextCalled) {
          throw new Error("next() called multiple times in middleware");
        }
        nextCalled = true;
        return execute(index + 1);
      };

      const result = middlewares[index](ctx, next);
      return Promise.resolve(result).then(() => {});
    };

    return execute(0);
  };
};

export const errorMiddleware: Middleware = async (ctx, next) => {
  try {
    await next();
  } catch (_error) {
    if (!ctx.res.headersSent) {
      ctx.sendJson(500, { error: "internal_error" });
    } else {
      try {
        ctx.res.end();
      } catch {
        // Socket may already be destroyed
      }
    }
  }
};

export const corsMiddleware = (webOrigin: string): Middleware => {
  return (ctx, next) => {
    if (ctx.req.method === "OPTIONS") {
      ctx.res.writeHead(204, {
        "Access-Control-Allow-Origin": webOrigin,
        "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      });
      ctx.res.end();
      return;
    }

    ctx.res.setHeader("Access-Control-Allow-Origin", webOrigin);
    ctx.res.setHeader(
      "Access-Control-Allow-Methods",
      "GET,POST,PATCH,DELETE,OPTIONS",
    );
    ctx.res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    return next();
  };
};
