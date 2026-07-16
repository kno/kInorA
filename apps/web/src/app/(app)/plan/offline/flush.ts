import type { FlushErrorCode, PendingMutation, WorkoutSessionRecord } from "@kinora/contracts";

/**
 * Sequential flush orchestration (Phase 4 web offline design: "Flush is
 * strictly sequential — one in-flight request at a time, awaiting each ack
 * before dispatching the next entry. Concurrent dispatch (e.g. `Promise.all`
 * over the collapsed queue) is explicitly forbidden").
 *
 * `runSequentialFlush` is pure/injectable — the caller supplies `sendOne`,
 * which wraps the ACTUAL `recordWorkoutSetAction` / `completeWorkoutSessionAction`
 * calls in `use-workout-session.ts`. This keeps the ordering/taxonomy logic
 * unit-testable without mocking Server Actions (Mock Hygiene Rule).
 */

/**
 * Failure taxonomy (design: "Failure taxonomy... evaluated in this order on
 * flush failure"):
 * - `retry`: `UNREACHABLE` (network) or `SERVER` (5xx/unexpected) — entry
 *   stays queued, never poison-dropped.
 * - `drop`: `VALIDATION` / `NOT_FOUND` (4xx) — poison-message, drop + surface.
 * - `stale`: `STALE_ACTION` (web only) — entry stays queued, "reload to sync".
 *
 * An unknown/undefined code defaults to `retry` — the safe default is to
 * never silently discard a mutation whose failure mode we cannot classify.
 */
export function classifyFlushError(code: FlushErrorCode | undefined): "retry" | "drop" | "stale" {
  if (code === "STALE_ACTION") return "stale";
  if (code === "VALIDATION" || code === "NOT_FOUND") return "drop";
  return "retry";
}

/**
 * A Next.js redeploy between page load and flush can invalidate the
 * client's captured Server Action reference — surfacing as a distinct
 * "Server Action not found" class of thrown error, not a Fastify-side
 * response at all (design: "Stale Server Action reference on redeploy").
 */
const STALE_ACTION_PATTERN =
  /Failed to find Server Action|Server Action.*not found|could not find the module/i;

export function isStaleActionError(error: unknown): boolean {
  return error instanceof Error && STALE_ACTION_PATTERN.test(error.message);
}

export type SendMutationOutcome =
  | { kind: "ok"; session: WorkoutSessionRecord }
  | { kind: "error"; code: FlushErrorCode }
  | { kind: "stale" };

export interface FlushSummary {
  synced: PendingMutation[];
  dropped: PendingMutation[];
  remaining: PendingMutation[];
  staleActionDetected: boolean;
  /**
   * The `FlushErrorCode` that halted the sequence on a retryable failure
   * (`UNREACHABLE` / `SERVER` / `AUTH`), or `undefined` when every entry
   * synced or was poison-dropped without a halt. `AUTH` specifically lets
   * the caller distinguish "session expired mid-flush" (surface a
   * reload/sign-in-to-sync notice) from a generic network/server retry.
   */
  haltCode: FlushErrorCode | undefined;
  /** The session snapshot from the LAST successful ack, if any. */
  lastAckedSession: WorkoutSessionRecord | undefined;
}

export async function runSequentialFlush(
  mutations: PendingMutation[],
  sendOne: (mutation: PendingMutation) => Promise<SendMutationOutcome>,
): Promise<FlushSummary> {
  const synced: PendingMutation[] = [];
  const dropped: PendingMutation[] = [];
  const remaining: PendingMutation[] = [];
  let staleActionDetected = false;
  let haltCode: FlushErrorCode | undefined;
  let lastAckedSession: WorkoutSessionRecord | undefined;

  for (let i = 0; i < mutations.length; i++) {
    const mutation = mutations[i]!;

    // Once a stale-action reference or a retryable failure is detected, every
    // remaining entry (including this one) stays queued in ORDER — never
    // skip ahead and process a later entry out of sequence.
    const outcome = await sendOne(mutation);

    if (outcome.kind === "ok") {
      synced.push(mutation);
      lastAckedSession = outcome.session;
      continue;
    }

    if (outcome.kind === "stale") {
      staleActionDetected = true;
      remaining.push(mutation, ...mutations.slice(i + 1));
      break;
    }

    const branch = classifyFlushError(outcome.code);
    if (branch === "drop") {
      dropped.push(mutation);
      continue;
    }

    // retry: connectivity/server issues affecting this entry will affect
    // subsequent ones too — stop here, preserving order for the next flush.
    haltCode = outcome.code;
    remaining.push(mutation, ...mutations.slice(i + 1));
    break;
  }

  return { synced, dropped, remaining, staleActionDetected, haltCode, lastAckedSession };
}
