import assert from "node:assert/strict";
import { IncomingMessage, type ServerResponse } from "node:http";
import { Socket } from "node:net";

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

function createMockRes(onWriteHead?: (code: number, headers?: Record<string, string>) => void): MockRes {
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
      onWriteHead?.(code, headers);
      res.statusCode = code;
      res.headersSent = true;
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

function createMockReq(method: string, url: string): IncomingMessage {
  const socket = new Socket();
  const req = new IncomingMessage(socket);
  req.method = method;
  req.url = url;
  return req;
}

const createStubApp = () => ({
  getPrimaryRuntime: () => ({
    sendJson: (res: ServerResponse, code: number, data: unknown) => {
      res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(data));
    },
    runtime: {
      pushTimeline: () => {},
    },
  }),
  gateway: {
    client: {} as never,
    getLatestStatus: () => null,
    getLatestHello: () => null,
    getLastFrame: () => null,
    refreshSessionsFromGateway: async () => ({ items: [] as never[] }),
    getSessionCache: () => [] as never[],
    pickArray: () => [] as never[],
  },
  runtime: {
    getCombinedTimeline: () => [] as never[],
    setBroadcast: () => {},
  },
  listPipelines: () => [] as never[],
  getPipelineRuntime: () => null,
  getPipelineDefinition: () => null,
  getBootstrapPayload: () => ({}),
}) as never;

const run = async () => {
  const { createApiHandler } = require("../../src/server/api-handler");

  // 1. createApiHandler 返回一个函数
  {
    const handler = createApiHandler({
      apiPort: 3000,
      webOrigin: "*",
      app: createStubApp(),
      serverRuntimeIdentity: {
        serverId: "contract-test",
        pid: 1,
        port: 3000,
        endpoint: "http://127.0.0.1:3000",
        startedAt: "2026-05-10T00:00:00.000Z",
      },
    });
    assert.equal(typeof handler, "function", "createApiHandler 应返回函数");
    console.log("1. createApiHandler returns a function - PASS");
  }

  // 2. GET /api/health 正确路由并返回 200
  {
    const handler = createApiHandler({
      apiPort: 3000,
      webOrigin: "*",
      app: createStubApp(),
      serverRuntimeIdentity: {
        serverId: "contract-test",
        pid: 42,
        port: 3000,
        endpoint: "http://127.0.0.1:3000",
        startedAt: "2026-05-10T12:00:00.000Z",
      },
    });

    const req = createMockReq("GET", "/api/health");
    const res = createMockRes() as unknown as ServerResponse;
    await handler(req, res);

    const mockRes = res as unknown as MockRes;
    assert.equal(mockRes.statusCode, 200, "health 应返回 200");
    const body = JSON.parse(mockRes._body);
    assert.equal(body.ok, true);
    assert.equal(body.serverId, "contract-test");
    assert.equal(body.pid, 42);
    console.log("2. GET /api/health routes correctly - PASS");
  }

  // 3. 未知路由返回 404 { error: "not_found" }
  {
    const handler = createApiHandler({
      apiPort: 3000,
      webOrigin: "*",
      app: createStubApp(),
      serverRuntimeIdentity: {
        serverId: "test",
        pid: 1,
        port: 3000,
        endpoint: "http://127.0.0.1:3000",
        startedAt: "2026-05-10T00:00:00.000Z",
      },
    });

    const req = createMockReq("GET", "/api/nonexistent-route");
    const res = createMockRes() as unknown as ServerResponse;
    await handler(req, res);

    const mockRes = res as unknown as MockRes;
    assert.equal(mockRes.statusCode, 404, "未知路由应返回 404");
    const body = JSON.parse(mockRes._body);
    assert.deepEqual(body, { error: "not_found" });
    console.log("3. unknown route returns 404 - PASS");
  }

  // 3b. API 未知路由不得进入 SPA 静态资源 fallback
  {
    const handler = createApiHandler({
      apiPort: 3000,
      webOrigin: "*",
      app: createStubApp(),
      serverRuntimeIdentity: {
        serverId: "test",
        pid: 1,
        port: 3000,
        endpoint: "http://127.0.0.1:3000",
        startedAt: "2026-05-10T00:00:00.000Z",
      },
    });

    const req = createMockReq("GET", "/api/nonexistent-route");
    const res = createMockRes((_code, headers) => {
      assert.notEqual(
        headers?.["Content-Type"],
        "text/html; charset=utf-8",
        "API 未知路由不应返回 SPA index.html",
      );
    }) as unknown as ServerResponse;
    await handler(req, res);

    const mockRes = res as unknown as MockRes;
    assert.equal(mockRes.statusCode, 404, "API 未知路由应返回 JSON 404");
    assert.deepEqual(JSON.parse(mockRes._body), { error: "not_found" });
    console.log("3b. API unknown route skips static fallback - PASS");
  }

  // 4. OPTIONS 请求返回 204 并包含 CORS 头（走旧代码的 OPTIONS 分支）
  {
    const handler = createApiHandler({
      apiPort: 3000,
      webOrigin: "http://example.com",
      app: createStubApp(),
      serverRuntimeIdentity: {
        serverId: "test",
        pid: 1,
        port: 3000,
        endpoint: "http://127.0.0.1:3000",
        startedAt: "2026-05-10T00:00:00.000Z",
      },
    });

    const req = createMockReq("OPTIONS", "/api/health");
    const res = createMockRes() as unknown as ServerResponse;
    await handler(req, res);

    const mockRes = res as unknown as MockRes;
    assert.equal(mockRes.statusCode, 204, "OPTIONS 应返回 204");
    assert.equal(
      mockRes.getHeader("access-control-allow-origin"),
      "http://example.com",
      "应包含正确的 CORS origin",
    );
    assert.ok(mockRes._ended, "响应应已结束");
    console.log("4. OPTIONS request returns 204 with CORS headers - PASS");
  }

  // 5. OPTIONS 请求对未迁移路径同样返回 204
  {
    const handler = createApiHandler({
      apiPort: 3000,
      webOrigin: "*",
      app: createStubApp(),
      serverRuntimeIdentity: {
        serverId: "test",
        pid: 1,
        port: 3000,
        endpoint: "http://127.0.0.1:3000",
        startedAt: "2026-05-10T00:00:00.000Z",
      },
    });

    const req = createMockReq("OPTIONS", "/api/pipelines");
    const res = createMockRes() as unknown as ServerResponse;
    await handler(req, res);

    const mockRes = res as unknown as MockRes;
    assert.equal(mockRes.statusCode, 204, "OPTIONS 未迁移路径也应返回 204");
    console.log("5. OPTIONS on legacy path returns 204 - PASS");
  }

  console.log("api-handler contract tests passed");
};

void run().catch((error) => {
  console.error("api-handler contract tests failed", error);
  process.exitCode = 1;
});
