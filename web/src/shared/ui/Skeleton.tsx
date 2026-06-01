/**
 * Base skeleton component.
 * Used as a placeholder during async data loading to avoid layout shifts (CLS).
 * Supports rectangle, circle, and text-line variants via preset child-class combinations.
 */

import i18n from "../i18n";

type SkeletonProps = {
  /** Additional class names, controls width, height, border-radius, etc. */
  className?: string;
};

export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      role="status"
      aria-label={i18n.t("common:common.loading")}
      className={`animate-pulse bg-[rgba(142,163,179,0.15)] ${className ?? ""}`}
    />
  );
}

/** Title skeleton: 60% width placeholder simulating a heading height */
export function SkeletonTitle() {
  return <Skeleton className="mb-2 h-5 w-3/5" />;
}

/** Body skeleton: 90% width placeholder simulating body text height */
export function SkeletonBody() {
  return <Skeleton className="mb-1.5 h-4 w-[90%]" />;
}

/** Card skeleton: simulates the loading state of a pipeline/agent card area */
export function SkeletonCard() {
  return (
    <div className="border border-(--line) bg-[linear-gradient(180deg,var(--panel)_0%,var(--panel-2)_100%)] p-4">
      <SkeletonTitle />
      <SkeletonBody />
      <SkeletonBody />
      <Skeleton className="h-4 w-2/5" />
    </div>
  );
}
