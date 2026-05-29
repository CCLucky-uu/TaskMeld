export type PipelineNodeStatus =
  | "queued"
  | "running"
  | "success"
  | "failed"
  | "blocked"
  | "rejected"
  | "waiting"
  | "skipped"
  | "stopped";
export type ExecutorRole = "planner" | "coder" | "tester" | "reviewer" | "operator";
export type PipelineId = string;

export type NodeExecutor = {
  agentId: string;
  role: ExecutorRole;
  fallbackAgentId: string | null;
  sessionId: string | null;
};

export type ArtifactManifest = {
  id: string;
  type: string;
  schemaVersion: number;
  name: string;
  path: string;
  hash: string;
  sourceNodeId: string;
  createdAt: string;
};

export type NodeRun = {
  id: string;
  title: string;
  executor: NodeExecutor;
  instruction: string;
  outputSpec: { type: string; schemaVersion: number };
  allowReject: boolean;
  maxRejectCount: number;
  status: PipelineNodeStatus;
  dependsOn: string[];
  artifacts: ArtifactManifest[];
  attempt: number;
  rejectCount: number;
  startedAt: string | null;
  finishedAt: string | null;
  lastError: string | null;
  isMainline?: boolean;
  lane?: "main" | "branch";
  parallelGroupId?: string | null;
};

export type RunStatus = "running" | "success" | "failed" | "stopped";

export type GroupRun = {
  id: string;
  title: string;
  status: PipelineNodeStatus;
  members: string[];
  joinPolicy: "all" | "any" | "quorum";
  artifacts: ArtifactManifest[];
  startedAt: string | null;
  finishedAt: string | null;
  lastError: string | null;
};

export type GroupItemRun = {
  id: string;
  groupId: string;
  itemKey: string;
  status: PipelineNodeStatus;
  attempt: number;
  startedAt: string | null;
  finishedAt: string | null;
  lastError: string | null;
  artifacts: ArtifactManifest[];
};

export type PipelineOutputArtifactRef = {
  pipelineId: string;
  runId: string;
  batchRunId: string | null;
  nodeId: string;
  itemKey: string | null;
  relativePath: string;
  absolutePath: string;
  type: string;
  schemaVersion: number;
  name: string;
  hash: string;
  createdAt: string;
};

export type PipelineOutput = {
  schemaVersion: 1;
  outputId: string;
  pipelineId: string;
  runId: string;
  batchRunId: string | null;
  itemKey: string | null;
  outputNodeId: string;
  artifactId: string;
  artifactRef: PipelineOutputArtifactRef;
  producedAt: string;
};

export type PipelineLinkInputContract = {
  requireType?: string;
  requireSchemaVersion?: number;
};

export type PipelineLink = {
  schemaVersion: 1;
  id: string;
  enabled: boolean;
  fromPipelineId: string;
  toPipelineId: string;
  trigger: "on_success";
  dispatchPolicy: "fifo";
  inputContract: PipelineLinkInputContract | null;
  onJobFailed: "continue" | "pause";
  maxPendingJobs: number;
  createdAt: string;
  updatedAt: string;
};

export type PipelineInboundJobStatus = "pending" | "running" | "success" | "failed" | "canceled";

export type PipelineInboundJob = {
  schemaVersion: 1;
  jobId: string;
  linkId: string;
  fromPipelineId: string;
  toPipelineId: string;
  status: PipelineInboundJobStatus;
  upstreamOutput: PipelineOutput;
  targetRunId: string | null;
  attempts: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
};

export type RunInput =
  | { trigger: "manual" }
  | {
      trigger: "pipeline_link";
      inboundJobId: string;
      linkId: string;
      upstreamOutput: PipelineOutput;
    };

export type Run = {
  id: string;
  status: RunStatus;
  createdAt: string;
  updatedAt: string;
  input?: RunInput;
  nodes: NodeRun[];
  itemRuns?: NodeItemRun[];
  groups?: GroupRun[];
  groupItemRuns?: GroupItemRun[];
  output?: PipelineOutput | null;
};

export type WorkflowSchedulerState = {
  enabled: boolean;
  mode: "auto" | "manual";
};

export type ItemBatchRunState = {
  status: "idle" | "running" | "completed" | "failed" | "stopped";
  batchSize: number;
  totalItems: number;
  totalBatches: number;
  processedItems: number;
  processedBatches: number;
  nextBatchIndex: number;
  startedAt: string | null;
  finishedAt: string | null;
  lastBatchItems: string[];
  error: string | null;
  stopRequested: boolean;
};

export type PipelineListItem = {
  id: PipelineId;
  title: string;
};

export type WorkflowRemoteBatchPlugin = {
  enabled: boolean;
  url: string;
  startBatch: number;
  batchSize: number;
  sourceField: string;
};

export type WorkflowSchedulerPlugin = {
  enabled: boolean;
};

export type WorkflowPlugins = {
  remoteBatch: WorkflowRemoteBatchPlugin;
  scheduler: WorkflowSchedulerPlugin;
};

export type WorkflowNode = {
  id: string;
  name: string;
  type?: string;
  enabled?: boolean;
  executor?: NodeExecutor;
  instruction?: string;
  outputSpec?: { type: string; schemaVersion: number };
  allowReject?: boolean;
  maxRejectCount?: number;
  inputMode?: "single" | "batch";
  outputMode?: "single" | "array";
  retryPolicy?: { maxAttempts: number; backoffMs: number };
  lane?: "main" | "branch";
  dependencyPolicy?: "all" | "any";
  isMainline?: boolean;
  parallelGroupId?: string | null;
  routePolicy?: {
    allowed: string[];
  } | null;
};

export type WorkflowDefinition = {
  version: "3.0";
  scheduler: WorkflowSchedulerState & {
    dispatchBy?: "item" | "node";
    maxConcurrency?: number;
    loopGuard?: { maxGlobalIterations: number; maxPerItemLoop: number };
  };
  plugins: WorkflowPlugins;
  nodes: WorkflowNode[];
  edges: Array<{ from: string; to: string; when: string | null }>;
  groups: WorkflowGroup[];
};

export type WorkflowGroup = {
  id: string;
  type: "parallel";
  members: string[];
  joinPolicy: "all" | "any" | "quorum";
};

export type NodeItemRun = {
  id: string;
  itemKey: string;
  nodeId: string;
  status: PipelineNodeStatus;
  route: string | null;
  attempt: number;
  loopCount: number;
  wakeAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  lastError: string | null;
  artifacts: ArtifactManifest[];
};

export type PipelineTemplateNode = {
  id: string;
  title: string;
  executor: NodeExecutor;
  instruction: string;
  outputSpec: { type: string; schemaVersion: number };
  dependsOn: string[];
  allowReject: boolean;
  maxRejectCount: number;
};

// Compatibility aliases for existing callers.
export type PipelineNode = NodeRun;
