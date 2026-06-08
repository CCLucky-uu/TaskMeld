import assert from "node:assert/strict"
import { sanitizeDiagnosticPayload } from "../src/gateway/frame-sanitizer"

const LONG = "x".repeat(3000)

const run = async () => {
  // ====== 1. Large text field in detail is truncated ======
  {
    const result = sanitizeDiagnosticPayload({ text: LONG }) as Record<string, unknown>
    const marker = result.text as Record<string, unknown>
    assert.equal(marker.__truncated, true)
    assert.equal(marker.length, 3000)
    assert.equal((marker.head as string).length, 256)
    assert.equal((marker.tail as string).length, 2048)
    assert.equal(marker.head, LONG.slice(0, 256))
    assert.equal(marker.tail, LONG.slice(-2048))
  }

  // ====== 2. Short text field preserved ======
  {
    const input = { text: "hello world" }
    const result = sanitizeDiagnosticPayload(input) as Record<string, unknown>
    assert.equal(result.text, "hello world")
    assert.equal(Object.keys(result).length, 1)
  }

  // ====== 3. Non-target field preserved (never truncated) ======
  {
    const longRole = "admin-".repeat(500) // > 2048 chars
    const input = { role: longRole, status: "active", type: "json" }
    const result = sanitizeDiagnosticPayload(input) as Record<string, unknown>
    assert.equal(result.role, longRole, "non-target field role should pass through unchanged")
    assert.equal(result.status, "active")
    assert.equal(result.type, "json")
  }

  // ====== 4. Nested target fields — key matching works at any depth ======
  {
    const input = { wrapper: { inner: { text: LONG } } }
    const result = sanitizeDiagnosticPayload(input) as Record<string, unknown>
    const wrapper = result.wrapper as Record<string, unknown>
    const inner = wrapper.inner as Record<string, unknown>
    const marker = inner.text as Record<string, unknown>
    assert.equal(marker.__truncated, true)
    assert.equal(marker.length, 3000)
  }

  // Also verify another target field like "message" at depth
  {
    const input = { data: { payload: { message: LONG } } }
    const result = sanitizeDiagnosticPayload(input) as Record<string, unknown>
    const data = result.data as Record<string, unknown>
    const payload = data.payload as Record<string, unknown>
    const marker = payload.message as Record<string, unknown>
    assert.equal(marker.__truncated, true)
    assert.equal(marker.length, 3000)
  }

  // ====== 5. Array detail truncated (> 20 items) ======
  {
    const input = Array.from({ length: 25 }, (_, i) => ({ id: i }))
    const result = sanitizeDiagnosticPayload(input) as unknown[]
    assert.equal(result.length, 21, "20 kept + 1 omitted marker")
    assert.equal(result[0] && (result[0] as Record<string, unknown>).id, 0)
    assert.equal(result[19] && (result[19] as Record<string, unknown>).id, 19)
    const marker = result[20] as Record<string, unknown>
    assert.equal(marker.__omittedItems, 5)
  }

  // ====== 6. Deeply nested object capped (> 8 levels) ======
  {
    // Build an object with 9 nested record levels so the leaf hits depth limit
    const buildDeep = (remaining: number): unknown => {
      if (remaining === 0) return "leaf"
      return { [`level${remaining}`]: buildDeep(remaining - 1) }
    }
    const input = buildDeep(9) // 9 nested records
    const result = sanitizeDiagnosticPayload(input) as Record<string, unknown>
    // Walk down to the deepest level
    let cursor: Record<string, unknown> = result
    for (let i = 9; i >= 2; i--) {
      cursor = cursor[`level${i}`] as Record<string, unknown>
    }
    const deepest = cursor.level1 as Record<string, unknown>
    assert.equal(deepest.__depthLimitReached, true)
  }

  // ====== 7. undefined detail returns undefined ======
  {
    const result = sanitizeDiagnosticPayload(undefined)
    assert.equal(result, undefined)
  }

  // Also null passes through unchanged
  {
    const result = sanitizeDiagnosticPayload(null)
    assert.equal(result, null)
  }

  // ====== 8. Primitive detail passes through ======
  {
    // Plain string at top level (parentKey = null) is NOT truncated
    assert.equal(sanitizeDiagnosticPayload("hello world"), "hello world")
    assert.equal(
      sanitizeDiagnosticPayload(LONG),
      LONG,
      "top-level string not a target field value, should pass through",
    )
    assert.equal(sanitizeDiagnosticPayload(42), 42)
    assert.equal(sanitizeDiagnosticPayload(true), true)
  }

  // ====== 9. Typical gateway frame payload ======
  {
    const chatPayload = {
      type: "chat",
      role: "assistant",
      content: [
        { type: "text", text: LONG },
        { type: "tool_use", name: "search", input: "query-string".repeat(400) },
      ],
      status: "complete",
    }
    const result = sanitizeDiagnosticPayload(chatPayload) as Record<string, unknown>

    // Non-target fields at top level pass through
    assert.equal(result.type, "chat")
    assert.equal(result.role, "assistant")
    assert.equal(result.status, "complete")

    // content is a target field (array), items kept
    const contentArr = result.content as Record<string, unknown>[]
    assert.equal(contentArr.length, 2)

    // First content item: text field truncated
    const item0 = contentArr[0]
    assert.equal(item0.type, "text")
    const textMarker = item0.text as Record<string, unknown>
    assert.equal(textMarker.__truncated, true)
    assert.equal(textMarker.length, 3000)
    assert.equal((textMarker.head as string).length, 256)
    assert.equal((textMarker.tail as string).length, 2048)

    // Second content item: input field truncated (input is also a target field)
    const item1 = contentArr[1]
    assert.equal(item1.type, "tool_use")
    const inputMarker = item1.input as Record<string, unknown>
    assert.equal(inputMarker.__truncated, true)
  }

  // ====== 10. Agent lifecycle detail shape passes through unchanged ======
  {
    const lifecycle = {
      source: "agent-activity",
      agentId: "agent-123",
      runId: "run-456",
      lifecycle: "started",
      seq: 1,
      stateVersion: 0,
    }
    const result = sanitizeDiagnosticPayload(lifecycle) as Record<string, unknown>
    assert.equal(result.source, "agent-activity")
    assert.equal(result.agentId, "agent-123")
    assert.equal(result.runId, "run-456")
    assert.equal(result.lifecycle, "started")
    assert.equal(result.seq, 1)
    assert.equal(result.stateVersion, 0)
    // Verify no extra keys were added (i.e., no truncation markers)
    assert.equal(Object.keys(result).length, 6)
  }

  // ====== Edge: Error-like object with long message ======
  {
    const errorDetail = {
      name: "Error",
      message: LONG,
      stack: "Error: test\n    at foo (test.ts:1:1)".repeat(100),
    }
    const result = sanitizeDiagnosticPayload(errorDetail) as Record<string, unknown>

    // message is a target field, gets truncated
    const msgMarker = result.message as Record<string, unknown>
    assert.equal(msgMarker.__truncated, true)
    assert.equal(msgMarker.length, 3000)

    // stack is NOT a target field, passes through
    assert.ok(
      typeof result.stack === "string" && (result.stack as string).length > 2048,
      "stack should not be truncated",
    )
  }

  // ====== Edge: Multiple target fields in same object ======
  {
    const input = { text: LONG, prompt: LONG, output: "short" }
    const result = sanitizeDiagnosticPayload(input) as Record<string, unknown>

    const textMarker = result.text as Record<string, unknown>
    assert.equal(textMarker.__truncated, true)
    const promptMarker = result.prompt as Record<string, unknown>
    assert.equal(promptMarker.__truncated, true)
    // Short target field preserved
    assert.equal(result.output, "short")
  }

  // ====== Edge: Exactly-at-limit string is not truncated ======
  {
    const exact = "y".repeat(2048)
    const input = { text: exact }
    const result = sanitizeDiagnosticPayload(input) as Record<string, unknown>
    assert.equal(result.text, exact, "exactly-at-limit text should not be truncated")
    assert.ok(typeof result.text === "string", "should remain a string, not a marker")
  }

  // ====== Edge: Just-over-limit string is truncated ======
  {
    const justOver = "z".repeat(2049)
    const input = { text: justOver }
    const result = sanitizeDiagnosticPayload(input) as Record<string, unknown>
    const marker = result.text as Record<string, unknown>
    assert.equal(marker.__truncated, true)
    assert.equal(marker.length, 2049)
  }

  // ====== Edge: Target field key matching is case-insensitive ======
  {
    const input = { Text: LONG, TEXT: LONG, tExT: "short" }
    const result = sanitizeDiagnosticPayload(input) as Record<string, unknown>
    assert.equal((result.Text as Record<string, unknown>).__truncated, true)
    assert.equal((result.TEXT as Record<string, unknown>).__truncated, true)
    assert.equal(result.tExT, "short")
  }

  // ====== Edge: Empty object passes through ======
  {
    const result = sanitizeDiagnosticPayload({}) as Record<string, unknown>
    assert.equal(Object.keys(result).length, 0)
  }

  // ====== Edge: Empty array passes through ======
  {
    const result = sanitizeDiagnosticPayload([]) as unknown[]
    assert.equal(result.length, 0)
  }

  console.log("runtime-store timeline sanitize tests passed")
}

void run().catch((error) => {
  console.error("runtime-store timeline sanitize tests failed", error)
  process.exitCode = 1
})
