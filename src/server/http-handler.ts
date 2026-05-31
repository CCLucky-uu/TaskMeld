import { createReadStream, existsSync } from "node:fs";
import { join, extname } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

// 服务器运行时元数据类型
export type ServerRuntimeMetadata = {
  serverId: string;
  pid: number;
  port: number;
  endpoint: string;
  startedAt: string;
};

// 静态文件 MIME 类型映射
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

// 解析 Web 静态资源目录
const resolveWebDist = (): string =>
  join(__dirname, "..", "..", "web", "dist");

const webDistRoot = resolveWebDist();

// 静态文件服务（SPA 回退到 index.html）
const serveStatic = (req: IncomingMessage, res: ServerResponse): boolean => {
  if (!existsSync(webDistRoot)) return false;

  const url = new URL(req.url ?? "/", "http://localhost");
  let filePath = join(webDistRoot, url.pathname === "/" ? "index.html" : url.pathname);

  if (!existsSync(filePath) || !filePath.startsWith(webDistRoot)) {
    filePath = join(webDistRoot, "index.html");
  }

  if (!existsSync(filePath)) return false;

  const ext = extname(filePath);
  const contentType = MIME[ext] ?? "application/octet-stream";

  res.writeHead(200, {
    "Content-Type": contentType,
    "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=3600",
  });

  createReadStream(filePath).pipe(res);
  return true;
};

// HTTP 请求处理器选项
export type ApiHandlerOptions = {
  apiPort: number;
  webOrigin: string;
  app: unknown;
  serverRuntimeIdentity: ServerRuntimeMetadata;
};

// 创建 HTTP 请求处理器（健康检查 + CORS + 静态文件）
export const createApiHandler = (options: ApiHandlerOptions) => {
  return (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? "/";

    // /api/health — CLI server lifecycle check
    if (req.method === "GET" && url === "/api/health") {
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": options.webOrigin,
      });
      res.end(JSON.stringify({ ok: true, ...options.serverRuntimeIdentity }));
      return;
    }

    // OPTIONS — CORS preflight
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": options.webOrigin,
        "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      });
      res.end();
      return;
    }

    // Static SPA files (falls back to index.html)
    if (serveStatic(req, res)) return;

    res.writeHead(404, {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": options.webOrigin,
    });
    res.end(JSON.stringify({ error: "not_found" }));
  };
};
