const MIN_TIMEOUT_MS = 5_000;
const DEFAULT_PIPELINE_NODE_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_STRUCTURED_RESULT_POLL_MS = 300;

const normalizeTimeout = (value: string | undefined, fallback: number, min: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.trunc(parsed));
};

// Centrally maintain DAG node execution timeout so send-request and wait-receipt don't use different defaults.
export const getPipelineNodeExecutionTimeoutMs = () =>
  normalizeTimeout(process.env.PIPELINE_NODE_EXECUTION_TIMEOUT_MS, DEFAULT_PIPELINE_NODE_TIMEOUT_MS, MIN_TIMEOUT_MS);

// Compatible with legacy env var name; fall back to the old var when the new one is not set.
export const getStructuredResultTimeoutMs = () =>
  normalizeTimeout(
    process.env.STRUCTURED_RESULT_TIMEOUT_MS ?? process.env.PIPELINE_NODE_EXECUTION_TIMEOUT_MS,
    DEFAULT_PIPELINE_NODE_TIMEOUT_MS,
    MIN_TIMEOUT_MS,
  );

// Polling interval stays short; it only observes receipts and does not participate in failure judgment.
export const getStructuredResultPollMs = () =>
  normalizeTimeout(process.env.STRUCTURED_RESULT_POLL_MS, DEFAULT_STRUCTURED_RESULT_POLL_MS, 100);
