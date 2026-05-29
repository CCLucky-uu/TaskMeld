export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue };

export type CliRunOptions = {
  argv: string[];
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
  stdin?: NodeJS.ReadableStream;
};

export type CliOutputFormat = "json" | "md";

export type CliGlobalOptions = {
  format: CliOutputFormat;
  envelope: boolean;
};

export type CliCommandContext = {
  app: CliAppContext;
  global: CliGlobalOptions;
};

export type CliCommandHandler = (input: CliCommandInput, ctx: CliCommandContext) => Promise<unknown>;

export type CliCommandInput = {
  args: string[];
  flags: Record<string, string | boolean>;
  stdin?: NodeJS.ReadableStream;
};

export type CliRouteMatch = {
  key: string;
  input: CliCommandInput;
  global: CliGlobalOptions;
};

export type CliArgHelpDefinition = {
  name: string;
  required?: boolean;
  description?: string;
};

export type CliOptionHelpDefinition = {
  flags: string[];
  valueName?: string;
  required?: boolean;
  description?: string;
};

export type CliHelpDefinition = {
  summary?: string;
  usage: string;
  args?: CliArgHelpDefinition[];
  options?: CliOptionHelpDefinition[];
  examples?: string[];
  notes?: string[];
};

export type CliRouteBootstrapMetadata = {
  runtimeApiOnly?: boolean;
  ensureServerReady?: boolean;
  gateway?: "required" | "warmup";
};

export type CliRouteDefinition = {
  key: string;
  path: string[];
  description: string;
  handler: CliCommandHandler;
  help: CliHelpDefinition;
  bootstrap?: CliRouteBootstrapMetadata;
  hidden?: boolean;
  renderHelp?: (route: CliRouteDefinition) => string;
};

export type CliSystemService = {
  getSnapshot(): Promise<unknown>;
};

export type CliServerService = {
  ensureServerReady(): Promise<unknown>;
  startServer(): Promise<unknown>;
  getServerStatus(): Promise<unknown>;
  stopServer(): Promise<unknown>;
};

export type CliPipelineRunIdentityTarget = {
  runId?: string;
  batchRunId?: string;
};

export type CliPipelineSelector = CliPipelineRunIdentityTarget & {
  pipelineId?: string;
};

export type CliPipelineService = {
  listPipelines(): Promise<unknown>;
  getPipelineById(pipelineId: string): Promise<unknown>;
  startPipeline(pipelineId: string): Promise<unknown>;
  getPipelineStatus(selector: string | CliPipelineSelector): Promise<unknown> | unknown;
  stopPipeline(selector: string | CliPipelineSelector): Promise<unknown> | unknown;
  waitForPipelineWatchSignal?: (selector: CliPipelineSelector, timeoutMs: number) => Promise<unknown> | unknown;
  runPipeline(pipelineId: string): Promise<unknown>;
  retryNode(input: { pipelineId: string; nodeId: string; itemKey?: string }): Promise<unknown>;
  diagnoseNode(input: { pipelineId: string; nodeId: string; itemKey?: string }): Promise<unknown>;
  getOutput(pipelineId: string, runId?: string): Promise<unknown>;
  listOutputs(pipelineId: string): Promise<unknown>;
  listLinks(): Promise<unknown>;
  getQueue(pipelineId: string): unknown | Promise<unknown>;
};

export type CliAgentService = {
  listAgents(): Promise<unknown>;
  listSessions(): Promise<unknown>;
  filterSessionsByAgent(agentId: string): Promise<unknown>;
  sendMessage(input: { sessionId: string; message: string; mode?: "auto" | "chat" | "sessions" }): Promise<unknown>;
  getSessionHistory(sessionId: string): Promise<unknown>;
  sendMessageAndWaitForReply(
    input: { sessionId: string; message: string; mode?: "auto" | "chat" | "sessions" },
    options?: { timeoutMs?: number; onChunk?: (text: string) => void },
  ): Promise<unknown>;
};

export type CliSessionService = {
  listSessions(): Promise<unknown>;
  sendMessage(input: { sessionId: string; message: string; mode?: "auto" | "chat" | "sessions" }): Promise<unknown>;
};

export type CliSchedulerService = {
  toggleScheduler(pipelineId: string, enabled: boolean): Promise<unknown> | unknown;
  setSchedulerMode(pipelineId: string, mode: "auto" | "manual"): Promise<unknown> | unknown;
};

export type CliArtifactService = {
  listArtifacts(filter: {
    pipelineId?: string;
    nodeId?: string;
    status?: string;
    kind?: string;
    batchRunId?: string;
    runId?: string;
    cursor?: string;
  }): Promise<unknown>;
  getArtifactContent(filter: { pipelineId: string; relativePath: string }): Promise<unknown>;
  exportArtifacts(filter: {
    pipelineId?: string;
    nodeId?: string;
    status?: string;
    kind?: string;
    batchRunId?: string;
    dateFrom?: string;
    dateTo?: string;
    limit?: number;
  }): Promise<unknown>;
  planCleanup(pipelineId: string, options: {
    olderThanDays?: number;
    statuses?: string[];
  }): Promise<unknown>;
  executeCleanup(pipelineId: string, plan: unknown): Promise<unknown>;
  rebuildIndex(pipelineId?: string): Promise<unknown>;
};

export type CliAppContext = {
  systemService: CliSystemService;
  serverService: CliServerService;
  pipelineService: CliPipelineService;
  agentService: CliAgentService;
  sessionService: CliSessionService;
  artifactService: CliArtifactService;
  schedulerService: CliSchedulerService;
};

export type CliBootstrappedApp = {
  app: CliAppContext;
  dispose?: () => Promise<void> | void;
};

export type CliBootstrapOptions = {
  routeKey: string;
  route: CliRouteDefinition;
};

export type CliBootstrap = (options: CliBootstrapOptions) => Promise<CliBootstrappedApp>;

export type CliPipelineResultNode = {
  nodeId: string;
  title: string;
  status: string;
  lastError?: string | null;
  content: string[];
  logs: unknown[] | null;
};

export type CliPipelineResultBatch = {
  itemKey: string;
  items: string[];
  nodes: CliPipelineResultNode[];
};

export type CliPipelineResult = {
  command: string;
  pipelineId: string;
  title: string;
  runId: string;
  runStatus: string;
  batchRunId?: string | null;
  isBatch: boolean;
  batches: CliPipelineResultBatch[];
  nodes: CliPipelineResultNode[];
};
