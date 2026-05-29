import type { GatewayClient } from "../../gateway";

export const createRunAbortController = () => {
  const nodeExecutionControllers = new Map<string, Set<{ ac: AbortController; sessionId: string }>>();
  const drainControllers = new Map<string, AbortController>();

  const registerController = (runId: string, ac: AbortController, sessionId: string) => {
    let controllers = nodeExecutionControllers.get(runId);
    if (!controllers) {
      controllers = new Set();
      nodeExecutionControllers.set(runId, controllers);
    }
    const entry = { ac, sessionId };
    controllers.add(entry);
    return entry;
  };

  const unregisterController = (runId: string, entry: { ac: AbortController; sessionId: string }) => {
    const controllers = nodeExecutionControllers.get(runId);
    if (!controllers) return;
    controllers.delete(entry);
    if (controllers.size === 0) {
      nodeExecutionControllers.delete(runId);
    }
    entry.ac.abort();
  };

  /**
   * 中止指定流水线运行的所有节点执行。
   * 1. 向每个活跃节点的远端 agent 会话发送 "/stop" 命令（fire-and-forget）
   * 2. 触发本地 AbortController 中断轮询/排水循环
   */
  const abortRunControllers = (runId: string, client: GatewayClient) => {
    const controllers = nodeExecutionControllers.get(runId);
    if (controllers) {
      const sessionIds = new Set<string>();
      for (const entry of controllers) {
        entry.ac.abort();
        sessionIds.add(entry.sessionId);
      }
      nodeExecutionControllers.delete(runId);
      for (const sessionId of sessionIds) {
        client.sendReq("chat.send", { sessionKey: sessionId, message: "/stop" }, { sideEffect: true })
          .catch(() => { /* best-effort */ });
      }
    }
    const dc = drainControllers.get(runId);
    if (dc) {
      dc.abort();
      drainControllers.delete(runId);
    }
  };

  /**
   * 获取或创建用于 drainPipeline 的中止信号。
   * 每次新 run 会创建新的 AbortController，确保 stop/retry 只中断当前运行。
   */
  const getOrCreateDrainSignal = (runId: string): AbortSignal => {
    let dc = drainControllers.get(runId);
    if (!dc) {
      dc = new AbortController();
      drainControllers.set(runId, dc);
    }
    return dc.signal;
  };

  return { registerController, unregisterController, abortRunControllers, getOrCreateDrainSignal };
};

export type RunAbortController = ReturnType<typeof createRunAbortController>;
