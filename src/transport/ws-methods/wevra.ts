import type { WsMethodRegistry } from "./types";
import type { WsBroker } from "../ws-broker";
import type { WevraAgent } from "../../wevra";
import type { StreamEvent } from "../../wevra/types";
import { formatError } from "./utils";
import { invalidateModelsCache, getAvailableModelsPublic } from "../../wevra/config";

let wevraInstance: WevraAgent | null = null;
let brokerInstance: WsBroker | null = null;

export function initWevraWs(wevra: WevraAgent, broker: WsBroker): void {
  wevraInstance = wevra;
  brokerInstance = broker;
}

export const registerWevraWsMethods = (registry: WsMethodRegistry): void => {
  // ── 模型 ──

  registry.register("wevra.models", async () => {
    if (!wevraInstance) return { ok: false, error: "wevra_not_initialized" };
    try {
      const models = getAvailableModelsPublic();
      const defaultId = wevraInstance.getDefaultModelId();
      return { ok: true, payload: { models: models.map(m => ({ providerId: m.providerId, modelId: m.modelId, label: m.label ?? m.modelId, readonly: m.readonly ?? false })), default: defaultId } };
    } catch (error) {
      return { ok: false, error: formatError(error) };
    }
  });

  registry.register("wevra.models.reload", async () => {
    if (!wevraInstance) return { ok: false, error: "wevra_not_initialized" };
    try {
      invalidateModelsCache();
      const models = getAvailableModelsPublic();
      const defaultId = wevraInstance.getDefaultModelId();
      return { ok: true, payload: { models: models.map(m => ({ providerId: m.providerId, modelId: m.modelId, label: m.label ?? m.modelId, readonly: m.readonly ?? false })), default: defaultId } };
    } catch (error) {
      return { ok: false, error: formatError(error) };
    }
  });

  // ── 对话列表 ──

  registry.register("wevra.conversations.list", async () => {
    if (!wevraInstance) return { ok: false, error: "wevra_not_initialized" };
    try {
      const conversations = wevraInstance.getConversations();
      return { ok: true, payload: { conversations } };
    } catch (error) { return { ok: false, error: formatError(error) }; }
  });

  registry.register("wevra.conversations.view", async (params) => {
    if (!wevraInstance) return { ok: false, error: "wevra_not_initialized" };
    try {
      const id = typeof params.conversationId === "string" ? params.conversationId.trim() : "";
      if (!id) return { ok: false, error: "conversation_id_required" };
      return { ok: true, payload: { messages: await wevraInstance.viewConversation(id) } };
    } catch (error) { return { ok: false, error: formatError(error) }; }
  });

  registry.register("wevra.conversations.new", async () => {
    if (!wevraInstance) return { ok: false, error: "wevra_not_initialized" };
    try {
      const conv = await wevraInstance.newConversation();
      return { ok: true, payload: { conversation: conv } };
    } catch (error) { return { ok: false, error: formatError(error) }; }
  });

  registry.register("wevra.conversations.rename", async (params) => {
    if (!wevraInstance) return { ok: false, error: "wevra_not_initialized" };
    try {
      const id = typeof params.conversationId === "string" ? params.conversationId.trim() : "";
      const title = typeof params.title === "string" ? params.title.trim() : "";
      if (!id || !title) return { ok: false, error: "params_required" };
      await wevraInstance.renameConversation(id, title);
      return { ok: true, payload: {} };
    } catch (error) { return { ok: false, error: formatError(error) }; }
  });

  // ── 聊天 ──

  registry.register("wevra.chat", async (params) => {
    if (!wevraInstance) return { ok: false, error: "wevra_not_initialized" };
    try {
      const message = typeof params.message === "string" ? params.message.trim() : "";
      if (!message) return { ok: false, error: "message_required" };
      const conversationId = typeof params.conversationId === "string" ? params.conversationId.trim() : "";
      if (!conversationId) return { ok: false, error: "conversation_id_required" };
      const providerId = typeof params.provider === "string" ? params.provider.trim() : undefined;
      const modelId = typeof params.model === "string" ? params.model.trim() : undefined;

      const onStream = (event: StreamEvent) => {
        if (!brokerInstance) return;
        brokerInstance.broadcast({ type: "event", method: "wevra.stream", payload: { sessionId: conversationId, stream: mapStreamType(event.type), phase: mapStreamPhase(event.type), content: event.content, toolCall: event.toolCall, toolResult: event.toolResult, usage: event.usage, error: event.error } });
      };
      const onDebug = (dbg: unknown) => {
        if (!brokerInstance) return;
        brokerInstance.broadcast({ type: "event", method: "wevra.debug", payload: dbg });
      };
      const onMessage = async (msg: any) => {
        await wevraInstance!.conversations.appendMessage(conversationId, msg);
      };

      const result = await wevraInstance.chat(message, conversationId, { onStream, onDebug, onMessage, providerId, modelId });
      return { ok: true, payload: { conversationId, content: result.content, type: result.type, iterations: result.iterations, usage: result.usage } };
    } catch (error) { return { ok: false, error: formatError(error) }; }
  });

  // ── 状态 ──

  registry.register("wevra.status", async () => {
    if (!wevraInstance) return { ok: false, error: "wevra_not_initialized" };
    try { return { ok: true, payload: wevraInstance.getStatus() }; } catch (error) { return { ok: false, error: formatError(error) }; }
  });
};

function mapStreamType(eventType: StreamEvent["type"]): string {
  if (eventType.startsWith("thinking")) return "thinking"
  if (eventType.startsWith("text")) return "assistant"
  if (eventType.startsWith("tool")) return "tool"
  return "meta"
}
function mapStreamPhase(eventType: StreamEvent["type"]): string {
  if (eventType.endsWith("_start")) return "start"
  if (eventType.endsWith("_delta")) return "delta"
  if (eventType.endsWith("_end")) return "end"
  return eventType
}
