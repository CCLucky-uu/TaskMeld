import assert from "node:assert/strict";
import { createRouter } from "../../src/server/router";
import { registerHealthRoutes } from "../../src/server/routes/health";
import type { RequestContext } from "../../src/server/types";

type MockRes = {
  statusCode: number;
  _headers: Record<string, string>;
  _body: string;
  _ended: boolean;
  writeHead(code: number, headers?: Record<string, string>): MockRes;
  end(body?: string): MockRes;
  pipe(): void;
  setHeader(): void;
  getHeader(): void;
  getHeaders(): void;
  headersSent: boolean;
};

function createMockRes(): MockRes {
  const res: MockRes = {
    statusCode: 200,
    _headers: {},
    _body: "",
    _ended: false,
    headersSent: false,
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
    pipe() { return {} as NodeJS.WritableStream; },
    setHeader() {},
    getHeader() { return undefined; },
    getHeaders() { return {}; },
  };
  return res;
}

function mockCtx(overrides: Partial<RequestContext> = {}): RequestContext {
  const mockRes = createMockRes();
  return {
    req: { method: "GET", url: "/api/health" } as never,
    res: mockRes as never,
    method: "GET",
    url: new URL("http://localhost:3000/api/health"),
    params: {},
    options: {
      apiPort: 3000,
      webOrigin: "*",
      app: {} as never,
      serverRuntimeIdentity: {
        serverId: "test-server-id",
        pid: 12345,
        port: 3000,
        endpoint: "http://127.0.0.1:3000",
        startedAt: "2026-05-10T00:00:00.000Z",
      },
    },
    services: {},
    sendJson(code: number, data: unknown) {
      mockRes.statusCode = code;
      mockRes._body = JSON.stringify(data);
      mockRes._ended = true;
    },
    sendRaw() {},
    readBody: async () => ({}),
    getPipelineScope: () => null,
    ...overrides,
  } as RequestContext;
}

const run = async () => {
  // 1. GET /api/health 返回 200 + { ok: true, ...serverRuntimeIdentity }
  {
    const router = createRouter();
    registerHealthRoutes(router);

    const match = router.match("GET", "/api/health");
    assert.ok(match, "应匹配 GET /api/health");

    const ctx = mockCtx();
    await match.handler(ctx);

    const res = ctx.res as unknown as MockRes;
    assert.equal(res.statusCode, 200, "状态码应为 200");
    const body = JSON.parse(res._body);
    assert.equal(body.ok, true, "应包含 ok: true");
    assert.equal(body.serverId, "test-server-id", "应包含 serverId");
    assert.equal(body.pid, 12345, "应包含 pid");
    assert.equal(body.port, 3000, "应包含 port");
    assert.equal(body.endpoint, "http://127.0.0.1:3000", "应包含 endpoint");
    assert.equal(body.startedAt, "2026-05-10T00:00:00.000Z", "应包含 startedAt");
    console.log("1. GET /api/health returns 200 with serverRuntimeIdentity - PASS");
  }

  // 2. health 路由只匹配 GET 方法
  {
    const router = createRouter();
    registerHealthRoutes(router);

    const postMatch = router.match("POST", "/api/health");
    assert.equal(postMatch, null, "POST /api/health 不应匹配");
    console.log("2. health route only matches GET method - PASS");
  }

  // 3. health 路由不拦截其他路径
  {
    const router = createRouter();
    registerHealthRoutes(router);

    const match = router.match("GET", "/api/other");
    assert.equal(match, null, "/api/other 不应匹配 health 路由");
    console.log("3. health route does not intercept other paths - PASS");
  }

  // 4. health 响应中的字段展开逻辑与旧实现一致
  {
    const router = createRouter();
    registerHealthRoutes(router);

    const match = router.match("GET", "/api/health");
    assert.ok(match);

    const ctx = mockCtx({
      options: {
        apiPort: 4000,
        webOrigin: "http://custom",
        app: {} as never,
        serverRuntimeIdentity: {
          serverId: "custom-server",
          pid: 99999,
          port: 4000,
          endpoint: "http://custom:4000",
          startedAt: "2026-01-01T00:00:00.000Z",
        },
      },
    });
    await match.handler(ctx);

    const res = ctx.res as unknown as MockRes;
    const body = JSON.parse(res._body);
    assert.equal(body.serverId, "custom-server");
    assert.equal(body.pid, 99999);
    assert.equal(body.ok, true);
    console.log("4. health response uses custom serverRuntimeIdentity - PASS");
  }

  console.log("routes-health tests passed");
};

void run().catch((error) => {
  console.error("routes-health tests failed", error);
  process.exitCode = 1;
});
