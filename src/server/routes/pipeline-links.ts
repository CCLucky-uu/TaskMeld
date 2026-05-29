import { randomUUID } from "node:crypto";
import type { Router, RequestContext } from "../types.js";
import type { PipelineRegistry } from "../../app/pipeline-registry.js";
import type { PipelineLink } from "../../pipeline/types/pipeline-link.js";
import { isValidLinkId } from "../../pipeline/types/pipeline-link.js";

export const registerPipelineLinksRoutes = (router: Router): void => {
  // GET /api/pipeline-links
  router.register("GET", "/api/pipeline-links", async (ctx: RequestContext) => {
    const { app } = ctx.options;
    const links = await app.dispatch.listLinks();
    ctx.sendJson(200, { ok: true, items: links });
  });

  // POST /api/pipeline-links
  router.register("POST", "/api/pipeline-links", async (ctx: RequestContext) => {
    const { app } = ctx.options;
    const body = await ctx.readBody();

    const id = typeof body.id === "string" ? body.id.trim() : `link:${randomUUID()}`;
    if (!isValidLinkId(id)) {
      ctx.sendJson(400, { ok: false, error: "pipeline_link_invalid_id" });
      return;
    }

    const fromPipelineId = typeof body.fromPipelineId === "string" ? body.fromPipelineId.trim() : "";
    const toPipelineId = typeof body.toPipelineId === "string" ? body.toPipelineId.trim() : "";
    if (!fromPipelineId || !toPipelineId) {
      ctx.sendJson(400, { ok: false, error: "pipeline_link_missing_pipelines" });
      return;
    }

    if (!app.getPipelineDefinition(fromPipelineId)) {
      ctx.sendJson(400, { ok: false, error: "pipeline_not_found", detail: `上游流水线 ${fromPipelineId} 不存在` });
      return;
    }
    if (!app.getPipelineDefinition(toPipelineId)) {
      ctx.sendJson(400, { ok: false, error: "pipeline_not_found", detail: `下游流水线 ${toPipelineId} 不存在` });
      return;
    }

    const contract = body.inputContract && typeof body.inputContract === "object"
      ? {
          requireType: typeof (body.inputContract as Record<string, unknown>).requireType === "string"
            ? (body.inputContract as Record<string, unknown>).requireType as string
            : undefined,
          requireSchemaVersion: typeof (body.inputContract as Record<string, unknown>).requireSchemaVersion === "number"
            ? (body.inputContract as Record<string, unknown>).requireSchemaVersion as number
            : undefined,
        }
      : null;

    const maxPendingJobs = typeof body.maxPendingJobs === "number" && Number.isFinite(body.maxPendingJobs)
      ? Math.min(10000, Math.max(1, Math.trunc(body.maxPendingJobs)))
      : 100;

    const onJobFailed = body.onJobFailed === "pause" ? "pause" : "continue";

    const now = new Date().toISOString();
    const link: PipelineLink = {
      schemaVersion: 1,
      id,
      enabled: body.enabled !== false,
      fromPipelineId,
      toPipelineId,
      trigger: "on_success",
      dispatchPolicy: "fifo",
      inputContract: contract,
      onJobFailed,
      maxPendingJobs,
      createdAt: now,
      updatedAt: now,
    };

    const result = await app.dispatch.createLink(link);
    if (!result.ok) {
      const statusCode = result.error === "pipeline_link_duplicate" ? 409 : 400;
      ctx.sendJson(statusCode, { ok: false, error: result.error });
      return;
    }
    ctx.sendJson(201, { ok: true, link: result.link });
  });

  // PATCH /api/pipeline-links/:linkId
  router.register("PATCH", "/api/pipeline-links/:linkId", async (ctx: RequestContext) => {
    const { app } = ctx.options;
    const { linkId } = ctx.params;
    const body = await ctx.readBody();

    const patch: Record<string, unknown> = {};
    if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
    if (body.inputContract !== undefined) {
      patch.inputContract = body.inputContract && typeof body.inputContract === "object"
        ? {
            requireType: typeof (body.inputContract as Record<string, unknown>).requireType === "string"
              ? (body.inputContract as Record<string, unknown>).requireType
              : undefined,
            requireSchemaVersion: typeof (body.inputContract as Record<string, unknown>).requireSchemaVersion === "number"
              ? (body.inputContract as Record<string, unknown>).requireSchemaVersion
              : undefined,
          }
        : null;
    }
    if (body.onJobFailed === "continue" || body.onJobFailed === "pause") patch.onJobFailed = body.onJobFailed;
    if (typeof body.maxPendingJobs === "number" && Number.isFinite(body.maxPendingJobs)) {
      patch.maxPendingJobs = Math.min(10000, Math.max(1, Math.trunc(body.maxPendingJobs)));
    }

    const result = await app.dispatch.updateLink(linkId, patch as Parameters<typeof app.dispatch.updateLink>[1]);
    if (!result.ok) {
      ctx.sendJson(404, { ok: false, error: result.error });
      return;
    }
    ctx.sendJson(200, { ok: true, link: result.link });
  });

  // DELETE /api/pipeline-links/:linkId
  router.register("DELETE", "/api/pipeline-links/:linkId", async (ctx: RequestContext) => {
    const { app } = ctx.options;
    const { linkId } = ctx.params;
    const result = await app.dispatch.deleteLink(linkId);
    if (!result.ok) {
      ctx.sendJson(404, { ok: false, error: result.error });
      return;
    }
    ctx.sendJson(200, { ok: true });
  });
};
