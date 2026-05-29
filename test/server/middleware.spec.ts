import assert from "node:assert/strict";
import { composeMiddleware, errorMiddleware, corsMiddleware } from "../../src/server/middleware";
import type { RequestContext } from "../../src/server/types";

type MockRes = {
  statusCode: number;
  headersSent: boolean;
  _headers: Record<string, string>;
  _body: string;
  _ended: boolean;
  setHeader(name: string, value: string): void;
  getHeader(name: string): string | undefined;
  getHeaders(): Record<string, string>;
  writeHead(code: number, headers?: Record<string, string>): MockRes;
  end(body?: string): MockRes;
};

function createMockRes(): MockRes {
  const res: MockRes = {
    statusCode: 200,
    headersSent: false,
    _headers: {},
    _body: "",
    _ended: false,
    setHeader(name, value) {
      res._headers[name.toLowerCase()] = value;
    },
    getHeader(name) {
      return res._headers[name.toLowerCase()];
    },
    getHeaders() {
      return { ...res._headers };
    },
    writeHead(code, headers) {
      res.statusCode = code;
      if (headers) {
        for (const [key, value] of Object.entries(headers)) {
          res._headers[key.toLowerCase()] = value;
        }
      }
      return res;
    },
    end(body) {
      res._ended = true;
      if (body !== undefined) res._body = body;
      return res;
    },
  };
  return res;
}

function mockCtx(overrides: Partial<RequestContext> = {}): RequestContext {
  const mockRes = createMockRes();

  const ctx = {
    req: { method: "GET", url: "/api/test" },
    res: mockRes,
    method: "GET",
    url: new URL("http://localhost:3000/api/test"),
    params: {} as Record<string, string>,
    options: {
      apiPort: 3000,
      webOrigin: "*",
      app: {} as never,
      serverRuntimeIdentity: {
        serverId: "test",
        pid: 1,
        port: 3000,
        endpoint: "http://localhost:3000",
        startedAt: new Date().toISOString(),
      },
    },
    services: {} as Record<string, unknown>,
    sendJson(code: number, data: unknown) {
      mockRes.statusCode = code;
      mockRes._body = JSON.stringify(data);
      mockRes.headersSent = true;
      mockRes.end();
    },
    sendRaw() {},
    readBody: async () => ({} as Record<string, unknown>),
    getPipelineScope: () => null,
    ...overrides,
  } as RequestContext;

  if (overrides.method && overrides.method !== ctx.method) {
    (ctx.req as { method: string }).method = overrides.method;
  }

  return ctx;
}

const run = async () => {
  // 1. composeMiddleware basic execution chain
  {
    const order: string[] = [];
    const m1 = async (_ctx: RequestContext, next: () => Promise<void>) => {
      order.push("m1");
      await next();
    };
    const handler = async () => {
      order.push("handler");
    };

    const composed = composeMiddleware(m1);
    await composed(mockCtx(), handler);
    assert.deepEqual(order, ["m1", "handler"]);
    console.log("1. composeMiddleware basic execution chain - PASS");
  }

  // 2. composeMiddleware onion order: m1 before -> m2 before -> handler -> m2 after -> m1 after
  {
    const order: string[] = [];
    const m1 = async (_ctx: RequestContext, next: () => Promise<void>) => {
      order.push("m1-before");
      await next();
      order.push("m1-after");
    };
    const m2 = async (_ctx: RequestContext, next: () => Promise<void>) => {
      order.push("m2-before");
      await next();
      order.push("m2-after");
    };
    const handler = async () => {
      order.push("handler");
    };

    const composed = composeMiddleware(m1, m2);
    await composed(mockCtx(), handler);
    assert.deepEqual(order, [
      "m1-before",
      "m2-before",
      "handler",
      "m2-after",
      "m1-after",
    ]);
    console.log("2. composeMiddleware onion order - PASS");
  }

  // 3. next() double-call throws
  {
    let errMessage = "";
    const m1 = async (_ctx: RequestContext, next: () => Promise<void>) => {
      await next();
      try {
        await next();
      } catch (e) {
        errMessage = e instanceof Error ? e.message : String(e);
      }
    };
    const handler = async () => {};

    const composed = composeMiddleware(m1);
    await composed(mockCtx(), handler);
    assert.ok(errMessage, "should throw on double next()");
    assert.ok(errMessage.includes("multiple times"));
    console.log("3. next() double-call throws - PASS");
  }

  // 4. errorMiddleware catches exceptions: handler throws -> 500 { error: "internal_error" }
  {
    const errorMw = errorMiddleware;
    const handler = async () => {
      throw new Error("test error");
    };

    const composed = composeMiddleware(errorMw);
    const ctx = mockCtx();
    const res = ctx.res as unknown as MockRes;
    await composed(ctx, handler);
    assert.equal(res.statusCode, 500);
    const body = JSON.parse(res._body);
    assert.deepEqual(body, { error: "internal_error" });
    console.log("4. errorMiddleware catches exceptions - PASS");
  }

  // 5. errorMiddleware when headersSent, does not overwrite response
  {
    const errorMw = errorMiddleware;
    const handler = async () => {
      throw new Error("test error");
    };

    const composed = composeMiddleware(errorMw);
    const ctx = mockCtx();
    const res = ctx.res as unknown as MockRes;
    res.headersSent = true;
    res.statusCode = 200;
    await composed(ctx, handler);
    assert.equal(res.statusCode, 200, "status code should not change when headersSent");
    console.log("5. errorMiddleware with headersSent - PASS");
  }

  // 6. corsMiddleware OPTIONS request returns 204
  {
    const corsMw = corsMiddleware("*");
    const handler = async () => {
      assert.fail("handler should not be called for OPTIONS");
    };

    const composed = composeMiddleware(corsMw);
    const ctx = mockCtx({ method: "OPTIONS" });
    ctx.req.method = "OPTIONS";
    const res = ctx.res as unknown as MockRes;
    await composed(ctx, handler);
    assert.equal(res.statusCode, 204);
    assert.equal(res._ended, true);
    console.log("6. corsMiddleware OPTIONS returns 204 - PASS");
  }

  // 7. corsMiddleware OPTIONS response contains correct CORS headers
  {
    const corsMw = corsMiddleware("http://example.com");
    const handler = async () => {};

    const composed = composeMiddleware(corsMw);
    const ctx = mockCtx({ method: "OPTIONS" });
    ctx.req.method = "OPTIONS";
    const res = ctx.res as unknown as MockRes;
    await composed(ctx, handler);
    assert.equal(res.statusCode, 204);
    assert.equal(
      res.getHeader("access-control-allow-origin"),
      "http://example.com",
    );
    assert.equal(
      res.getHeader("access-control-allow-methods"),
      "GET,POST,PATCH,DELETE,OPTIONS",
    );
    console.log("7. corsMiddleware OPTIONS CORS headers - PASS");
  }

  // 8. corsMiddleware adds CORS headers for normal GET/POST (before handler executes)
  {
    const corsMw = corsMiddleware("*");
    const handler = async () => {};

    const composed = composeMiddleware(corsMw);
    const ctx = mockCtx({ method: "GET" });
    ctx.req.method = "GET";
    const res = ctx.res as unknown as MockRes;

    await composed(ctx, handler);
    assert.equal(
      res.getHeader("access-control-allow-origin"),
      "*",
    );
    assert.ok(
      res.getHeader("access-control-allow-methods"),
    );
    console.log("8. corsMiddleware adds CORS headers for GET/POST - PASS");
  }

  // 9. corsMiddleware with webOrigin parameter
  {
    const corsMw = corsMiddleware("https://myapp.local");
    const handler = async () => {};

    const composed = composeMiddleware(corsMw);
    const ctx = mockCtx({ method: "OPTIONS" });
    ctx.req.method = "OPTIONS";
    const res = ctx.res as unknown as MockRes;
    await composed(ctx, handler);

    assert.equal(
      res.getHeader("access-control-allow-origin"),
      "https://myapp.local",
    );
    console.log("9. corsMiddleware with custom webOrigin - PASS");
  }

  console.log("middleware tests passed");
};

void run().catch((error) => {
  console.error("middleware tests failed", error);
  process.exitCode = 1;
});
