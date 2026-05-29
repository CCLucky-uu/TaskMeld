import { WS_BASE } from "./client";
import { GatewayWsEvent, parseGatewayWsEvent } from "../realtime/gateway-events";

export function connectGatewayWs(onEvent: (event: GatewayWsEvent) => void): () => void {
  let disposed = false;
  const ws = new WebSocket(`${WS_BASE}/api/ws`);

  ws.onopen = () => {
    if (disposed) ws.close();
  };

  ws.onmessage = (event) => {
    if (disposed) return;
    const parsed = parseGatewayWsEvent(event.data as string);
    if (!parsed) return;
    onEvent(parsed);
  };

  return () => {
    disposed = true;
    if (ws.readyState === WebSocket.OPEN) {
      ws.close();
    } else {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
    }
  };
}
