import type { WorkflowOutputConfig } from "./pipeline-output";
import type { PluginInstance } from "../plugins/types";

export type { WorkflowOutputConfig };
export type { PluginInstance, PluginType } from "../plugins/types";

// WorkflowPlugins is an array of PluginInstance (from the new plugin system)
export type WorkflowPlugins = PluginInstance[];

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
  /** Explicit branch scope identifier (e.g. "router:a"), replacing inference from incoming edge shapes. null or missing means mainline. */
  branchScopeId?: string | null;
  /** The routing node ID that produces this branch. null or missing means a mainline node. */
  routeSourceNodeId?: string | null;
  /** The route value that matches this branch. null or missing means not reached via routing. */
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
