import { firstText } from "../http-utils.js";
import type { SendMode } from "../http-utils.js";
import type { Router } from "../types.js";

type SessionServices = {
  client: {
    sendReq: (
      method: string,
      params?: Record<string, unknown>,
      opts?: { sideEffect?: boolean },
    ) => Promise<unknown>;
  };
  refreshSessionsFromGateway: () => Promise<{
    payload: unknown;
    items: Array<{ id: string; raw: Record<string, unknown> }>;
  }>;
  pushTimeline: (message: string, level?: string) => void;
};

type ModelInfo = {
  model: string | null;
  modelProvider: string | null;
  api: string | null;
};

const asRecord = (
  value: unknown,
): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const pickString = (
  record: Record<string, unknown>,
  keys: string[],
): string | null => {
  for (const key of keys) {
    const raw = record[key];
    if (typeof raw === "string" && raw.trim()) return raw.trim();
  }
  return null;
};

const readModelInfo = (value: unknown): ModelInfo => {
  const direct = asRecord(value);
  if (!direct) return { model: null, modelProvider: null, api: null };
  const nestedSession = asRecord(direct.session);
  const nestedMeta = asRecord(direct.meta);

  const model =
    pickString(direct, ["model", "modelName"]) ??
    (nestedSession
      ? pickString(nestedSession, ["model", "modelName"])
      : null) ??
    (nestedMeta
      ? pickString(nestedMeta, ["model", "modelName"])
      : null);
  const modelProvider =
    pickString(direct, ["modelProvider", "provider", "model_provider"]) ??
    (nestedSession
      ? pickString(nestedSession, [
          "modelProvider",
          "provider",
          "model_provider",
        ])
      : null) ??
    (nestedMeta
      ? pickString(nestedMeta, ["modelProvider", "provider", "model_provider"])
      : null);
  const api =
    pickString(direct, ["api", "apiType"]) ??
    (nestedSession
      ? pickString(nestedSession, ["api", "apiType"])
      : null) ??
    (nestedMeta ? pickString(nestedMeta, ["api", "apiType"]) : null);
  return { model, modelProvider, api };
};

const mergeModelInfo = (preferred: ModelInfo, fallback: ModelInfo): ModelInfo => ({
  model: preferred.model ?? fallback.model,
  modelProvider: preferred.modelProvider ?? fallback.modelProvider,
  api: preferred.api ?? fallback.api,
});

export const registerSessionsRoutes = (router: Router): void => {
  router.register("GET", "/api/sessions", async (ctx) => {
    const services = ctx.services as SessionServices;
    try {
      const { payload, items } =
        await services.refreshSessionsFromGateway();
      ctx.sendJson(200, { items, raw: payload });
    } catch (error) {
      ctx.sendJson(503, { error: String(error) });
    }
  });

  router.register(
    "GET",
    "/api/sessions/:sessionId/history",
    async (ctx) => {
      const services = ctx.services as SessionServices;
      try {
        const sessionId = ctx.params.sessionId;
        if (!sessionId) {
          ctx.sendJson(400, { error: "invalid_session_id" });
          return;
        }
        const limitRaw = Number(ctx.url.searchParams.get("limit") ?? 200);
        const limit =
          Number.isFinite(limitRaw) && limitRaw > 0
            ? Math.min(500, Math.floor(limitRaw))
            : 200;
        const payload = await services.client.sendReq("chat.history", {
          sessionKey: sessionId,
          limit,
        });
        const raw = (payload ?? {}) as Record<string, unknown>;
        const rawItems = Array.isArray(raw.items)
          ? raw.items
          : Array.isArray(raw.messages)
            ? raw.messages
            : Array.isArray(raw.history)
              ? raw.history
              : Array.isArray(payload)
                ? payload
                : [];
        const latestAssistant = [...rawItems]
          .reverse()
          .find(
            (item) =>
              String(
                (asRecord(item) ?? {}).role ?? "",
              ).toLowerCase() === "assistant",
          );
        const latestModelInfo = readModelInfo(latestAssistant);
        let sessionModelInfo: ModelInfo = {
          model: null,
          modelProvider: null,
          api: null,
        };
        try {
          const { items } =
            await services.refreshSessionsFromGateway();
          const matched = items.find(
            (session) => session.id === sessionId,
          );
          sessionModelInfo = readModelInfo(matched?.raw);
        } catch {
          // 即使 sessions.list 暂时不可用，仍保持 history 端点可用
        }
        const mergedInfo = mergeModelInfo(
          latestModelInfo,
          sessionModelInfo,
        );

        const items = rawItems.map((item) => {
          const rec = asRecord(item);
          if (!rec) return item;
          const role = String(rec.role ?? "").toLowerCase();
          if (role !== "assistant") return item;
          const itemModelInfo = mergeModelInfo(
            readModelInfo(rec),
            mergedInfo,
          );
          return {
            ...rec,
            model: rec.model ?? itemModelInfo.model,
            modelProvider:
              rec.modelProvider ??
              rec.provider ??
              itemModelInfo.modelProvider,
            provider:
              rec.provider ??
              rec.modelProvider ??
              itemModelInfo.modelProvider,
            api: rec.api ?? itemModelInfo.api,
          };
        });

        ctx.sendJson(200, {
          items,
          raw: payload,
          limit,
          model: mergedInfo.model,
          modelProvider: mergedInfo.modelProvider,
          api: mergedInfo.api,
        });
      } catch (error) {
        ctx.sendJson(503, { error: String(error) });
      }
    },
  );

  router.register("POST", "/api/sessions", async (ctx) => {
    const services = ctx.services as SessionServices;
    try {
      const body = await ctx.readBody();
      const payload = await services.client.sendReq(
        "sessions.create",
        body,
        { sideEffect: true },
      );
      ctx.sendJson(200, { item: payload ?? null });
    } catch (error) {
      ctx.sendJson(500, { error: String(error) });
    }
  });

  router.register(
    "POST",
    "/api/sessions/:sessionId/send",
    async (ctx) => {
      const services = ctx.services as SessionServices;
      try {
        const sessionId = ctx.params.sessionId;
        if (!sessionId) {
          ctx.sendJson(400, { error: "invalid_session_id" });
          return;
        }
        const body = await ctx.readBody();
        const text = firstText(body);
        const mode = String(body.mode ?? "auto") as SendMode;
        if (!text) {
          ctx.sendJson(400, { error: "message_required" });
          return;
        }

        const attempts: Array<{
          method: "chat.send" | "sessions.send";
          params: Record<string, unknown>;
        }> = [];
        const chatAttempts: Array<{
          method: "chat.send";
          params: Record<string, unknown>;
        }> = [
          {
            method: "chat.send",
            params: { sessionKey: sessionId, message: text },
          },
        ];
        const sessionsAttempts: Array<{
          method: "sessions.send";
          params: Record<string, unknown>;
        }> = [
          {
            method: "sessions.send",
            params: { key: sessionId, message: text },
          },
        ];

        if (mode === "chat") {
          attempts.push(...chatAttempts);
        } else if (mode === "sessions") {
          attempts.push(...sessionsAttempts);
        } else {
          attempts.push(...chatAttempts, ...sessionsAttempts);
        }

        let payload: unknown = null;
        let lastError: unknown = null;
        const attemptErrors: string[] = [];
        let usedMethod: "chat.send" | "sessions.send" | null =
          null;
        let usedParams: Record<string, unknown> | null = null;
        for (const attempt of attempts) {
          try {
            payload = await services.client.sendReq(
              attempt.method,
              attempt.params,
              { sideEffect: true },
            );
            usedMethod = attempt.method;
            usedParams = attempt.params;
            services.pushTimeline(
              `会话消息发送成功: ${sessionId} (${attempt.method})`,
            );
            break;
          } catch (error) {
            lastError = error;
            attemptErrors.push(
              `${attempt.method}: ${String(error)}`,
            );
          }
        }

        if (payload === null) {
          ctx.sendJson(500, {
            error: String(lastError ?? "sessions_send_failed"),
            attempts: attemptErrors,
            mode,
          });
          return;
        }
        let sessionModelInfo: ModelInfo = {
          model: null,
          modelProvider: null,
          api: null,
        };
        try {
          const { items } =
            await services.refreshSessionsFromGateway();
          const matched = items.find(
            (session) => session.id === sessionId,
          );
          sessionModelInfo = readModelInfo(matched?.raw);
        } catch {
          // 即使 sessions.list 刷新失败，仍保持 send 路径可用
        }
        const usedModelInfo = mergeModelInfo(
          readModelInfo(payload),
          sessionModelInfo,
        );
        ctx.sendJson(200, {
          item: payload ?? null,
          mode,
          usedMethod,
          usedParams,
          model: usedModelInfo.model,
          modelProvider: usedModelInfo.modelProvider,
          api: usedModelInfo.api,
        });
      } catch (error) {
        services.pushTimeline(
          `会话消息发送失败: ${String(error)}`,
          "error",
        );
        ctx.sendJson(500, { error: String(error) });
      }
    },
  );
};
