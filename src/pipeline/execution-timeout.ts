const MIN_TIMEOUT_MS = 5_000;
const DEFAULT_PIPELINE_NODE_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_STRUCTURED_RESULT_POLL_MS = 300;

const normalizeTimeout = (value: string | undefined, fallback: number, min: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.trunc(parsed));
};

// 统一维护 DAG 节点执行超时，避免发送请求与等待回执使用不同默认值。
export const getPipelineNodeExecutionTimeoutMs = () =>
  normalizeTimeout(process.env.PIPELINE_NODE_EXECUTION_TIMEOUT_MS, DEFAULT_PIPELINE_NODE_TIMEOUT_MS, MIN_TIMEOUT_MS);

// 兼容历史环境变量名，未设置新变量时继续读取旧变量。
export const getStructuredResultTimeoutMs = () =>
  normalizeTimeout(
    process.env.STRUCTURED_RESULT_TIMEOUT_MS ?? process.env.PIPELINE_NODE_EXECUTION_TIMEOUT_MS,
    DEFAULT_PIPELINE_NODE_TIMEOUT_MS,
    MIN_TIMEOUT_MS,
  );

// 轮询间隔保持短周期，仅负责观察回执，不参与失败判定。
export const getStructuredResultPollMs = () =>
  normalizeTimeout(process.env.STRUCTURED_RESULT_POLL_MS, DEFAULT_STRUCTURED_RESULT_POLL_MS, 100);
