import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { Router } from "../types.js";
import type { RunLogLevel } from "../../logs/run-log-types.js";

type LogsServices = {
  runLogService: {
    listRuns: () => Promise<string[]>;
    queryTimeline: (query: {
      runId: string;
      offset?: number;
      limit?: number;
      keyword?: string;
      levels?: RunLogLevel[];
      order?: "asc" | "desc";
    }) => Promise<unknown>;
    readRawTimeline: (runId: string) => Promise<string>;
  };
};

export const registerLogRoutes = (router: Router): void => {
  router.register("GET", "/api/logs/runs", async (ctx) => {
    const services = ctx.services as LogsServices;
    const items = await services.runLogService.listRuns();
    ctx.sendJson(200, { items });
  });

  router.register("GET", "/api/logs/runs/:runId/timeline", async (ctx) => {
    try {
      const services = ctx.services as LogsServices;
      const runId = ctx.params.runId;
      if (!runId) {
        ctx.sendJson(400, { error: "invalid_run_id" });
        return;
      }
      const levelParam = String(ctx.url.searchParams.get("level") ?? "").trim();
      const levels = levelParam
        ? levelParam
            .split(",")
            .map((item) => item.trim())
            .filter(
              (item): item is RunLogLevel =>
                item === "info" || item === "warn" || item === "error",
            )
        : undefined;
      const offsetRaw = Number(ctx.url.searchParams.get("offset") ?? 0);
      const limitParam = ctx.url.searchParams.get("limit");
      const limitRaw = limitParam === null ? undefined : Number(limitParam);
      const keyword =
        String(ctx.url.searchParams.get("keyword") ?? "").trim() || undefined;
      const order =
        ctx.url.searchParams.get("order") === "asc" ? "asc" : "desc";
      const page = await services.runLogService.queryTimeline({
        runId,
        offset: Number.isFinite(offsetRaw) ? offsetRaw : 0,
        limit:
          typeof limitRaw === "number" && Number.isFinite(limitRaw)
            ? limitRaw
            : undefined,
        keyword,
        levels,
        order,
      });
      ctx.sendJson(200, page);
    } catch (error) {
      ctx.sendJson(404, { error: "run_log_not_found", detail: String(error) });
    }
  });

  router.register(
    "GET",
    "/api/logs/runs/:runId/timeline/raw",
    async (ctx) => {
      try {
        const services = ctx.services as LogsServices;
        const runId = ctx.params.runId;
        if (!runId) {
          ctx.sendJson(400, { error: "invalid_run_id" });
          return;
        }
        const logFile = await services.runLogService.readRawTimeline(runId);
        const fileStat = await stat(logFile);
        const stream = createReadStream(logFile);
        ctx.sendRaw(
          200,
          {
            "Content-Type": "application/x-ndjson; charset=utf-8",
            "Content-Length": String(fileStat.size),
            "Content-Disposition": `inline; filename="${runId}-timeline.log"`,
          },
          stream,
        );
      } catch (error) {
        ctx.sendJson(404, {
          error: "run_log_not_found",
          detail: String(error),
        });
      }
    },
  );
};
