import { randomUUID } from "node:crypto";
import type { WsMethodRegistry } from "./types";
import type { PipelineLink } from "../../pipeline/types/pipeline-link";
import { isValidLinkId } from "../../pipeline/types/pipeline-link";

export const registerPipelineLinksWsMethods = (registry: WsMethodRegistry): void => {
  // pipeline.link.list
  registry.register("pipeline.link.list", async (_params, ctx) => {
    const links = await ctx.app.dispatch.listLinks();
    return { ok: true, payload: { ok: true, items: links } };
  });

  // pipeline.link.create
  registry.register("pipeline.link.create", async (params, ctx) => {
    const id = typeof params.id === "string" ? params.id.trim() : `link:${randomUUID()}`;
    if (!isValidLinkId(id)) {
      return { ok: false, error: "pipeline_link_invalid_id" };
    }
    const fromPipelineId = typeof params.fromPipelineId === "string" ? params.fromPipelineId.trim() : "";
    const toPipelineId = typeof params.toPipelineId === "string" ? params.toPipelineId.trim() : "";
    if (!fromPipelineId || !toPipelineId) {
      return { ok: false, error: "pipeline_link_missing_pipelines" };
    }
    if (!ctx.app.getPipelineDefinition(fromPipelineId)) {
      return { ok: false, error: "pipeline_not_found" };
    }
    if (!ctx.app.getPipelineDefinition(toPipelineId)) {
      return { ok: false, error: "pipeline_not_found" };
    }

    const contract = params.inputContract && typeof params.inputContract === "object"
      ? {
          requireType: typeof (params.inputContract as Record<string, unknown>).requireType === "string"
            ? (params.inputContract as Record<string, unknown>).requireType as string : undefined,
          requireSchemaVersion: typeof (params.inputContract as Record<string, unknown>).requireSchemaVersion === "number"
            ? (params.inputContract as Record<string, unknown>).requireSchemaVersion as number : undefined,
        } : null;

    const maxPendingJobs = typeof params.maxPendingJobs === "number" && Number.isFinite(params.maxPendingJobs)
      ? Math.min(10000, Math.max(1, Math.trunc(params.maxPendingJobs))) : 100;

    const onJobFailed: "pause" | "continue" = params.onJobFailed === "pause" ? "pause" : "continue";

    const now = new Date().toISOString();
    const link: PipelineLink = {
      schemaVersion: 1,
      id,
      enabled: params.enabled !== false,
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

    const result = await ctx.app.dispatch.createLink(link);
    if (!result.ok) {
      return { ok: false, error: result.error };
    }
    return { ok: true, payload: { ok: true, link: result.link } };
  });

  // pipeline.link.update
  registry.register("pipeline.link.update", async (params, ctx) => {
    const linkId = typeof params.linkId === "string" ? params.linkId : "";
    if (!linkId) return { ok: false, error: "pipeline_link_id_required" };

    const patch: Record<string, unknown> = {};
    if (typeof params.enabled === "boolean") patch.enabled = params.enabled;
    if (params.inputContract !== undefined) {
      patch.inputContract = params.inputContract && typeof params.inputContract === "object"
        ? {
            requireType: typeof (params.inputContract as Record<string, unknown>).requireType === "string"
              ? (params.inputContract as Record<string, unknown>).requireType : undefined,
            requireSchemaVersion: typeof (params.inputContract as Record<string, unknown>).requireSchemaVersion === "number"
              ? (params.inputContract as Record<string, unknown>).requireSchemaVersion : undefined,
          } : null;
    }
    if (params.onJobFailed === "continue" || params.onJobFailed === "pause") patch.onJobFailed = params.onJobFailed;
    if (typeof params.maxPendingJobs === "number" && Number.isFinite(params.maxPendingJobs)) {
      patch.maxPendingJobs = Math.min(10000, Math.max(1, Math.trunc(params.maxPendingJobs)));
    }

    const result = await ctx.app.dispatch.updateLink(linkId, patch as Parameters<typeof ctx.app.dispatch.updateLink>[1]);
    if (!result.ok) {
      return { ok: false, error: result.error };
    }
    return { ok: true, payload: { ok: true, link: result.link } };
  });

  // pipeline.link.delete
  registry.register("pipeline.link.delete", async (params, ctx) => {
    const linkId = typeof params.linkId === "string" ? params.linkId : "";
    if (!linkId) return { ok: false, error: "pipeline_link_id_required" };
    const result = await ctx.app.dispatch.deleteLink(linkId);
    if (!result.ok) {
      return { ok: false, error: result.error };
    }
    return { ok: true, payload: { ok: true } };
  });
};
