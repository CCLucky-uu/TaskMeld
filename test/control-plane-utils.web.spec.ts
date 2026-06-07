import assert from "node:assert/strict"
import type { WorkflowDefinition } from "../web/src/entities/pipeline/types"
import {
  validateWorkflowForSave,
  validateWorkflowForRun,
} from "../web/src/pages/control-plane/model/pipelineSaveValidation"
import { buildWorkflowAfterNodeDelete } from "../web/src/pages/control-plane/model/workflowEditUtils"

const makeBaseWorkflow = (): WorkflowDefinition => ({
  version: "3.0",
  scheduler: { enabled: true, mode: "auto", dispatchBy: "item", maxConcurrency: 2 },
  plugins: [
    {
      pluginId: "remote-batch",
      enabled: false,
      config: { url: "", startBatch: 1, batchSize: 5, sourceField: "list30" },
    },
    { pluginId: "scheduler", enabled: true, config: {} },
  ],
  nodes: [
    { id: "n1", name: "n1", lane: "main", isMainline: true, parallelGroupId: null, routePolicy: null },
    { id: "n2", name: "n2", lane: "main", isMainline: true, parallelGroupId: null, routePolicy: null },
    { id: "n3", name: "n3", lane: "main", isMainline: true, parallelGroupId: null, routePolicy: null },
  ],
  edges: [
    { from: "n1", to: "n2", when: null },
    { from: "n2", to: "n3", when: null },
  ],
  groups: [],
})

const run = () => {
  // L1: base workflow should pass save validation
  const ok = validateWorkflowForSave(makeBaseWorkflow())
  assert.equal(ok.ok, true, "base workflow should pass save validation")

  // L1: v2 workflow should be rejected
  const v2Workflow = {
    ...makeBaseWorkflow(),
    version: "2.0",
  } as WorkflowDefinition
  const v2Rejected = validateWorkflowForSave(v2Workflow)
  assert.equal(v2Rejected.ok, false, "v2 workflow should be rejected before save")
  if (!v2Rejected.ok) assert.match(v2Rejected.message, /3\.0/)

  // L2: cyclic graph should fail run validation
  const cyclic = makeBaseWorkflow()
  cyclic.edges.push({ from: "n3", to: "n1", when: null })
  const cyclicResult = validateWorkflowForRun(cyclic)
  assert.equal(cyclicResult.ok, false, "cyclic graph should fail run validation")
  if (!cyclicResult.ok)
    assert.ok(
      cyclicResult.errors.some((e) => /cycle/i.test(e)),
      "should report cycle error",
    )

  // L2: group entry + member direct edge should fail run validation
  const groupEntryAndMember = makeBaseWorkflow()
  groupEntryAndMember.groups = [{ id: "g1", type: "parallel", members: ["n2", "n3"], joinPolicy: "all" }]
  groupEntryAndMember.nodes = groupEntryAndMember.nodes.map((node) =>
    node.id === "n2" || node.id === "n3" ? { ...node, parallelGroupId: "g1" } : node,
  )
  groupEntryAndMember.edges = [
    { from: "n1", to: "g1", when: null },
    { from: "n1", to: "n2", when: null },
  ]
  const groupEntryAndMemberResult = validateWorkflowForRun(groupEntryAndMember)
  // Note: L1 alone would pass this (it only checks data integrity), but L2 catches group structure issues if implemented.
  // The old validateWorkflowBeforeSave was a superset; validateWorkflowForRun covers L1+L2+L3.
  assert.equal(groupEntryAndMemberResult.ok, false, "group entry + member direct edge should fail")
  if (!groupEntryAndMemberResult.ok) assert.ok(groupEntryAndMemberResult.errors.length > 0, "should report errors")

  // L2: group member to member dependency should fail run validation
  const memberCrossDepends = makeBaseWorkflow()
  memberCrossDepends.groups = [{ id: "g1", type: "parallel", members: ["n2", "n3"], joinPolicy: "all" }]
  memberCrossDepends.nodes = memberCrossDepends.nodes.map((node) =>
    node.id === "n2" || node.id === "n3" ? { ...node, parallelGroupId: "g1" } : node,
  )
  memberCrossDepends.edges = [{ from: "n2", to: "n3", when: null }]
  const memberCrossDependsResult = validateWorkflowForRun(memberCrossDepends)
  assert.equal(memberCrossDependsResult.ok, false, "group member to member dependency should fail")
  if (!memberCrossDependsResult.ok) assert.ok(memberCrossDependsResult.errors.length > 0, "should report errors")

  // L1: route node with valid structure should pass save validation
  const routeMainlineAndBranch = makeBaseWorkflow()
  routeMainlineAndBranch.nodes = [
    {
      id: "router",
      name: "router",
      lane: "main",
      isMainline: true,
      parallelGroupId: null,
      routePolicy: { allowed: ["yes", "no"] },
    },
    { id: "main-next", name: "main-next", lane: "main", isMainline: true, parallelGroupId: null, routePolicy: null },
    { id: "no-branch", name: "no-branch", lane: "branch", isMainline: false, parallelGroupId: null, routePolicy: null },
  ]
  routeMainlineAndBranch.edges = [
    { from: "router", to: "main-next", when: null },
    { from: "router", to: "no-branch", when: "no" },
  ]
  const routeMainlineAndBranchResult = validateWorkflowForSave(routeMainlineAndBranch)
  assert.equal(
    routeMainlineAndBranchResult.ok,
    true,
    "route node should allow yes mainline dependency plus no branch route (L1 pass)",
  )

  // L2: "yes" must not be used as a route edge
  const yesRouteEdge = makeBaseWorkflow()
  yesRouteEdge.nodes = routeMainlineAndBranch.nodes
  yesRouteEdge.edges = [
    { from: "router", to: "main-next", when: null },
    { from: "router", to: "no-branch", when: "yes" },
  ]
  const yesRouteEdgeResult = validateWorkflowForRun(yesRouteEdge)
  assert.equal(yesRouteEdgeResult.ok, false, "yes must not be saved as a route edge")
  if (!yesRouteEdgeResult.ok)
    assert.ok(
      yesRouteEdgeResult.errors.some((e) => /yes/i.test(e)),
      "should report yes route error",
    )

  // buildWorkflowAfterNodeDelete tests
  const explicitOutputWorkflow = {
    ...makeBaseWorkflow(),
    output: { mode: "explicit" as const, nodeId: "n2" },
  }
  const deletedOutputWorkflow = buildWorkflowAfterNodeDelete(explicitOutputWorkflow, "n2")
  assert.equal(
    deletedOutputWorkflow.output?.mode,
    "mainline_last",
    "deleting explicit output node should reset output mode before backend save",
  )
  assert.equal(deletedOutputWorkflow.output?.nodeId, null, "deleted output node should not remain referenced")
  assert.deepEqual(
    deletedOutputWorkflow.edges,
    [{ from: "n1", to: "n3", when: null }],
    "deleting middle node should reconnect single dependency predecessor and successor",
  )

  console.log("control-plane-utils web tests passed")
}

run()
