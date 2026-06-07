import assert from "node:assert/strict"
import { collectEnvelopeCandidates, toPromptContentText, detectFenceLanguage } from "../src/pipeline/structured-output"
import type { ResultEnvelope } from "../src/pipeline/structured-output/contract"

const makeEnvelope = (overrides?: Partial<ResultEnvelope>): ResultEnvelope => ({
  version: "2.0",
  runId: "run-test",
  nodeId: "n1",
  requestId: "req-test-1",
  sessionId: "agent:n1:main",
  status: "success",
  artifacts: [{ type: "brief.v1", schemaVersion: 1, name: "primary", content: "done", meta: {} }],
  control: { sleepUntil: null, retryFromNodeId: null },
  logs: [],
  error: null,
  ...overrides,
})

const envelopeToJson = (overrides?: Partial<ResultEnvelope>): string => JSON.stringify(makeEnvelope(overrides))

const run = async () => {
  // =========================================================================
  // Marker pre-screening (tested indirectly via collectEnvelopeCandidates)
  // =========================================================================

  // 1. Text without envelope markers returns no candidates
  {
    const text =
      "This is a plain text response. It contains no JSON markers at all. Just regular prose without any quoted keys."
    const result = collectEnvelopeCandidates({ text })
    assert.equal(result.length, 0, "text without envelope markers should return no candidates")
  }

  // 2. Text with all three markers is scanned and envelope is found
  {
    const envelope = envelopeToJson()
    const text = `Here is the result:\n${envelope}`
    const result = collectEnvelopeCandidates({ text })
    assert.equal(result.length, 1, "text with all three markers should be scanned")
    assert.equal(result[0].requestId, "req-test-1")
  }

  // 3. Partial markers: has "version" and "requestId" but no "artifacts"
  {
    const text = `{"version":"1.0","requestId":"abc","status":"success"}`
    // The marker pre-screen requires all three strings:
    //   "version"  "requestId"  "artifacts"
    // Since "artifacts" is missing, tryParseEnvelopeText returns null
    // immediately, never attempting a JSON parse.
    const result = collectEnvelopeCandidates({ text })
    assert.equal(result.length, 0, "text with only partial markers should be skipped")
  }

  // =========================================================================
  // Tail window scanning
  // =========================================================================

  // 4. Envelope at the end of a large text (close to extractTextCandidates 60K limit)
  //    Note: extractTextCandidates filters strings > 60K, so the > 64K tail-scan
  //    branch in tryParseEnvelopeText is unreachable through the public
  //    collectEnvelopeCandidates API. This test validates the balanced-brace
  //    extraction path that handles envelopes embedded in large prefixed texts.
  {
    const envelope = envelopeToJson()
    // Filler must NOT contain "version", "requestId", "artifacts", or any
    // curly-brace characters that would confuse the balanced-brace scanner.
    const filler = "x".repeat(59_500)
    const text = filler + "\n" + envelope
    assert.ok(text.length > 59_000, `text should be large, got ${text.length}`)
    assert.ok(text.length <= 60_000, "text must be <= 60K to pass extractTextCandidates filter")
    const result = collectEnvelopeCandidates({ text })
    assert.equal(result.length, 1, "envelope at end of large text should be found")
    assert.equal(result[0].requestId, "req-test-1")
  }

  // 5. Large text (over 60K, no markers) is safely filtered — no errors
  {
    // Single-character filler guarantees no markers are present.
    const filler = "y".repeat(72_000)
    // extractTextCandidates skips strings > 60K, so this text never reaches
    // tryParseEnvelopeText. Even if it did, the marker pre-screen would catch
    // the absence of all three marker strings.
    const result = collectEnvelopeCandidates({ text: filler })
    assert.equal(result.length, 0, "large text without envelope markers should return no candidates")
  }

  // =========================================================================
  // Edge cases
  // =========================================================================

  // 6. Envelope at the very beginning of text (no prefix)
  {
    const envelope = envelopeToJson()
    const text = envelope + "\nSome trailing explanatory text here."
    const result = collectEnvelopeCandidates({ text })
    assert.equal(result.length, 1, "envelope at start of text should be found")
    assert.equal(result[0].requestId, "req-test-1")
  }

  // 7. Envelope inside a code fence (```json ... ```)
  {
    const envelope = envelopeToJson()
    const text = `Here is the structured output:\n\`\`\`json\n${envelope}\n\`\`\`\nEnd of output.`
    const result = collectEnvelopeCandidates({ text })
    assert.equal(result.length, 1, "envelope inside code fence should be parsed")
    assert.equal(result[0].requestId, "req-test-1")
  }

  // 8. Multiple envelopes in one payload (different requestIds)
  {
    const envelope1 = envelopeToJson({ requestId: "req-A" })
    const envelope2 = envelopeToJson({ requestId: "req-B" })
    const payload = {
      output1: `First result:\n${envelope1}`,
      output2: `Second result:\n${envelope2}`,
    }
    const result = collectEnvelopeCandidates(payload)
    assert.equal(result.length, 2, "both envelopes should be collected")
    const ids = result.map((e) => e.requestId).sort()
    assert.deepEqual(ids, ["req-A", "req-B"])
  }

  // =========================================================================
  // toPromptContentText
  // =========================================================================

  // 9. Long content truncated with [truncated] suffix
  {
    const longText = "a".repeat(10_000)
    const result = toPromptContentText(longText)
    assert.ok(result.length < longText.length, "long content should be truncated")
    assert.ok(result.includes("[truncated]"), "truncated content should carry [truncated] suffix")
    // Verify the truncated portion is exactly the first 8000 chars + suffix
    assert.ok(result.startsWith("a".repeat(8_000)), "truncated result should start with first 8000 chars")
  }

  // 10. Short content preserved as-is
  {
    const shortText = "hello world"
    const result = toPromptContentText(shortText)
    assert.equal(result, shortText, "short content should be unchanged")
  }

  // Also test content exactly at the limit
  {
    const exactText = "b".repeat(8_000)
    const result = toPromptContentText(exactText)
    assert.equal(result, exactText, "content at exactly 8000 chars should not be truncated")
  }

  // =========================================================================
  // detectFenceLanguage
  // =========================================================================

  // 11. Valid JSON detected
  {
    assert.equal(detectFenceLanguage('{"key": "value"}'), "json", "valid JSON object should return json")
    assert.equal(detectFenceLanguage("[1, 2, 3]"), "json", "valid JSON array should return json")
  }

  // 12. Plain text detected
  {
    assert.equal(detectFenceLanguage("hello world"), "text", "plain text should return text")
    assert.equal(detectFenceLanguage("{invalid json"), "text", "malformed JSON should return text")
  }

  // 13. Empty / whitespace-only strings
  {
    assert.equal(detectFenceLanguage(""), "text", "empty string should return text")
    assert.equal(detectFenceLanguage("   "), "text", "whitespace-only string should return text")
  }

  console.log("structured-output parser tests passed")
}

void run().catch((error) => {
  console.error("structured-output parser tests failed", error)
  process.exitCode = 1
})
