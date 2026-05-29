import type { Router } from "../types.js";
import type { SchedulerService } from "../../services/scheduler-service.js";

type SchedulerServices = {
  schedulerService: SchedulerService;
};

/**
 * 注册 Pipeline Scheduler 路由：
 *   POST /api/pipelines/:pipelineId/scheduler/toggle  — 切换调度器开关
 *   POST /api/pipelines/:pipelineId/scheduler/mode    — 设置调度模式
 *   POST /api/pipelines/:pipelineId/tick               — 手动触发调度 tick
 */
export const registerPipelineSchedulerRoutes = (router: Router): void => {
  // POST /api/pipelines/:pipelineId/scheduler/toggle
  router.register("POST", "/api/pipelines/:pipelineId/scheduler/toggle", async (ctx) => {
    const scope = ctx.getPipelineScope();
    if (!scope) {
      ctx.sendJson(404, { error: "pipeline_not_found", pipelineId: ctx.params.pipelineId });
      return;
    }
    const { schedulerService } = ctx.services as SchedulerServices;
    const body = await ctx.readBody();
    const enabled = body.enabled !== false;
    const toggled = schedulerService.toggleScheduler(scope.pipelineId, enabled);
    if (!toggled.ok) {
      // pipeline_plugin_disabled 时返回 403，pipeline_not_found 时返回 404
      const statusCode = (toggled as { error?: string }).error === "pipeline_not_found" ? 404 : 403;
      ctx.sendJson(statusCode, toggled);
      return;
    }
    scope.pushTimeline(`[${scope.pipelineId}] 调度器已${toggled.scheduler.enabled ? "启用" : "停用"}`);
    ctx.sendJson(200, toggled);
  });

  // POST /api/pipelines/:pipelineId/scheduler/mode
  router.register("POST", "/api/pipelines/:pipelineId/scheduler/mode", async (ctx) => {
    const scope = ctx.getPipelineScope();
    if (!scope) {
      ctx.sendJson(404, { error: "pipeline_not_found", pipelineId: ctx.params.pipelineId });
      return;
    }
    const { schedulerService } = ctx.services as SchedulerServices;
    const body = await ctx.readBody();
    const mode = body.mode === "manual" ? "manual" : "auto";
    const updated = schedulerService.setSchedulerMode(scope.pipelineId, mode);
    if (!updated.ok) {
      const statusCode = (updated as { error?: string }).error === "pipeline_not_found" ? 404 : 403;
      ctx.sendJson(statusCode, updated);
      return;
    }
    scope.pushTimeline(`[${scope.pipelineId}] 调度器模式切换为: ${updated.scheduler.mode}`);
    ctx.sendJson(200, updated);
  });

  // POST /api/pipelines/:pipelineId/tick
  router.register("POST", "/api/pipelines/:pipelineId/tick", async (ctx) => {
    const scope = ctx.getPipelineScope();
    if (!scope) {
      ctx.sendJson(404, { error: "pipeline_not_found", pipelineId: ctx.params.pipelineId });
      return;
    }
    const workflow = scope.getWorkflow?.();
    // 保持 scheduler plugin disabled 时的 403 语义
    if (!workflow || !workflow.plugins.scheduler.enabled) {
      ctx.sendJson(403, { error: "pipeline_plugin_disabled", plugin: "scheduler", pipelineId: scope.pipelineId });
      return;
    }
    const drained = await scope.drainPipeline("manual_tick");
    const run = scope.getRun();
    scope.touchRun(run);
    ctx.sendJson(200, { ok: true, run, drained, pipelineId: scope.pipelineId });
  });
};
