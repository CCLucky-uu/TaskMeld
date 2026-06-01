import { CliError } from "../../errors";
import type { CliCommandHandler } from "../../types";
import type { PipelineRunSelector, PipelineStatusPayload, PipelineStopPayload } from "./types";

export const pickOptionalStringFlag = (value: string | boolean | undefined): string | undefined => {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized || undefined;
};

export const readPipelineSelector = (input: Parameters<CliCommandHandler>[0]): PipelineRunSelector => {
  const pipelineId = input.args[0]?.trim() ? input.args[0].trim() : undefined;
  const runId = pickOptionalStringFlag(input.flags["run-id"]);
  const batchRunId = pickOptionalStringFlag(input.flags["batch-run-id"]);
  if (pipelineId || runId || batchRunId) {
    return { pipelineId, runId, batchRunId };
  }
  throw new CliError("Missing pipeline selector: provide <pipelineId>, --run-id, or --batch-run-id", {
    code: "INVALID_ARGUMENT",
    exitCode: 2,
  });
};

export const describePipelineSelector = (selector: PipelineRunSelector): string => {
  if (selector.runId) return `runId=${selector.runId}`;
  if (selector.batchRunId) return `batchRunId=${selector.batchRunId}`;
  if (selector.pipelineId) return `pipelineId=${selector.pipelineId}`;
  return "pipeline selector";
};

export const getPipelineStatusBySelector = async (
  ctx: Parameters<CliCommandHandler>[1],
  selector: PipelineRunSelector,
): Promise<PipelineStatusPayload> => {
  const getPipelineStatus = ctx.app.pipelineService.getPipelineStatus as unknown as
    ((pipelineId: string) => Promise<unknown> | unknown)
    & ((selectorInput: PipelineRunSelector) => Promise<unknown> | unknown);
  if (!selector.runId && !selector.batchRunId && selector.pipelineId) {
    return await getPipelineStatus(selector.pipelineId) as PipelineStatusPayload;
  }
  // During daemon-first migration, allow the CLI to pass the full selector so status/watch/stop don't rely on implicitly guessing the "currently active pipeline run".
  return await getPipelineStatus(selector) as PipelineStatusPayload;
};

export const stopPipelineBySelector = async (
  ctx: Parameters<CliCommandHandler>[1],
  selector: PipelineRunSelector,
): Promise<PipelineStopPayload> => {
  const stopPipeline = ctx.app.pipelineService.stopPipeline as unknown as
    ((pipelineId: string) => Promise<unknown> | unknown)
    & ((selectorInput: PipelineRunSelector) => Promise<unknown> | unknown);
  if (!selector.runId && !selector.batchRunId && selector.pipelineId) {
    return await stopPipeline(selector.pipelineId) as PipelineStopPayload;
  }
  return await stopPipeline(selector) as PipelineStopPayload;
};