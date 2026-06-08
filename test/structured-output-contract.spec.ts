import assert from "node:assert/strict"
import {
  validateEnvelope,
  type EnvelopeValidationContext,
  type ResultEnvelope,
} from "../src/pipeline/structured-output/contract"

const ctx: EnvelopeValidationContext = {
  runId: "run-1",
  nodeId: "n1",
  requestId: "req-1",
  sessionId: "agent:n1:main",
  outputSpec: { type: "brief.v1", schemaVersion: 1 },
}

const makeEnvelope = (content: ResultEnvelope["artifacts"][number]["content"]): ResultEnvelope => ({
  version: "2.0",
  runId: "run-1",
  nodeId: "n1",
  requestId: "req-1",
  sessionId: "agent:n1:main",
  status: "success",
  artifacts: [
    {
      type: "brief.v1",
      schemaVersion: 1,
      name: "primary",
      content,
      meta: {},
    },
  ],
  control: { sleepUntil: null, retryFromNodeId: null },
  logs: [],
  error: null,
})

const run = () => {
  const emptyContents: Array<ResultEnvelope["artifacts"][number]["content"]> = [
    null,
    "",
    "   ",
    [],
    {},
    ["", null, []],
    { summary: "", items: [] },
  ]

  for (const content of emptyContents) {
    const result = validateEnvelope(makeEnvelope(content), ctx)
    assert.equal(result.ok, false, `success envelope with empty content should fail: ${JSON.stringify(content)}`)
    if (!result.ok) assert.equal(result.code, "artifact_content_invalid")
  }

  const validContents: Array<ResultEnvelope["artifacts"][number]["content"]> = [
    "done",
    0,
    false,
    ["item"],
    { summary: "done" },
  ]

  for (const content of validContents) {
    const result = validateEnvelope(makeEnvelope(content), ctx)
    assert.equal(result.ok, true, `non-empty content should pass: ${JSON.stringify(content)}`)
  }

  console.log("structured-output contract tests passed")
}

run()
