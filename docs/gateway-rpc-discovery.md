# Gateway RPC Method Discovery Guide

How to reverse-engineer any undocumented OpenClaw Gateway RPC method — the error messages ARE the documentation.

## Why This Works

The Gateway validates every `sendReq(method, params)` call with strict JSON Schema. Invalid requests return detailed errors listing:

- Required properties (`must have required property 'X'`)
- Unexpected properties (`at root: unexpected property 'X'`)
- Schema branching (`must match a schema in anyOf`)
- Missing scopes (`missing scope: X`)

These errors are precise enough to reconstruct the full parameter schema.

## Prerequisites

```bash
# 1. Build the project (gateway-client.js must exist)
npm run build

# 2. Get gateway credentials
cat ~/.taskmeld/config.json   # → { gatewayUrl, gatewayToken }

# Or from env
echo "$OPENCLAW_GATEWAY_URL"
echo "$OPENCLAW_GATEWAY_TOKEN"
```

## Discovery Script Template

```js
// save as: scripts/probe-gateway-method.js
const { createGatewayClient } = require("../dist/src/gateway/gateway-client");

const CONFIG = {
  gatewayUrl: "ws://127.0.0.1:18789",
  token: "<paste-from-config>",
  clientId: "openclaw-control-ui",
  clientMode: "webchat",
  // Start with all scopes to get past permission checks, then remove to find minimum.
  scopes: ["operator.read", "operator.write", "operator.admin"],
};

const METHOD_NAME = process.argv[2] || "skills.install";
const TIMEOUT_MS = 5000;

async function probe(method, params) {
  const client = createGatewayClient(CONFIG);
  try {
    await client.connect();
    const result = await client.sendReq(method, params, { timeoutMs: TIMEOUT_MS });
    console.log(`OK: ${JSON.stringify(result).slice(0, 2000)}`);
    return { ok: true, result };
  } catch (err) {
    console.log(`ERR: ${(err.message || String(err)).slice(0, 500)}`);
    return { ok: false, error: err.message || String(err) };
  } finally {
    client.close();
  }
}

// ── Step 1: Empty params — discover required fields and scope ──
console.log("── Step 1: Empty params ──");
await probe(METHOD_NAME, {});

// ── Step 2: Enumerate anyOf branches ──
// For each branch, construct minimal param set and probe.
// Error type change = branch switch. Functional error (disabled/not found/already exists) = schema matched!

// ── Step 3: Probe optional fields per branch ──
// Add one optional field at a time. If error stays functional (not "unexpected property"), it's accepted.
```

## The Three-Step Method

### Step 1 — Empty Params Probe

Send `{}` as params. The error reveals:

| Error pattern | Meaning |
|---------------|---------|
| `missing scope: X` | Method exists but needs scope X |
| `unknown method` | Method does not exist |
| `must have required property 'X'` | Property X is required (in at least one anyOf branch) |
| `must match a schema in anyOf` | Method has multiple mutually-exclusive parameter combinations |

**Action:** Collect all property names mentioned. Note the required scope.

### Step 2 — Branch Enumeration

For methods with `anyOf`, probe each branch by constructing minimal param sets.

**Rule: error type change = branch switch**

| Error type | Meaning |
|------------|---------|
| `unexpected property X` | Property X does not belong to this branch — try removing it |
| `must have required property X` | This branch needs X — add it |
| `disabled` / `not found` / `already exists` / `ok` | Schema validation PASSED — this branch exists! |

**Pattern for discovering branches:**

```js
// Start with the first required property you found in Step 1.
// Add related properties until the error changes from "schema" to "functional".
await probe(METHOD_NAME, { propA: "value" });               // → "unexpected property propA" → wrong branch
await probe(METHOD_NAME, { propA: "value", propB: "value" }); // → "must have required property propC" → this branch exists, add propC
await probe(METHOD_NAME, { propA: "value", propB: "value", propC: "value" }); // → "disabled" or "ok" → MATCHED!
```

### Step 3 — Optional Field Discovery

Once a branch matches, probe optional fields one by one:

```js
// Base: functional error (schema passed) — now test optional fields
await probe(METHOD_NAME, { /* branch minimum */, optField: "val" });
// → "ok" or functional error → optional field accepted
// → "unexpected property optField" → field not in this branch
```

## Real Example: `skills.install`

### Step 1 — empty params

```
ERR: must have required property 'name'
     must have required property 'source'
     must match a schema in anyOf
```

Collected: `name`, `source` — anyOf. No scope needed.

### Step 2 — branch enumeration

| Probe params | Result | Interpretation |
|---|---|---|
| `{source:"clawhub", slug:"x"}` | `"Installed x@1.0.0"` ✅ | clawhub branch exists. Required: `source`, `slug` |
| `{source:"clawhub", slug:"x", version:"latest"}` | functional error ✅ | `version` accepted as optional |
| `{source:"clawhub", slug:"x", force:true}` | functional error ✅ | `force` accepted as optional |
| `{source:"upload", slug:"x", uploadId:"abc"}` | `"Upload disabled"` ✅ | upload branch exists. Required: `source`, `slug`, `uploadId` |
| `{source:"installer", name:"x", installId:"x"}` | `"unexpected property source"` ❌ | installer branch exists but **without** `source`! |
| `{name:"x", installId:"x"}` | functional error ✅ | installer branch required: `name`, `installId` |
| `{name:"x", installId:"x", dangerouslyForceUnsafeInstall:true}` | functional error ✅ | `dangerouslyForceUnsafeInstall` accepted as optional |

### Step 3 — final schema

```
skills.install  (anyOf)

  Mode: clawhub
    required:  { source: "clawhub", slug: string }
    optional:  { version?: string, force?: boolean }

  Mode: upload
    required:  { source: "upload", slug: string, uploadId: string }
    optional:  { version?: string, force?: boolean }

  Mode: installer
    required:  { name: string, installId: string }
    optional:  { dangerouslyForceUnsafeInstall?: boolean }
```

## Documenting Results

When you finish probing, record in this format:

```
METHOD: <name>
  scope: <required scope> | none

  Mode: <label>
    required:  { prop: type, ... }
    optional:  { prop: type, ... }
```

## Common Pitfalls

1. **Functional errors look like failures but are successes** — `"already exists"`, `"not found"`, `"disabled"` all mean the schema validated.
2. **Property name in `unexpected property` means it's NOT in this branch** — last round was the correct branch; remove that property.
3. **`anyOf` branches can have completely different `required` sets** — installer branch above had no `source` field at all.
4. **Scope errors come before schema errors** — if you get `missing scope`, add the scope and retry; the schema error will appear next.
5. **Some methods may be behind feature flags** — `upload` branch was valid but disabled by config.

## Additional Discovery: Method Enumeration

To find related methods around a prefix:

```js
// Brute-force method name probing
const PREFIXES = ["skills.", "agents.", "sessions.", "channels."];
const SUFFIXES = ["list", "get", "create", "update", "delete", "remove",
                   "install", "uninstall", "search", "info", "check",
                   "config", "status", "send", "validate", "versions"];

for (const prefix of PREFIXES) {
  for (const suffix of SUFFIXES) {
    const method = prefix + suffix;
    const result = await probe(method, {});
    // "unknown method" → doesn't exist
    // anything else → exists! Record it.
  }
}
```

## Gateway Credential Sources

Priority order:

1. `~/.taskmeld/config.json` — `{ gatewayUrl, gatewayToken }`
2. Environment: `OPENCLAW_GATEWAY_URL`, `OPENCLAW_GATEWAY_TOKEN`
3. Default: `ws://127.0.0.1:18789`

Scope list to try (start with all, narrow down):

```
operator.read  — read-only: list, get, search, info
operator.write — mutations: create, update, delete, install
operator.admin — admin: config, system-level operations
```
