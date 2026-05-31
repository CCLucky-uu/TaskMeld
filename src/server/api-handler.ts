import type { IncomingMessage, ServerResponse } from "node:http";
import { serveStatic } from "./serve-static";
import type { ServerRuntimeMetadata } from "./types.js";

export type ApiHandlerOptions = {
  apiPort: number;
  webOrigin: string;
  app: any;
  serverRuntimeIdentity: ServerRuntimeMetadata;
};

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
