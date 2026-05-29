type ReadinessStateCandidate = {
  status: string;
  wakeAt?: string | null;
};

export const isSleepWaitingState = (candidate: ReadinessStateCandidate) =>
  candidate.status === "waiting" && typeof candidate.wakeAt === "string" && candidate.wakeAt.trim().length > 0;

export const canPromoteToQueuedByDependency = (candidate: ReadinessStateCandidate) =>
  candidate.status === "blocked" ||
  candidate.status === "skipped" ||
  // 仅允许“依赖未满足”造成的 waiting 被重新入队；sleep waiting 仍需等到 wakeAt 到期。
  (candidate.status === "waiting" && !isSleepWaitingState(candidate));
