import type { Server } from "node:http";
import { WebSocketServer } from "ws";

type WsBrokerOptions = {
  server: Server;
  path?: string;
  getBootstrapPayload: () => unknown;
};

export const createWsBroker = (options: WsBrokerOptions) => {
  const wsServer = new WebSocketServer({
    server: options.server,
    path: options.path ?? "/api/ws",
    maxPayload: 8 * 1024 * 1024,
  });
  const peers = new Set<import("ws").WebSocket>();

  const broadcast = (payload: unknown) => {
    const event = payload as { type?: string } | undefined;
    const type = event?.type ?? "";
    const isHighFrequency = type === "gateway.frame" || type === "timeline.updated";

    const message = JSON.stringify(payload);
    for (const peer of peers) {
      if (peer.readyState !== 1) continue;
      // 慢消费者保护：高频消息在 buffer 堆积时跳过，避免 Node 进程 OOM
      if (isHighFrequency && peer.bufferedAmount > 64 * 1024) continue;
      peer.send(message);
    }
  };

  wsServer.on("connection", (socket) => {
    peers.add(socket);
    socket.send(JSON.stringify({ type: "bootstrap", payload: options.getBootstrapPayload() }));
    socket.on("close", () => {
      peers.delete(socket);
    });
  });

  return {
    broadcast,
    close: () => {
      for (const peer of peers) {
        try {
          peer.close();
        } catch {
          // Ignore close failures on shutdown.
        }
      }
      wsServer.close();
    },
  };
};

export type WsBroker = ReturnType<typeof createWsBroker>;
