import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  defaultTemplateNodes,
  defaultWorkflowDefinition,
  loadWorkflowDefinitionWithStorage,
  readWorkflowDefinitionFromRawDetailed,
  readWorkflowDefinitionFromRaw,
} from "../src/pipeline/template"
import { validateWorkflowGraph } from "../src/pipeline/workflow/validate"
import { validateWorkflowDataIntegrity } from "../src/pipeline/workflow/save-validate"
import { seedRunWithItems } from "../src/pipeline/runtime-model"
import {
  collectEnvelopeCandidates,
  createNodeExecutionPrompt,
  evaluateEnvelopeCandidates,
  evaluateObservedEnvelopeWindow,
  rememberObservedEnvelopes,
  shouldFailFastForCompletedSession,
  type ObservedEnvelope,
} from "../src/pipeline/structured-output"

const run = async () => {
  const toPersistedV3 = (workflowLike: {
    scheduler: unknown
    plugins?: unknown
    nodes: unknown[]
    edges: Array<{ from: string; to: string; when: string | null }>
    groups: unknown[]
  }) => ({
    version: "3.0" as const,
    scheduler: workflowLike.scheduler,
    plugins: workflowLike.plugins ?? [
      {
        pluginId: "remote-batch",
        enabled: false,
        config: { url: "", startBatch: 1, batchSize: 5, sourceField: "list30" },
      },
      { pluginId: "scheduler", enabled: true, config: {} },
    ],
    nodes: workflowLike.nodes,
    edges: workflowLike.edges.map((edge) =>
      edge.when === null
        ? { from: edge.from, to: edge.to, kind: "dependency" as const }
        : { from: edge.from, to: edge.to, kind: "route" as const, route: edge.when },
    ),
    groups: workflowLike.groups,
  })
  const legacy = defaultTemplateNodes()
  const workflow = defaultWorkflowDefinition()

  assert.equal(workflow.version, "3.0")
  assert.equal(legacy.length, 0, "default template should not ship preset workflow nodes")
  assert.equal(workflow.nodes.length, 0, "default workflow should start empty")
  assert.equal(workflow.scheduler.dispatchBy, "item")

  const parsed = readWorkflowDefinitionFromRaw(toPersistedV3(workflow))
  assert.ok(parsed, "workflow should be valid after mapping")
  assert.equal(parsed?.nodes.length, 0)
  const detailedFromPersisted = readWorkflowDefinitionFromRawDetailed(toPersistedV3(workflow))
  assert.equal(detailedFromPersisted.ok, true, "version=3.0 应接受磁盘 kind/route 形状")
  const detailedFromApiWhen = readWorkflowDefinitionFromRawDetailed({
    ...workflow,
    version: "3.0",
  })
  assert.equal(detailedFromApiWhen.ok, true, "version=3.0 应接受 API when 形状")

  const workflowWithStringSchema = readWorkflowDefinitionFromRaw(
    toPersistedV3({
      ...workflow,
      nodes: [
        {
          id: "schema-node",
          name: "Schema Node",
          type: "task",
          enabled: true,
          isMainline: true,
          lane: "main",
          parallelGroupId: null,
          executor: { agentId: "agent-a", role: "coder", fallbackAgentId: null, sessionId: null },
          inputMode: "single",
          outputMode: "single",
          dependencyPolicy: "all",
          routePolicy: null,
          retryPolicy: { maxAttempts: 1, backoffMs: 0 },
          outputSpec: {
            type: "patch.v1",
            // 工作流/API 导入经常来自 JSON 文本或表单，schemaVersion 允许用字符串数字表达。
            schemaVersion: "1",
          },
          instruction: "noop",
          allowReject: false,
          maxRejectCount: 0,
        },
      ],
    }),
  )
  assert.equal(
    workflowWithStringSchema?.nodes[0]?.outputSpec.schemaVersion,
    1,
    "string schemaVersion should normalize to number in workflow definition",
  )

  const runState = seedRunWithItems(legacy, ["kw-1", "kw-2"])
  assert.ok(Array.isArray(runState.itemRuns), "itemRuns should exist")
  assert.equal(runState.itemRuns?.length, legacy.length * 2)

  const roots = legacy.filter((node) => node.dependsOn.length === 0).map((node) => node.id)
  for (const item of runState.itemRuns ?? []) {
    if (roots.includes(item.nodeId)) {
      assert.equal(item.status, "queued")
    } else {
      assert.equal(item.status, "blocked")
    }
  }

  const invalidParsed = readWorkflowDefinitionFromRawDetailed(
    toPersistedV3({
      scheduler: workflow.scheduler,
      plugins: workflow.plugins,
      nodes: workflowWithStringSchema?.nodes ?? [],
      edges: [{ from: "n1", to: "missing", when: null }],
      groups: [],
    }),
  )
  assert.ok(invalidParsed.ok, "parse should succeed (L1 validation is separate)")
  const invalidL1 = validateWorkflowDataIntegrity(invalidParsed.workflow)
  assert.equal(invalidL1.ok, false, "invalid edge should fail L1 data integrity validation")

  const cyclicParsed = readWorkflowDefinitionFromRawDetailed(
    toPersistedV3({
      scheduler: workflow.scheduler,
      plugins: workflow.plugins,
      nodes: workflow.nodes,
      edges: [
        { from: "n1", to: "n2", when: null },
        { from: "n2", to: "n1", when: null },
      ],
      groups: [],
    }),
  )
  assert.ok(cyclicParsed.ok, "parse should succeed (L2 validation is separate)")
  const cyclicL2 = validateWorkflowGraph(cyclicParsed.workflow)
  assert.equal(cyclicL2.ok, false, "cyclic workflow should fail L2 graph validation")

  const v2Rejected = readWorkflowDefinitionFromRawDetailed({
    ...workflow,
    version: "2.0",
  })
  assert.equal(v2Rejected.ok, false, "phase 4 should require explicit v2->v3 migration")
  if (!v2Rejected.ok) {
    assert.equal(v2Rejected.error, "workflow_migration_required")
  }

  const mixedOutgoingParsed = readWorkflowDefinitionFromRawDetailed(
    toPersistedV3({
      ...workflow,
      edges: [
        { from: "n1", to: "n2", when: null },
        { from: "n1", to: "n3", when: "yes" },
      ],
    }),
  )
  assert.ok(mixedOutgoingParsed.ok, "parse should succeed (L2 validation is separate)")
  const mixedOutgoingL2 = validateWorkflowGraph(mixedOutgoingParsed.workflow)
  assert.equal(mixedOutgoingL2.ok, false, "legacy mixed outgoing edges should be rejected by L2")

  const validCheck = validateWorkflowGraph(workflow)
  assert.equal(validCheck.ok, true, "default workflow should pass validation")

  const tempDir = mkdtempSync(join(tmpdir(), "openclaw-invalid-workflow-"))
  const invalidWorkflowFile = join(tempDir, "workflow.json")
  writeFileSync(
    invalidWorkflowFile,
    JSON.stringify({
      version: "3.0",
      scheduler: workflow.scheduler,
      plugins: workflow.plugins,
      nodes: workflow.nodes,
      edges: [
        { from: "n1", to: "n2", kind: "dependency" },
        { from: "n1", to: "n3", kind: "route", route: "yes" },
      ],
      groups: [],
    }),
    "utf8",
  )
  // After refactoring, loadWorkflowDefinitionWithStorage no longer validates graph structure (L2).
  // It only normalizes. Graph validation is the caller's responsibility.
  const loadedInvalid = loadWorkflowDefinitionWithStorage({ workflowFilePath: invalidWorkflowFile })
  const invalidGraphCheck = validateWorkflowGraph(loadedInvalid)
  assert.equal(invalidGraphCheck.ok, false, "invalid persisted workflow should fail L2 graph validation")

  const observed: ObservedEnvelope[] = []
  const requestId = "node-n2-17089918-3e3b-4efe-a77b-2946e1e346a9"
  rememberObservedEnvelopes(
    observed,
    {
      version: "2.0",
      runId: "run-1776517077519",
      nodeId: "n2",
      requestId,
      sessionId: "agent:wxclaw:main",
      status: "success",
      artifacts: [
        {
          type: "patch.v1",
          schemaVersion: "1",
          name: "primary",
          content: [{ label: "noop", route: "no", value: null }],
          meta: {},
        },
      ],
      control: {
        sleepUntil: null,
        retryFromNodeId: null,
      },
      logs: [],
      error: null,
    },
    "test",
  )
  const evaluated = evaluateEnvelopeCandidates(
    observed.map((entry) => entry.envelope),
    {
      runId: "run-1776517077519",
      nodeId: "n2",
      requestId,
      sessionId: "agent:wxclaw:main",
      outputSpec: { type: "patch.v1", schemaVersion: 1 },
    },
  )
  assert.equal(evaluated.violation, undefined, "string schemaVersion should pass envelope validation")
  assert.equal(evaluated.envelope?.artifacts[0]?.schemaVersion, 1, "envelope schemaVersion should normalize to number")

  const mixedTextEnvelopes = collectEnvelopeCandidates({
    message: {
      role: "assistant",
      // 真实流式节点常先输出说明，再在同一文本块尾部拼上 JSON。
      // 这里固定回归该场景，避免再次把合法 ResultEnvelope 误判成 missing。
      content: [
        {
          type: "text",
          text:
            "This is the analysis prefix. " +
            JSON.stringify({
              version: "2.0",
              runId: "run-1776517077519",
              nodeId: "n2",
              requestId,
              sessionId: "agent:wxclaw:main",
              status: "success",
              artifacts: [
                {
                  type: "patch.v1",
                  schemaVersion: 1,
                  name: "primary",
                  content: [{ label: "noop", route: "no", value: null }],
                  meta: {},
                },
              ],
              control: {
                sleepUntil: null,
                retryFromNodeId: null,
              },
              logs: [],
              error: null,
            }),
        },
      ],
    },
  })
  assert.equal(mixedTextEnvelopes.length, 1, "mixed text should still yield one envelope candidate")
  assert.equal(mixedTextEnvelopes[0]?.requestId, requestId, "embedded envelope should keep the expected requestId")

  const delayedObserved: ObservedEnvelope[] = []
  rememberObservedEnvelopes(
    delayedObserved,
    {
      message: {
        role: "assistant",
        content: [
          {
            type: "text",
            text:
              "prefix " +
              JSON.stringify({
                version: "2.0",
                runId: "run-1776517077519",
                nodeId: "n2",
                requestId,
                sessionId: "agent:wxclaw:main",
                status: "success",
                artifacts: [
                  {
                    type: "patch.v1",
                    schemaVersion: 1,
                    name: "draft",
                    content: [{ label: "draft", route: "no", value: null }],
                    meta: {},
                  },
                ],
                control: { sleepUntil: null, retryFromNodeId: null },
                logs: [],
                error: null,
              }),
          },
        ],
      },
    },
    "event:agent",
  )
  const pendingObserved = evaluateObservedEnvelopeWindow(delayedObserved, {
    runId: "run-1776517077519",
    nodeId: "n2",
    requestId,
    sessionId: "agent:wxclaw:main",
    outputSpec: { type: "patch.v1", schemaVersion: 1 },
  })
  assert.equal(pendingObserved.envelope, undefined, "session not completed should not confirm envelope early")
  assert.equal(pendingObserved.violation, undefined, "session not completed should not fail early")
  assert.equal(pendingObserved.seenCandidate, true, "session not completed should still remember seen candidates")

  rememberObservedEnvelopes(
    delayedObserved,
    {
      version: "2.0",
      runId: "run-1776517077519",
      nodeId: "n2",
      requestId,
      sessionId: "agent:wxclaw:main",
      status: "success",
      artifacts: [
        {
          type: "patch.v1",
          schemaVersion: 1,
          name: "final",
          content: [{ label: "final", route: "no", value: null }],
          meta: {},
        },
      ],
      control: {
        sleepUntil: null,
        retryFromNodeId: null,
      },
      logs: [],
      error: null,
    },
    "event:chat.final",
  )
  const confirmedObserved = evaluateObservedEnvelopeWindow(
    delayedObserved,
    {
      runId: "run-1776517077519",
      nodeId: "n2",
      requestId,
      sessionId: "agent:wxclaw:main",
      outputSpec: { type: "patch.v1", schemaVersion: 1 },
    },
    { confirmFinal: true },
  )
  assert.equal(
    confirmedObserved.envelope?.artifacts[0]?.name,
    "final",
    "final confirmation should use the latest valid envelope",
  )

  assert.equal(
    shouldFailFastForCompletedSession(Date.now() - 5_000),
    true,
    "ended session without envelope should enter the fast-fail branch",
  )
  assert.equal(
    shouldFailFastForCompletedSession(Date.now()),
    false,
    "fresh completion signal should still respect the grace period",
  )

  const routePrompt = createNodeExecutionPrompt({
    runId: "run-route-1",
    nodeId: "n-route",
    nodeTitle: "分流判断",
    requestId: "req-route-1",
    sessionId: "agent:router:main",
    dependencies: ["n1"],
    dependencyArtifacts: [],
    outputSpec: { type: "route.v1", schemaVersion: 1 },
    instruction: "请根据命中结果把条目分发到对应下游节点。",
    allowReject: true,
    maxRejectCount: 3,
    rejectFeedbacks: ["需要补充命中依据"],
    allowedRoutes: ["yes", "no"],
    routeTargets: [
      {
        route: "yes",
        targetNodeId: "n-yes",
        targetNodeTitle: "命中处理",
        targetAgentId: "coder-a",
        lane: "branch",
      },
      {
        route: "no",
        targetNodeId: "n-no",
        targetNodeTitle: "忽略处理",
        targetAgentId: "coder-b",
        lane: "branch",
      },
    ],
  })
  assert.match(routePrompt, /## Routing Rules/, "route node prompt should include route rules")
  assert.match(routePrompt, /`yes` -> `n-yes`/, "route node prompt should include route target mapping")
  assert.match(
    routePrompt,
    /## Node Objective\n请根据命中结果把条目分发到对应下游节点。/,
    "route node prompt should keep node target",
  )
  assert.match(
    routePrompt,
    /## Downstream Rejection Feedback \(please prioritize fixes\)/,
    "route node prompt should keep reject feedback section",
  )
  assert.match(
    routePrompt,
    /## Rejection Configuration/,
    "allowReject=true prompt should include reject config section",
  )
  assert.match(routePrompt, /### Rejection Rules/, "allowReject=true prompt should include reject rules section")

  const noRejectPrompt = createNodeExecutionPrompt({
    runId: "run-no-reject-1",
    nodeId: "n-no-reject",
    nodeTitle: "常规处理",
    requestId: "req-no-reject-1",
    sessionId: "agent:normal:main",
    dependencies: ["n1"],
    dependencyArtifacts: [],
    outputSpec: { type: "patch.v1", schemaVersion: 1 },
    instruction: "执行常规处理并输出结果。",
    allowReject: false,
    maxRejectCount: 3,
    rejectFeedbacks: [],
    allowedRoutes: [],
    routeTargets: [],
  })
  assert.doesNotMatch(
    noRejectPrompt,
    /## Rejection Configuration/,
    "allowReject=false prompt should not include reject config section",
  )
  assert.doesNotMatch(
    noRejectPrompt,
    /### Rejection Rules/,
    "allowReject=false prompt should not include reject rules section",
  )

  console.log("workflow-v2 tests passed")
}

void run().catch((error) => {
  console.error("workflow-v2 tests failed", error)
  process.exitCode = 1
})
