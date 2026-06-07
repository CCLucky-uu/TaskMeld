import { createReadStream, existsSync } from "node:fs"
import { join, extname } from "node:path"
import type { IncomingMessage, ServerResponse } from "node:http"

// Server runtime metadata type
export type ServerRuntimeMetadata = {
  serverId: string
  pid: number
  port: number
  endpoint: string
  startedAt: string
}

// Static file MIME type map
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
}

// Resolve the web static assets directory
const resolveWebDist = (): string => join(__dirname, "..", "..", "..", "web", "dist")

const webDistRoot = resolveWebDist()

// Static file serving (SPA falls back to index.html)
const serveStatic = (req: IncomingMessage, res: ServerResponse): boolean => {
  if (!existsSync(webDistRoot)) return false

  const url = new URL(req.url ?? "/", "http://localhost")
  let filePath = join(webDistRoot, url.pathname === "/" ? "index.html" : url.pathname)

  if (!existsSync(filePath) || !filePath.startsWith(webDistRoot)) {
    filePath = join(webDistRoot, "index.html")
  }

  if (!existsSync(filePath)) return false

  const ext = extname(filePath)
  const contentType = MIME[ext] ?? "application/octet-stream"

  res.writeHead(200, {
    "Content-Type": contentType,
    "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=3600",
  })

  createReadStream(filePath).pipe(res)
  return true
}

// HTTP request handler options
export type ApiHandlerOptions = {
  apiPort: number
  webOrigin: string
  app: unknown
  serverRuntimeIdentity: ServerRuntimeMetadata
}

// Create HTTP request handler (health check + CORS + static files)
export const createApiHandler = (options: ApiHandlerOptions) => {
  return (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? "/"

    // /api/health — CLI server lifecycle check
    if (req.method === "GET" && url === "/api/health") {
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": options.webOrigin,
      })
      res.end(JSON.stringify({ ok: true, ...options.serverRuntimeIdentity }))
      return
    }

    // OPTIONS — CORS preflight
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": options.webOrigin,
        "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      })
      res.end()
      return
    }

    // Static SPA files (falls back to index.html)
    if (serveStatic(req, res)) return

    res.writeHead(404, {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": options.webOrigin,
    })
    res.end(JSON.stringify({ error: "not_found" }))
  }
}
