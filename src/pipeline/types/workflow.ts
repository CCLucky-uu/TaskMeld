import type { WorkflowOutputConfig } from "./pipeline-output";

export type { WorkflowOutputConfig };

export type ExecutorRole = "planner" | "coder" | "tester" | "reviewer" | "operator";

export type NodeExecutor = {
  agentId: string;
  role: ExecutorRole;
  fallbackAgentId: string | null;
  sessionId: string | null;
};

export type OutputSpec = {
  type: string;
  schemaVersion: number;
};

export type PipelineTemplateNode = {
  id: string;
  title: string;
  executor: NodeExecutor;
  instruction: string;
  outputSpec: OutputSpec;
  dependsOn: string[];
  allowReject: boolean;
  maxRejectCount: number;
};

export type WorkflowDispatchBy = "item" | "node";
export type WorkflowSchedulerMode = "auto" | "manual";
export type WorkflowNodeLane = "main" | "branch";
export type WorkflowJoinPolicy = "all";

export type WorkflowScheduler = {
  enabled: boolean;
  mode: WorkflowSchedulerMode;
  dispatchBy: WorkflowDispatchBy;
  maxConcurrency: number;
  loopGuard: {
    maxGlobalIterations: number;
    maxPerItemLoop: number;
  };
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

export type WorkflowRoutePolicy = {
  allowed: string[];
};

export type WorkflowRetryPolicy = {
  maxAttempts: number;
  backoffMs: number;
};

export type WorkflowNode = {
  id: string;
  name: string;
  type: string;
  enabled: boolean;
  isMainline: boolean;
  lane: WorkflowNodeLane;
  parallelGroupId: string | null;
  executor: NodeExecutor;
  inputMode: "single" | "batch";
  outputMode: "single" | "array";
  dependencyPolicy?: "all" | "any";
  routePolicy: WorkflowRoutePolicy | null;
  retryPolicy: WorkflowRetryPolicy;
  outputSpec: OutputSpec;
  instruction: string;
  allowReject: boolean;
  maxRejectCount: number;
  /** 显式支线作用域标识（如 "router:a"），替代基于入边形状的推断。null 或缺失表示主线。 */
  branchScopeId?: string | null;
  /** 产生该支线的路由节点 ID。null 或缺失表示主线节点。 */
  routeSourceNodeId?: string | null;
  /** 命中该支线的路由值。null 或缺失表示未通过路由到达。 */
  routeValue?: string | null;
};

export type WorkflowEdge = {
  from: string;
  to: string;
  when: string | null;
};

export type WorkflowEdgeV3 =
  | {
    from: string;
    to: string;
    kind: "dependency";
  }
  | {
    from: string;
    to: string;
    kind: "route";
    route: string;
  };

export type WorkflowGroup = {
  id: string;
  type: "parallel";
  members: string[];
  joinPolicy: WorkflowJoinPolicy;
};

export type WorkflowDefinitionRuntime = {
  version: "3.0";
  scheduler: WorkflowScheduler;
  plugins: WorkflowPlugins;
  output?: WorkflowOutputConfig;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  groups: WorkflowGroup[];
};

export type WorkflowDefinitionV3 = {
  version: "3.0";
  scheduler: WorkflowScheduler;
  plugins: WorkflowPlugins;
  nodes: WorkflowNode[];
  edges: WorkflowEdgeV3[];
  groups: WorkflowGroup[];
};

export type WorkflowValidationResult = {
  ok: true;
} | {
  ok: false;
  error: string;
  detail: string;
};

export type WorkflowReadResult = {
  ok: true;
  workflow: WorkflowDefinitionRuntime;
} | {
  ok: false;
  error: string;
  detail: string;
};

export type WorkflowPersistedEdgeV3 = {
  from: string;
  to: string;
  kind: "dependency" | "route";
  route?: string;
};

export type WorkflowPersistedV3 = Omit<WorkflowDefinitionRuntime, "edges"> & {
  version: "3.0";
  edges: WorkflowPersistedEdgeV3[];
};

export type WorkflowStorageOptions = {
  workflowFilePath?: string;
};
