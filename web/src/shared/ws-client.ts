import { GatewayWsEvent, parseGatewayWsEvent } from "./realtime/gateway-events";

// Base constants
export const API_BASE = import.meta.env.VITE_API_BASE ?? "";
export const WS_BASE = API_BASE.replace(/^http/i, "ws");

// Unified error class
export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

// WS request client
type PendingRequest = {
  resolve: (payload: unknown) => void;
  reject: (error: Error) => void;
};

let requestCounter = 0;
const pending = new Map<string, PendingRequest>();
const eventHandlers = new Set<(event: GatewayWsEvent) => void>();
let ws: WebSocket | null = null;
let disposed = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let connectPromise: Promise<void> | null = null;
let connectError: Error | null = null;

const connect = (): Promise<void> => {
  if (ws?.readyState === WebSocket.OPEN) return Promise.resolve();
  if (connectPromise) {
    if (connectError) {
      connectPromise = null;
      const err = connectError;
      connectError = null;
      return Promise.reject(err);
    }
    return connectPromise;
  }
  connectPromise = new Promise((resolve, reject) => {
    ws = new WebSocket(`${WS_BASE}/api/ws`);
    ws.onopen = () => {
      if (disposed) { ws?.close(); return; }
      connectPromise = null;
      connectError = null;
      resolve();
    };
    ws.onerror = () => {
      connectPromise = null;
      connectError = new Error("ws_connect_failed");
      reject(connectError);
    };
    ws.onmessage = (raw) => {
      let frame: { type?: string; id?: string; ok?: boolean; payload?: unknown; error?: unknown };
      try { frame = JSON.parse(raw.data as string); } catch { return; }
      if (frame.type === "res" && frame.id && pending.has(frame.id)) {
        const entry = pending.get(frame.id)!;
        pending.delete(frame.id);
        if (frame.ok) entry.resolve(frame.payload);
        else entry.reject(new ApiError(String(frame.error ?? "request_failed"), 500, frame.error));
        return;
      }
      const event = parseGatewayWsEvent(raw.data as string);
      if (event) {
        for (const handler of eventHandlers) handler(event);
      }
    };
    ws.onclose = () => {
      connectPromise = null;
      if (!disposed) {
        reconnectTimer = setTimeout(() => { connect().catch(() => {}); }, 1000);
      }
    };
  });
  return connectPromise;
};

export const disconnect = () => {
  disposed = true;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  ws?.close();
};

export const wsRequest = async <T = unknown>(
  method: string,
  params: Record<string, unknown> = {},
): Promise<T> => {
  await connect();
  const id = `req-${++requestCounter}`;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (p: unknown) => void, reject });
    ws!.send(JSON.stringify({ type: "req", id, method, params }));
  });
};

export const onWsEvent = (handler: (event: GatewayWsEvent) => void): (() => void) => {
  eventHandlers.add(handler);
  return () => { eventHandlers.delete(handler); };
};
