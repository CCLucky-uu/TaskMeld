import { createReadStream, existsSync } from "node:fs";
import { join, extname } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

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

const resolveWebDist = (): string => {
  // dist/src/server/serve-static.js → ../../../web/dist
  return join(__dirname, "..", "..", "..", "web", "dist");
};

const webDistRoot = resolveWebDist();

export const serveStatic = (req: IncomingMessage, res: ServerResponse): boolean => {
  if (!existsSync(webDistRoot)) return false;

  const url = new URL(req.url ?? "/", "http://localhost");
  let filePath = join(webDistRoot, url.pathname === "/" ? "index.html" : url.pathname);

  // If the path doesn't map to a real file, serve index.html (SPA fallback)
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
