import type { WsMethodHandler, WsMethodRegistry, WsMethodContext, WsMethodServices } from "./ws-methods/types";
import type { PipelineRegistry } from "../app/pipeline-registry";
import type { WebSocket } from "ws";

export const createWsMethodRegistry = (): WsMethodRegistry => {
  const methods = new Map<string, WsMethodHandler>();

  return {
    register(method: string, handler: WsMethodHandler) {
      if (methods.has(method)) {
        throw new Error(`duplicate_ws_method:${method}`);
      }
      methods.set(method, handler);
    },
    dispatch(method: string): WsMethodHandler | null {
      return methods.get(method) ?? null;
    },
  };
};

export const createWsRequestHandler = (
  app: PipelineRegistry,
  services: WsMethodServices,
) => {
  const registry = createWsMethodRegistry();

  const handleMessage = (socket: WebSocket, raw: string) => {
    let frame: { type?: string; id?: string; method?: string; params?: Record<string, unknown> };
    try {
      frame = JSON.parse(raw);
    } catch {
      return;
    }

    if (frame.type !== "req" || typeof frame.id !== "string" || typeof frame.method !== "string") {
      return;
    }

    const handler = registry.dispatch(frame.method);
    const sendRes = (ok: boolean, payload?: unknown, error?: string) => {
      socket.send(JSON.stringify({ type: "res", id: frame.id, ok, payload, error }));
    };

    if (!handler) {
      sendRes(false, undefined, `unknown_method:${frame.method}`);
      return;
    }

    const ctx: WsMethodContext = {
      app,
      params: Object.fromEntries(
        Object.entries(frame.params ?? {}).filter(([_, v]) => typeof v === "string"),
      ) as Record<string, string>,
      services,
    };

    try {
      const result = handler(frame.params ?? {}, ctx);
      if (result instanceof Promise) {
        result.then(
          (r) => sendRes(r.ok, r.payload, r.error),
          (err) => sendRes(false, undefined, err instanceof Error ? err.message : "internal_error"),
        );
      } else {
        sendRes(result.ok, result.payload, result.error);
      }
    } catch (err) {
      sendRes(false, undefined, err instanceof Error ? err.message : "internal_error");
    }
  };

  return { registry, handleMessage };
};
