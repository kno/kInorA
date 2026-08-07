/**
 * The workout-session abandonment threshold and its cutoff arithmetic
 * (17b-stale-session-recovery).
 *
 * Lives at `db/` — not `packages/domain` — because every consumer is inside
 * `apps/api` (the session repository and admin-stats reporting): no client
 * ever needs this number, since the under-24h conflict banner only ever
 * renders BELOW the threshold. Crossing a package boundary for two same-app
 * consumers would buy nothing and cost the dist-staleness gotcha (apps
 * resolve workspace packages through built `dist/`, so an unrebuilt package
 * would silently serve a stale value) — tolerable for a stats constant, not
 * for one that decides whether a user can train.
 *
 * `abandonedSessionCutoff` ships alongside the constant so the hours-to-ms
 * arithmetic is never duplicated: two files independently computing
 * `now - HOURS * HOUR_MS` is a second magic number wearing a disguise, and a
 * one-hour disagreement between the funnel and the write path is exactly the
 * kind of bug that produces a double-count.
 */

const HOUR_MS = 3_600_000;

/**
 * How long a `workout_sessions` row may sit in `status = 'active'` before it
 * is treated as abandoned. Behavioural since 17b: past this age, starting a
 * new session auto-closes the blocking one instead of returning a conflict.
 */
export const ABANDONED_SESSION_THRESHOLD_HOURS = 24;

/** The instant before which an `active` session is considered abandoned. */
export function abandonedSessionCutoff(now: Date): Date {
  return new Date(now.getTime() - ABANDONED_SESSION_THRESHOLD_HOURS * HOUR_MS);
}
