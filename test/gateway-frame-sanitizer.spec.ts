import assert from "node:assert/strict"
import { sanitizeGatewayFrame, sanitizeDiagnosticPayload } from "../src/gateway/frame-sanitizer"
import type { GatewayFrame } from "../src/gateway/types"

const run = async () => {
  // ====== 1. sanitizeGatewayFrame basic pass-through ======
  {
    const frame: GatewayFrame = {
      type: "event",
      event: "test",
      payload: { text: "short message" },
    }
    const result = sanitizeGatewayFrame(frame)
    assert.deepStrictEqual(result, frame)
  }

  // ====== 2. sanitizeGatewayFrame large text field truncated ======
  {
    const longText = "x".repeat(3000)
    const frame = {
      type: "event",
      event: "test",
      payload: { text: longText },
    } as GatewayFrame
    const result = sanitizeGatewayFrame(frame) as any
    const marker = result.payload.text
    assert.equal(marker.__truncated, true)
    assert.equal(marker.length, 3000)
    assert.equal(marker.head, longText.slice(0, 256))
    assert.equal(marker.tail, longText.slice(-2048))
  }

  // ====== 3. sanitizeGatewayFrame non-target field NOT truncated ======
  {
    const longId = "x".repeat(3000)
    const frame = {
      type: "req",
      id: longId,
      method: "test",
    } as GatewayFrame
    const result = sanitizeGatewayFrame(frame) as any
    assert.equal(typeof result.id, "string")
    assert.equal(result.id.length, 3000)
    assert.equal(result.id, longId)
  }

  // ====== 4. sanitizeGatewayFrame deep nesting triggers __depthLimitReached ======
  {
    let deep: any = { text: "deep value" }
    for (let i = 0; i < 12; i++) {
      deep = { wrapper: deep }
    }
    const frame = {
      type: "event",
      event: "test",
      payload: deep,
    } as GatewayFrame
    const result = sanitizeGatewayFrame(frame) as any

    let cursor: any = result.payload
    let depthReached = false
    while (cursor != null) {
      if (cursor.__depthLimitReached) {
        depthReached = true
        break
      }
      cursor = cursor.wrapper
    }
    assert.ok(depthReached, "Deep nesting should trigger __depthLimitReached")
  }

  // ====== 5. sanitizeGatewayFrame array truncation with __omittedItems ======
  {
    const largeArray = Array.from({ length: 50 }, (_, i) => ({
      text: `item ${i}`,
    }))
    const frame = {
      type: "event",
      event: "test",
      payload: { items: largeArray },
    } as GatewayFrame
    const result = sanitizeGatewayFrame(frame) as any
    const items = result.payload.items
    assert.ok(Array.isArray(items))
    assert.equal(items.length, 21, "20 kept + 1 omitted marker")
    assert.equal(items[20].__omittedItems, 30)
  }

  // ====== 6. sanitizeGatewayFrame case-insensitive target field matching ======
  {
    const longText = "y".repeat(3000)
    const frame = {
      type: "event",
      event: "test",
      payload: { Text: longText, CONTENT: longText },
    } as GatewayFrame
    const result = sanitizeGatewayFrame(frame) as any
    assert.equal(result.payload.Text.__truncated, true)
    assert.equal(result.payload.CONTENT.__truncated, true)
  }

  // ====== 7. sanitizeDiagnosticPayload on arbitrary values ======
  {
    const input = { message: "hello", count: 42 }
    const result = sanitizeDiagnosticPayload(input)
    assert.deepStrictEqual(result, input)
  }

  // ====== 8. sanitizeDiagnosticPayload with custom options ======
  {
    const longText = "z".repeat(500)
    const result: any = sanitizeDiagnosticPayload(
      { text: longText },
      { maxTextLength: 200, maxTextHeadChars: 50, maxTextTailChars: 100 },
    )
    const marker = result.text
    assert.equal(marker.__truncated, true)
    assert.equal(marker.length, 500)
    assert.equal(marker.head.length, 50)
    assert.equal(marker.tail.length, 100)
  }

  // ====== 9. sanitizeDiagnosticPayload null/undefined/primitive pass through ======
  {
    assert.equal(sanitizeDiagnosticPayload(null), null)
    assert.equal(sanitizeDiagnosticPayload(undefined), undefined)
    assert.equal(sanitizeDiagnosticPayload(42), 42)
    assert.equal(sanitizeDiagnosticPayload("hello"), "hello")
    assert.equal(sanitizeDiagnosticPayload(true), true)
  }

  // ====== 10. Multiple target fields independently truncated ======
  {
    const longText = "a".repeat(3000)
    const input = { text: longText, content: longText, message: longText }
    const result: any = sanitizeDiagnosticPayload(input)
    assert.equal(result.text.__truncated, true)
    assert.equal(result.content.__truncated, true)
    assert.equal(result.message.__truncated, true)
    assert.notStrictEqual(result.text, result.content)
  }

  // ====== 11. Custom maxTextLength via options ======
  {
    const text = "b".repeat(200)
    const result: any = sanitizeDiagnosticPayload({ text }, { maxTextLength: 100 })
    const marker = result.text
    assert.equal(marker.__truncated, true)
    assert.equal(marker.length, 200)
  }

  console.log("gateway frame sanitizer tests passed")
}

void run().catch((error) => {
  console.error("gateway frame sanitizer tests failed", error)
  process.exitCode = 1
})
