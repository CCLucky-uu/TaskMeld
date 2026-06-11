import type { Tool, ToolContext } from "../../types"

// ── Constants ──

const FETCH_TIMEOUT_MS = 10_000
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024 // 5MB
const RATE_LIMIT_MS = 1_000

// ── Rate limiter ──

let lastRequestTime = 0

async function rateLimitedFetch(url: string, init?: RequestInit): Promise<Response> {
  const now = Date.now()
  const elapsed = now - lastRequestTime
  if (elapsed < RATE_LIMIT_MS) {
    await new Promise((r) => setTimeout(r, RATE_LIMIT_MS - elapsed))
  }
  lastRequestTime = Date.now()
  return fetch(url, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
}

// ── URL validation ──

function validateUrl(url: string): { ok: true } | { ok: false; reason: string } {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { ok: false, reason: `Invalid URL: "${url}"` }
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return { ok: false, reason: `Protocol "${parsed.protocol}" is not allowed. Only http/https.` }
  }

  const host = parsed.hostname

  // Block localhost
  if (["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"].includes(host)) {
    return { ok: false, reason: "Localhost access is not allowed." }
  }

  // Block private/internal IPs
  if (isPrivateIP(host)) {
    return { ok: false, reason: `Private/internal address "${host}" is not allowed.` }
  }

  return { ok: true }
}

function isPrivateIP(host: string): boolean {
  // IPv4 private ranges
  const parts = host.split(".").map(Number)
  if (parts.length === 4 && parts.every((n) => !isNaN(n))) {
    if (parts[0] === 10) return true // 10.0.0.0/8
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true // 172.16.0.0/12
    if (parts[0] === 192 && parts[1] === 168) return true // 192.168.0.0/16
    if (parts[0] === 169 && parts[1] === 254) return true // 169.254.0.0/16 (link-local)
  }
  // IPv6 private
  if (host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80")) return true
  return false
}

// ── HTML utilities ──

function decodeEntities(html: string): string {
  return html
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, "")
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  return text.slice(0, maxChars) + "\n\n[... truncated]"
}

// ── Read response with size limit ──

async function readResponseLimited(res: Response): Promise<string> {
  const reader = res.body?.getReader()
  if (!reader) return ""

  const chunks: Uint8Array[] = []
  let totalBytes = 0
  const decoder = new TextDecoder()

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    totalBytes += value.byteLength
    if (totalBytes > MAX_RESPONSE_BYTES) {
      reader.cancel()
      break
    }
    chunks.push(value)
  }

  return decoder.decode(Buffer.concat(chunks))
}

// ── web_search ──

async function executeWebSearch(args: unknown, ctx: ToolContext) {
  const { query, maxResults } = args as { query: string; maxResults?: number }
  const limit = Math.min(maxResults ?? 5, 10)

  ctx.logger.info(`web_search: "${query}"`)

  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
  const res = await rateLimitedFetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    },
  })

  if (!res.ok) {
    return { output: `DuckDuckGo returned HTTP ${res.status}`, isError: true }
  }

  const html = await readResponseLimited(res)
  const results = parseDuckDuckGoResults(html, limit)

  if (results.length === 0) {
    return { output: "No search results found.", isError: false }
  }

  const formatted = results.map((r, i) => `${i + 1}. ${r.title}\n   URL: ${r.url}\n   ${r.snippet}`).join("\n\n")

  return { output: formatted, isError: false }
}

function parseDuckDuckGoResults(html: string, limit: number): Array<{ title: string; url: string; snippet: string }> {
  const results: Array<{ title: string; url: string; snippet: string }> = []

  // DuckDuckGo HTML results use class="result__a" for title links
  // and class="result__snippet" for snippets
  const resultBlockRegex =
    /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>)?/gi

  let match: RegExpExecArray | null
  while ((match = resultBlockRegex.exec(html)) !== null && results.length < limit) {
    const href = decodeEntities(match[1].trim())
    const title = decodeEntities(stripTags(match[2])).trim()
    const snippet = decodeEntities(stripTags(match[3] ?? "")).trim()

    if (!title || !href) continue

    // DuckDuckGo sometimes wraps URLs in a redirect; extract the actual URL
    const url = extractDuckDuckGoUrl(href)

    results.push({ title, url, snippet: snippet || "(no snippet)" })
  }

  return results
}

function extractDuckDuckGoUrl(href: string): string {
  // DuckDuckGo redirect format: //duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com&rut=...
  try {
    if (href.includes("duckduckgo.com/l/")) {
      const uddg = href.match(/uddg=([^&]+)/)
      if (uddg) return decodeURIComponent(uddg[1])
    }
  } catch {
    /* fall through */
  }
  return href
}

// ── web_fetch ──

async function executeWebFetch(args: unknown, ctx: ToolContext) {
  const { url, maxLength } = args as { url: string; maxLength?: number }
  const maxChars = maxLength ?? 10_000

  // Validate URL
  const check = validateUrl(url)
  if (!check.ok) {
    return { output: `URL rejected: ${check.reason}`, isError: true }
  }

  ctx.logger.info(`web_fetch: ${url}`)

  const res = await rateLimitedFetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,*/*",
    },
  })

  if (!res.ok) {
    return { output: `Fetch failed: HTTP ${res.status}`, isError: true }
  }

  const contentType = res.headers.get("content-type") ?? ""
  const html = await readResponseLimited(res)

  // If it's not HTML, just return as-is (truncated)
  if (
    !contentType.includes("text/html") &&
    !contentType.includes("text/") &&
    !contentType.includes("application/xhtml")
  ) {
    return { output: truncateText(html, maxChars), isError: false }
  }

  const text = extractReadableText(html)
  return { output: truncateText(text, maxChars), isError: false }
}

function extractReadableText(html: string): string {
  // Remove noise elements
  let cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<aside[\s\S]*?<\/aside>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<svg[\s\S]*?<\/svg>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")

  // Extract title
  const titleMatch = cleaned.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  const title = titleMatch ? decodeEntities(titleMatch[1].trim()) : ""

  // Convert block elements to newlines for structure
  cleaned = cleaned
    .replace(/<\/?(h[1-6]|p|div|br|li|tr|blockquote)[^>]*>/gi, "\n")
    .replace(/<\/?(ul|ol|table|thead|tbody)[^>]*>/gi, "\n")

  // Strip remaining tags
  cleaned = stripTags(cleaned)

  // Decode HTML entities
  cleaned = decodeEntities(cleaned)

  // Clean up whitespace
  cleaned = cleaned
    .replace(/[ \t]+/g, " ") // collapse horizontal whitespace
    .replace(/\n[ \t]+/g, "\n") // trim line starts
    .replace(/[ \t]+\n/g, "\n") // trim line ends
    .replace(/\n{3,}/g, "\n\n") // collapse blank lines
    .replace(/^\s+|\s+$/g, "") // trim overall

  return title ? `Title: ${title}\n\n${cleaned}` : cleaned
}

// ── Tool definitions ──

export const webTools: Tool[] = [
  {
    name: "web_search",
    description:
      "Search the internet using DuckDuckGo. Returns search results with titles, URLs, and snippets.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query string" },
        maxResults: { type: "number", description: "Max results to return (1-10, default 5)", default: 5 },
      },
      required: ["query"],
    },
    annotations: { readOnly: true, destructive: false, requiresConfirmation: false, idempotent: true },
    permission: "auto",
    execute: executeWebSearch,
  },
  {
    name: "web_fetch",
    description:
      "Fetch and read the content of a web page. Returns the main text content extracted from the HTML.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "The URL to fetch (must be http/https)" },
        maxLength: { type: "number", description: "Max characters to return, default 10000", default: 10000 },
      },
      required: ["url"],
    },
    annotations: { readOnly: true, destructive: false, requiresConfirmation: false, idempotent: true },
    permission: "auto",
    execute: executeWebFetch,
  },
]
