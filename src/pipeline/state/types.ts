import type { ArtifactManifest } from "../runtime-model";

/** State transition command: indicates who is requesting this state change; different commands have different permissions. */
export type StateTransitionCommand =
  | "execute"        // Normal execution path
  | "dependency"     // Dependency advancement (scheduler marks ready/waiting/skipped/blocked)
  | "sleep"          // sleepUntil wake-up
  | "retry_reset"    // Retry reset
  | "reject_reset"   // Rejection reset
  | "route_backfill" // Route initialization backfill (copy ancestor state)
  | "group_aggregate"; // Parallel group aggregation

export type StateTransitionContext = {
  reason: string;
  command?: StateTransitionCommand;
  now?: string;
  error?: string | null;
  wakeAt?: string | null;
  artifacts?: ArtifactManifest[];
};
