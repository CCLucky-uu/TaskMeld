import type { PipelineRegistry } from "../../app/pipeline-registry";
import type { PipelineService } from "../../services/pipeline-service";
import type { SchedulerService } from "../../services/scheduler-service";

export type WsMethodServices = {
  pipelineService: PipelineService;
  schedulerService: SchedulerService;
  runLogService: {
    listRuns: () => Promise<string[]>;
    queryTimeline: (query: {
      runId: string;
      offset?: number;
      limit?: number;
      keyword?: string;
      levels?: Array<"info" | "warn" | "error">;
      order?: "asc" | "desc";
    }) => Promise<unknown>;
    readRawTimeline: (runId: string) => Promise<string>;
  } | null;
  client: {
    sendReq: (method: string, params?: Record<string, unknown>, opts?: { sideEffect?: boolean }) => Promise<unknown>;
  };
  getLatestStatus: () => unknown;
  getLatestHello: () => unknown;
  getLastFrame: () => unknown;
  getTimeline: () => unknown[];
  pickArray: (payload: unknown) => unknown[];
  refreshSessionsFromGateway: () => Promise<{ payload: unknown; items: Array<{ id: string; raw: Record<string, unknown> }> }>;
  getSessionCache: () => Array<{ id: string; raw: Record<string, unknown> }>;
};

export type WsMethodContext = {
  app: PipelineRegistry;
  params: Record<string, string>;
  services: WsMethodServices;
};

export type WsMethodHandler = (
  params: Record<string, unknown>,
  ctx: WsMethodContext,
) => { ok: boolean; payload?: unknown; error?: string }
  | Promise<{ ok: boolean; payload?: unknown; error?: string }>;

export type WsMethodRegistry = {
  register(method: string, handler: WsMethodHandler): void;
  dispatch(method: string): WsMethodHandler | null;
};
