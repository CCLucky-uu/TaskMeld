export type PipelineRunIdentity = {
  pipelineId: string;
  runId: string;
  batchRunId: string | null;
};

export type PipelineItemIdentity = PipelineRunIdentity & {
  itemKey: string;
};

export type NodeExecutionIdentity = PipelineItemIdentity & {
  nodeId: string;
  requestId: string;
  sessionId: string;
};
