import type { FlushErrorCode, PendingMutation, WorkoutSessionRecord } from "@kinora/contracts";

/**
 * Sequential flush orchestration (Phase 5 mobile offline design: "Flush is
 * strictly sequential — one in-flight request at a time, awaiting each ack
 * before dispatching the next entry. Concurrent dispatch (e.g. `Promise.all`
 * over the collapsed queue) is explicitly forbidden").
 *
 * `runSequentialFlush` is pure/injectable — the caller supplies `sendOne`,
 * which wraps the ACTUAL `recordWorkoutSet` / `completeWorkoutSession` API
 * calls in `WorkoutTrackerScreen.tsx`. This keeps the ordering/taxonomy
 * logic unit-testable without mocking the API client (Mock Hygiene Rule).
 *
 * Mobile calls the API directly (no Next.js Server Actions), so the web-only
 * `STALE_ACTION` failure mode does not apply here — every retryable failure
 * (`UNREACHABLE` / `SERVER` / `AUTH`) is handled by the SAME "halt, keep
 * queued in order" branch, distinguished only via `haltCode` for the
 * caller's UI-notice branch (AUTH gets its own surfaced message).
 */

/**
 * Failure taxonomy (design: "Failure taxonomy... evaluated in this order on
 * flush failure"):
 * - `retry`: `UNREACHABLE` (network), `SERVER` (5xx/unexpected), or `AUTH`
 *   (401/403 — session expired/revoked mid-flush) — entry stays queued,
 *   never poison-dropped.
 * - `drop`: `VALIDATION` / `NOT_FOUND` (4xx) — poison-message, drop + surface.
 *
 * An unknown/undefined code defaults to `retry` — the safe default is to
 * never silently discard a mutation whose failure mode we cannot classify.
 */
export function classifyFlushError(code: FlushErrorCode | undefined): "retry" | "drop" {
  if (code === "VALIDATION" || code === "NOT_FOUND") return "drop";
  return "retry";
}

export type SendMutationOutcome =
  | { kind: "ok"; session: WorkoutSessionRecord }
  | { kind: "error"; code: FlushErrorCode | undefined };

export interface FlushSummary {
  synced: PendingMutation[];
  dropped: PendingMutation[];
  remaining: PendingMutation[];
  /**
   * The `FlushErrorCode` that halted the sequence on a retryable failure
   * (`UNREACHABLE` / `SERVER` / `AUTH`), or `undefined` when every entry
   * synced or was poison-dropped without a halt, OR the halting outcome
   * itself carried no code. `AUTH` specifically lets the caller
   * distinguish "session expired mid-flush" (surface a reload/sign-in-to-
   * sync notice) from a generic network/server retry.
   */
  haltCode: FlushErrorCode | undefined;
  /** The session snapshot from the LAST successful ack, if any. */
  lastAckedSession: WorkoutSessionRecord | undefined;
  /** Latest successful ack per session, ordered by first acknowledgement. */
  ackedSessions: WorkoutSessionRecord[];
}

export async function runSequentialFlush(
  mutations: PendingMutation[],
  sendOne: (mutation: PendingMutation) => Promise<SendMutationOutcome>,
): Promise<FlushSummary> {
  const synced: PendingMutation[] = [];
  const dropped: PendingMutation[] = [];
  const remaining: PendingMutation[] = [];
  let haltCode: FlushErrorCode | undefined;
  let lastAckedSession: WorkoutSessionRecord | undefined;
  const ackedBySession = new Map<string, WorkoutSessionRecord>();

  for (let i = 0; i < mutations.length; i++) {
    const mutation = mutations[i]!;

    const outcome = await sendOne(mutation);

    if (outcome.kind === "ok") {
      synced.push(mutation);
      lastAckedSession = outcome.session;
      ackedBySession.set(outcome.session.id, outcome.session);
      continue;
    }

    const branch = classifyFlushError(outcome.code);
    if (branch === "drop") {
      dropped.push(mutation);
      continue;
    }

    // retry: connectivity/server/auth issues affecting this entry will
    // affect subsequent ones too — stop here, preserving order for the
    // next flush. Every remaining entry (including this one) stays queued
    // in ORDER — never skip ahead and process a later entry out of sequence.
    haltCode = outcome.code;
    remaining.push(mutation, ...mutations.slice(i + 1));
    break;
  }

  return {
    synced,
    dropped,
    remaining,
    haltCode,
    lastAckedSession,
    ackedSessions: [...ackedBySession.values()],
  };
}
