import { EventEmitter } from "node:events";
import { getStructuredResultPollMs, getStructuredResultTimeoutMs } from "../execution-timeout";
import { collectEnvelopeCandidates } from "./parser";
import {
  validateEnvelope,
  type ContractViolationCode,
  type EnvelopeValidationContext,
  type ObservedEnvelope,
  type ResultEnvelope,
} from "./contract";

const STRUCTURED_RESULT_TIMEOUT_MS = getStructuredResultTimeoutMs();
const STRUCTURED_RESULT_POLL_MS = getStructuredResultPollMs();
const MAX_OBSERVED_ENVELOPES = 400;
const SESSION_COMPLETION_GRACE_MS = 1_200;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export const shouldFailFastForCompletedSession = (
  sessionCompletedAt: number | null,
  now = Date.now(),
) => sessionCompletedAt !== null && now >= sessionCompletedAt + SESSION_COMPLETION_GRACE_MS;

export const rememberObservedEnvelopes = (
  observed: ObservedEnvelope[],
  payload: unknown,
  source: string,
): ResultEnvelope[] => {
  const envelopes = collectEnvelopeCandidates(payload);
  const now = Date.now();
  for (const envelope of envelopes) {
    observed.push({
      envelope,
      observedAt: now,
      source,
    });
  }

  if (observed.length > MAX_OBSERVED_ENVELOPES) {
    observed.splice(0, observed.length - MAX_OBSERVED_ENVELOPES);
  }
  return envelopes;
};

export const evaluateEnvelopeCandidates = (
  envelopes: ResultEnvelope[],
  ctx: EnvelopeValidationContext,
): { envelope?: ResultEnvelope; violation?: ContractViolationCode; seenCandidate: boolean } => {
  const forRequestId = envelopes.filter((envelope) => envelope.requestId === ctx.requestId);
  if (forRequestId.length > 0) {
    let firstFailure: ContractViolationCode | null = null;
    for (const envelope of forRequestId) {
      const checked = validateEnvelope(envelope, ctx);
      if (checked.ok) return { envelope, seenCandidate: true };
      if (!firstFailure) firstFailure = checked.code;
    }
    return { violation: firstFailure ?? "result_envelope_missing", seenCandidate: true };
  }

  const related = envelopes.filter(
    (envelope) =>
      envelope.runId === ctx.runId &&
      envelope.nodeId === ctx.nodeId &&
      envelope.sessionId === ctx.sessionId,
  );
  if (related.length > 0) {
    return { violation: "request_id_mismatch", seenCandidate: true };
  }
  return { seenCandidate: false };
};

export const evaluateObservedEnvelopeWindow = (
  observed: ObservedEnvelope[],
  ctx: EnvelopeValidationContext,
  options?: { confirmFinal?: boolean },
): { envelope?: ResultEnvelope; violation?: ContractViolationCode; seenCandidate: boolean } => {
  const confirmFinal = options?.confirmFinal === true;
  const forRequestId = observed.filter((entry) => entry.envelope.requestId === ctx.requestId);
  if (forRequestId.length > 0) {
    if (!confirmFinal) {
      // agent 会话未结束前，只记录“已见到候选”，不能提前认定成功/失败。
      // 否则中途调试 JSON、半成品 envelope 都可能被过早消费。
      return { seenCandidate: true };
    }
    let latestFailure: ContractViolationCode | null = null;
    for (let i = forRequestId.length - 1; i >= 0; i -= 1) {
      const checked = validateEnvelope(forRequestId[i].envelope, ctx);
      if (checked.ok) return { envelope: forRequestId[i].envelope, seenCandidate: true };
      if (!latestFailure) latestFailure = checked.code;
    }
    return { violation: latestFailure ?? "result_envelope_missing", seenCandidate: true };
  }

  const related = observed.filter(
    (entry) =>
      entry.envelope.runId === ctx.runId &&
      entry.envelope.nodeId === ctx.nodeId &&
      entry.envelope.sessionId === ctx.sessionId,
  );
  if (related.length > 0) {
    if (!confirmFinal) return { seenCandidate: true };
    return { violation: "request_id_mismatch", seenCandidate: true };
  }
  return { seenCandidate: false };
};

/**
 * 等待结构化回执。
 *
 * 当传入 AbortSignal 且被触发时，提前退出本地轮询循环。
 * 远端 agent 的停止由上游 executionService 通过 "/stop" 命令处理。
 *
 * @param signal 可选的中止信号，用于流水线 stop/retry 时提前退出轮询。
 */
export const waitForStructuredEnvelope = async (
  emitter: EventEmitter,
  ctx: EnvelopeValidationContext,
  initialViolation: ContractViolationCode | null,
  hasSessionCompleted?: () => number | null,
  signal?: AbortSignal,
): Promise<ResultEnvelope> => {
  const deadline = Date.now() + STRUCTURED_RESULT_TIMEOUT_MS;
  let lastViolation = initialViolation;

  const latest: ObservedEnvelope[] = [];
  const MAX_LOCAL_ENVELOPES = 400;
  const onCandidate = (entry: ObservedEnvelope) => {
    latest.push(entry);
    if (latest.length > MAX_LOCAL_ENVELOPES) {
      latest.splice(0, latest.length - MAX_LOCAL_ENVELOPES);
    }
  };
  emitter.on("candidate", onCandidate);

  try {
    while (Date.now() <= deadline) {
      const currentWindow = [...latest];
      const sessionCompletedAt = hasSessionCompleted?.() ?? null;
      const canConfirm = shouldFailFastForCompletedSession(sessionCompletedAt);
      const checked = evaluateObservedEnvelopeWindow(currentWindow, ctx, { confirmFinal: canConfirm });
      if (checked.envelope) {
        return checked.envelope;
      }
      if (canConfirm && checked.violation) {
        lastViolation = checked.violation;
        throw new Error(`contract_violation:${checked.violation}`);
      }
      if (canConfirm) {
        throw new Error(`contract_violation:${lastViolation ?? "result_envelope_missing"}`);
      }
      await sleep(STRUCTURED_RESULT_POLL_MS);
      if (signal?.aborted) {
        throw new Error("aborted");
      }
    }
    throw new Error(`contract_violation:${lastViolation ?? "result_envelope_missing"}`);
  } finally {
    emitter.off("candidate", onCandidate);
  }
};

export const extractViolationCode = (error: unknown): ContractViolationCode | null => {
  const raw = String(error ?? "");
  const marker = "contract_violation:";
  const idx = raw.indexOf(marker);
  if (idx < 0) return null;
  const code = raw.slice(idx + marker.length).trim() as ContractViolationCode;
  return code || null;
};
