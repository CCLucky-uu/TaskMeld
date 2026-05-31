import WebSocket from "ws";

type PendingReq = {
  resolve: (payload: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

export const createWsRuntimeClient = (wsUrl: string) => {
  let socket: WebSocket;
  let ready = false;
  const pending = new Map<string, PendingReq>();
  let reqCounter = 0;

  const connect = (timeoutMs = 10_000): Promise<void> => {
    return new Promise((resolve, reject) => {
      socket = new WebSocket(wsUrl);
      const timeout = setTimeout(() => reject(new Error("ws_connect_timeout")), timeoutMs);
      socket.on("open", () => { clearTimeout(timeout); });
      socket.on("message", (raw) => {
        const frame = JSON.parse(raw.toString());
        if (frame.type === "bootstrap") {
          ready = true;
          resolve();
          return;
        }
        if (frame.type === "res" && frame.id && pending.has(frame.id)) {
          const entry = pending.get(frame.id)!;
          clearTimeout(entry.timer);
          pending.delete(frame.id);
          if (frame.ok) entry.resolve(frame.payload);
          else entry.reject(new Error(String(frame.error ?? "request_failed")));
        }
      });
      socket.on("error", (err) => { clearTimeout(timeout); reject(err); });
    });
  };

  const sendReq = async <T>(method: string, params: Record<string, unknown> = {}, timeoutMs = 15_000): Promise<T> => {
    if (!ready) await connect();
    const id = `cli-${++reqCounter}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`timeout:${method}`)); }, timeoutMs);
      pending.set(id, { resolve: resolve as (p: unknown) => void, reject, timer });
      socket.send(JSON.stringify({ type: "req", id, method, params }));
    });
  };

  const close = () => { socket?.close(); };

  return { sendReq, close, connect };
};
