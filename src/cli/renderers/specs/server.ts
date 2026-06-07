import type { RenderSpecMap } from "../engine/types"

import { readRecord } from "../engine/utils"

const kv = (payload: Record<string, unknown>, field: string, key: string) => ({
  field,
  value: payload[key] ?? "-",
})

const ensureRows = (data: unknown) => {
  const p = readRecord(data)
  return [
    kv(p, "OK", "ok"),
    kv(p, "Action", "action"),
    kv(p, "Endpoint", "endpoint"),
    kv(p, "Reused", "reused"),
    kv(p, "PID", "pid"),
    kv(p, "Started At", "startedAt"),
  ]
}

const statusRows = (data: unknown) => {
  const p = readRecord(data)
  return [
    kv(p, "OK", "ok"),
    kv(p, "Endpoint", "endpoint"),
    kv(p, "Ready", "ready"),
    kv(p, "Metadata Present", "metadataPresent"),
    kv(p, "PID", "pid"),
    kv(p, "PID Running", "pidRunning"),
    kv(p, "Started At", "startedAt"),
  ]
}

export const serverRenderSpecs: RenderSpecMap = {
  "server.ensure": {
    kind: "detail",
    title: "Server Ensure",
    sections: [{ title: "Summary", kind: "key-value", rows: ensureRows }],
  },
  "server.start": {
    kind: "detail",
    title: "Server Start",
    sections: [{ title: "Summary", kind: "key-value", rows: ensureRows }],
  },
  "server.status": {
    kind: "detail",
    title: "Server Status",
    sections: [{ title: "Summary", kind: "key-value", rows: statusRows }],
  },
  "server.stop": {
    kind: "detail",
    title: "Server Stop",
    sections: [{ title: "Summary", kind: "key-value", rows: ensureRows }],
  },
}
