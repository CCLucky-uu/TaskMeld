import assert from "node:assert/strict";
import { buildWorkflowAfterNodeDelete } from "../web/src/pages/control-plane/model/workflowEditUtils";
import type { WorkflowDefinition } from "../web/src/entities/pipeline/types";

const makeBaseWorkflow = (): WorkflowDefinition => ({
  version: "3.0",
  scheduler: { enabled: true, mode: "auto", dispatchBy: "item", maxConcurrency: 2 },
  plugins: {
    remoteBatch: { enabled: false, url: "", startBatch: 1, batchSize: 5, sourceField: "list30" },
    scheduler: { enabled: true },
  },
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
});

const run = () => {
  const explicitOutputWorkflow = {
    ...makeBaseWorkflow(),
    output: { mode: "explicit" as const, nodeId: "n2" },
  };
  const deletedOutputWorkflow = buildWorkflowAfterNodeDelete(explicitOutputWorkflow, "n2");

  assert.equal(
    deletedOutputWorkflow.output?.mode,
    "mainline_last",
    "删除显式输出节点时应先重置 output，避免后端保存拒绝",
  );
  assert.equal(deletedOutputWorkflow.output?.nodeId, null);
  assert.deepEqual(deletedOutputWorkflow.edges, [{ from: "n1", to: "n3", when: null }]);

  console.log("workflow edit utils tests passed");
};

run();
