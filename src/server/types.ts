import type { IncomingMessage, ServerResponse } from "node:http";
import type { PipelineRegistry } from "../app/pipeline-registry";

export type ApiHandlerContext = {
  apiPort: number;
  webOrigin: string;
  app: PipelineRegistry;
  serverRuntimeIdentity: {
    serverId: string;
    pid: number;
    port: number;
    endpoint: string;
    startedAt: string;
  };
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PipelineScopedContext = {
  pipelineId: string;
  workflowFilePath: string;
  pushTimeline: (...args: any[]) => void;
  touchRun: (run: any) => void;
  seedRun: (nodes?: any[], itemKeys?: string[]) => any;
  emitPipeline: () => void;
  getRun: () => any;
  setRun: (run: any) => void;
  getTemplateNodes: () => any[];
  setTemplateNodes: (nodes: any[]) => void;
  getWorkflow: () => any;
  setWorkflow: (workflow: any) => void;
  getItemRuns: () => any[];
  drainPipeline: (...args: any[]) => Promise<any>;
  setSchedulerEnabled: (enabled: boolean) => void;
  setSchedulerMode: (mode: string) => void;
  getSchedulerState: () => any;
  getBatchRunState: () => any;
  cancelBatchRun?: () => void;
  executorSessionByAgentId: Map<string, any>;
  getSessionCache: () => any[];
};

export type RequestContext = {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  url: URL;
  params: Record<string, string>;
  options: ApiHandlerContext;
  services: Record<string, unknown>;
  sendJson: (code: number, data: unknown) => void;
  sendRaw: (code: number, headers: Record<string, string>, body: NodeJS.ReadableStream) => void;
  readBody: () => Promise<Record<string, unknown>>;
  getPipelineScope: () => PipelineScopedContext | null;
};

export type RouteHandler = (ctx: RequestContext) => Promise<void> | void;
export type RouteRegistrar = (router: Router) => void;

export interface Router {
  register(method: string, path: string, handler: RouteHandler): void;
  match(method: string, pathname: string): { handler: RouteHandler; params: Record<string, string> } | null;
}
