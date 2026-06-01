import { GatewayStatus } from "../../entities/gateway";
import { ItemBatchRunState, PipelineId, PipelineNode, Run, WorkflowSchedulerState } from "../../entities/pipeline";
import { TimelineItem } from "../../entities/timeline";

export type PipelineBootstrapEntry = {
  pipelineId: PipelineId;
  title: string;
  run?: Run;
  runId?: string;
  pipeline?: PipelineNode[];
  scheduler?: WorkflowSchedulerState;
  batchRunState?: ItemBatchRunState | null;
};

export type GatewayBootstrapPayload = {
  status?: GatewayStatus;
  run?: Run;
  runId?: string;
  pipeline?: PipelineNode[];
  timeline?: TimelineItem[];
  timelineHasMore?: boolean;
  hello?: { server?: { version?: string } };
  scheduler?: WorkflowSchedulerState;
  // bootstrap now allows the server to return mappings for arbitrary pipelineIds, not limited to fixed union-type keys.
  pipelines?: Record<string, PipelineBootstrapEntry>;
};

export type GatewayStatusPayload = GatewayStatus;
export type GatewayReadyPayload = { server?: { version?: string } };
export type PipelineUpdatedPayload = {
  pipelineId?: PipelineId;
  run?: Run;
  runId?: string;
  nodes?: PipelineNode[];
  scheduler?: WorkflowSchedulerState;
  batchRunState?: ItemBatchRunState | null;
};
export type TimelineUpdatedPayload = { item?: TimelineItem; pipelineId?: string };
export type GatewayFramePayload =
  | { type: "req"; id: string; method: string; params?: Record<string, unknown> }
  | { type: "res"; id: string; ok: boolean; payload?: unknown; error?: unknown }
  | { type: "event"; event: string; payload?: unknown; seq?: number; stateVersion?: number };

export type GatewayWsEvent =
  | { type: "bootstrap"; payload?: GatewayBootstrapPayload }
  | { type: "gateway.status"; payload?: GatewayStatusPayload }
  | { type: "gateway.ready"; payload?: GatewayReadyPayload }
  | { type: "gateway.frame"; payload?: GatewayFramePayload }
  | { type: "pipeline.updated"; payload?: PipelineUpdatedPayload }
  | { type: "timeline.updated"; payload?: TimelineUpdatedPayload }
  | { type: string; payload?: unknown };

export type GatewayWsHandlers = {
  bootstrap?: (payload?: GatewayBootstrapPayload) => void;
  gatewayStatus?: (payload?: GatewayStatusPayload) => void;
  gatewayReady?: (payload?: GatewayReadyPayload) => void;
  gatewayFrame?: (payload?: GatewayFramePayload) => void;
  pipelineUpdated?: (payload?: PipelineUpdatedPayload) => void;
  timelineUpdated?: (payload?: TimelineUpdatedPayload) => void;
  unknown?: (event: GatewayWsEvent) => void;
};

export function parseGatewayWsEvent(raw: string): GatewayWsEvent | null {
  try {
    const parsed = JSON.parse(raw) as { type?: unknown; payload?: unknown };
    if (typeof parsed?.type !== "string") {
      return null;
    }
    return {
      type: parsed.type,
      payload: parsed.payload,
    };
  } catch {
    return null;
  }
}

export function dispatchGatewayWsEvent(event: GatewayWsEvent, handlers: GatewayWsHandlers) {
  switch (event.type) {
    case "bootstrap":
      handlers.bootstrap?.(event.payload as GatewayBootstrapPayload | undefined);
      return;
    case "gateway.status":
      handlers.gatewayStatus?.(event.payload as GatewayStatusPayload | undefined);
      return;
    case "gateway.ready":
      handlers.gatewayReady?.(event.payload as GatewayReadyPayload | undefined);
      return;
    case "gateway.frame":
      handlers.gatewayFrame?.(event.payload as GatewayFramePayload | undefined);
      return;
    case "pipeline.updated":
      handlers.pipelineUpdated?.(event.payload as PipelineUpdatedPayload | undefined);
      return;
    case "timeline.updated":
      handlers.timelineUpdated?.(event.payload as TimelineUpdatedPayload | undefined);
      return;
    default:
      handlers.unknown?.(event);
  }
}
