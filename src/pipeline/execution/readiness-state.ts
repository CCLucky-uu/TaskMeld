type ReadinessStateCandidate = {
  status: string;
  wakeAt?: string | null;
};

export const isSleepWaitingState = (candidate: ReadinessStateCandidate) =>
  candidate.status === "waiting" && typeof candidate.wakeAt === "string" && candidate.wakeAt.trim().length > 0;

export const canPromoteToQueuedByDependency = (candidate: ReadinessStateCandidate) =>
  candidate.status === "blocked" ||
  candidate.status === "skipped" ||
  // Only "waiting" caused by unmet dependencies is allowed to be re-enqueued; sleep waiting must still wait until wakeAt expires.
  (candidate.status === "waiting" && !isSleepWaitingState(candidate));
