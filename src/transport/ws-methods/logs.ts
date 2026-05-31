import type { WsMethodRegistry } from "./types";

export const registerLogWsMethods = (registry: WsMethodRegistry): void => {
  registry.register("log.runs.list", async (_params, ctx) => {
    try {
      const items = ctx.services.runLogService ? await ctx.services.runLogService.listRuns() : [];
      return { ok: true, payload: { items } };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  });

  registry.register("log.timeline", async (params, ctx) => {
    const runId = typeof params.runId === "string" ? params.runId : "";
    if (!runId || !ctx.services.runLogService) {
      return { ok: false, error: runId ? "run_log_not_available" : "invalid_run_id" };
    }
    try {
      const levelParam = typeof params.level === "string" ? params.level : "";
      const levels = levelParam
        ? (levelParam.split(",").map((s) => s.trim()).filter((s): s is "info" | "warn" | "error" => s === "info" || s === "warn" || s === "error"))
        : undefined;
      const offset = typeof params.offset === "number" && Number.isFinite(params.offset) ? params.offset : 0;
      const limit = typeof params.limit === "number" && Number.isFinite(params.limit) ? params.limit : undefined;
      const keyword = typeof params.keyword === "string" && params.keyword.trim() ? params.keyword.trim() : undefined;
      const order = params.order === "asc" ? "asc" as const : "desc" as const;

      const page = await ctx.services.runLogService.queryTimeline({
        runId,
        offset,
        limit,
        keyword,
        levels,
        order,
      });
      return { ok: true, payload: page };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  });
};
