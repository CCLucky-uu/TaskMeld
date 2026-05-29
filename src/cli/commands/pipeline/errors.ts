import { CliError } from "../../errors";
import { describePipelineSelector } from "./selector";
import type { PipelineRunSelector } from "./types";

export const throwSelectorScopedError = (result: { error?: string }, selector: PipelineRunSelector): never => {
  if (result.error === "pipeline_not_found" && selector.pipelineId) {
    throw new CliError(`Pipeline not found: ${selector.pipelineId}`, {
      code: "PIPELINE_NOT_FOUND",
      exitCode: 3,
      details: selector,
    });
  }
  if (result.error === "run_not_found" && selector.runId) {
    throw new CliError(`Run not found: ${selector.runId}`, {
      code: "RUN_NOT_FOUND",
      exitCode: 3,
      details: selector,
    });
  }
  if (result.error === "batch_run_not_found" && selector.batchRunId) {
    throw new CliError(`Batch run not found: ${selector.batchRunId}`, {
      code: "BATCH_RUN_NOT_FOUND",
      exitCode: 3,
      details: selector,
    });
  }
  throw new CliError(`Pipeline selector not found: ${describePipelineSelector(selector)}`, {
    code: "PIPELINE_TARGET_NOT_FOUND",
    exitCode: 3,
    details: {
      ...selector,
      error: result.error ?? "unknown_error",
    },
  });
};
