import type { Router } from "../types.js";

const PIPELINE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

// 从请求体读取流水线标题，若未提供则生成默认标题
const readPipelineTitle = (value: unknown, pipelineId: string): string =>
  typeof value === "string" && value.trim() ? value.trim() : `流水线 DAG-${pipelineId}`;

/**
 * 注册 Pipeline CRUD 路由：
 *   GET    /api/pipelines          — 列出所有流水线
 *   POST   /api/pipelines          — 创建流水线
 *   PATCH  /api/pipelines/:pipelineId  — 重命名流水线
 *   DELETE /api/pipelines/:pipelineId  — 删除流水线
 */
export const registerPipelinesRoutes = (router: Router): void => {
  router.register("GET", "/api/pipelines", (ctx) => {
    ctx.sendJson(200, {
      items: ctx.options.app.listPipelines().map((definition) => ({
        id: definition.id,
        title: definition.title,
      })),
    });
  });

  router.register("POST", "/api/pipelines", async (ctx) => {
    const body = await ctx.readBody();
    const pipelineId = typeof body.id === "string" ? body.id.trim() : "";
    const cloneFrom = typeof body.cloneFrom === "string" && body.cloneFrom.trim() ? body.cloneFrom.trim() : undefined;
    if (!PIPELINE_ID_PATTERN.test(pipelineId)) {
      ctx.sendJson(400, { ok: false, error: "pipeline_id_invalid" });
      return;
    }
    try {
      const item = await ctx.options.app.createPipeline({
        id: pipelineId,
        title: readPipelineTitle(body.title, pipelineId),
        cloneFrom,
      });
      ctx.sendJson(200, {
        ok: true,
        item: {
          id: item.id,
          title: item.title,
        },
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "pipeline_create_failed";
      const status =
        detail === "pipeline_already_exists"
          ? 409
          : detail === "pipeline_id_invalid" || detail === "pipeline_clone_source_not_found"
            ? 400
            : 500;
      ctx.sendJson(status, { ok: false, error: detail });
    }
  });

  router.register("PATCH", "/api/pipelines/:pipelineId", async (ctx) => {
    const { pipelineId } = ctx.params;
    const body = await ctx.readBody();
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) {
      ctx.sendJson(400, { ok: false, error: "pipeline_title_invalid", pipelineId: pipelineId || null });
      return;
    }
    try {
      const item = ctx.options.app.renamePipeline(pipelineId, title);
      ctx.sendJson(200, {
        ok: true,
        item: {
          id: item.id,
          title: item.title,
        },
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "pipeline_rename_failed";
      const status = detail === "pipeline_not_found" ? 404 : detail === "pipeline_title_invalid" ? 400 : 500;
      ctx.sendJson(status, { ok: false, error: detail, pipelineId: pipelineId || null });
    }
  });

  router.register("DELETE", "/api/pipelines/:pipelineId", async (ctx) => {
    const { pipelineId } = ctx.params;
    try {
      const deleted = ctx.options.app.deletePipeline(pipelineId);
      ctx.sendJson(200, { ok: true, pipelineId: deleted.pipelineId });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "pipeline_delete_failed";
      const status =
        detail === "pipeline_not_found"
          ? 404
          : detail === "pipeline_delete_last_forbidden" || detail === "pipeline_delete_running_forbidden"
            ? 409
            : 500;
      ctx.sendJson(status, { ok: false, error: detail, pipelineId: pipelineId || null });
    }
  });
};
