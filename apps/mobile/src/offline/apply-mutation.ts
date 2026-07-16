import type { PendingMutation, WorkoutSessionRecord } from "@kinora/contracts";

/**
 * Pure reducer applying ONE `PendingMutation` on top of a
 * `WorkoutSessionRecord` (Phase 5 mobile offline). Used for BOTH:
 *  - optimistic local apply the instant a set/complete is enqueued
 *  - replaying still-queued mutations on top of a cached snapshot during
 *    offline restart hydration
 *
 * Never mutates the input session. Identical logic to web's
 * `apply-mutation.ts` (kept as a separate copy per-platform since neither
 * app shares a runtime code module here — only the pure DTO types are
 * shared via `@kinora/contracts`).
 */
export function applyPendingMutation(
  session: WorkoutSessionRecord,
  mutation: PendingMutation,
): WorkoutSessionRecord {
  if (mutation.kind === "complete") {
    return { ...session, status: "completed" };
  }

  let changed = false;
  const exercises = session.exercises.map((exercise) => {
    const setIndex = exercise.setRecords.findIndex((set) => set.id === mutation.setId);
    if (setIndex === -1) return exercise;

    changed = true;
    const setRecords = exercise.setRecords.slice();
    setRecords[setIndex] = { ...setRecords[setIndex]!, ...mutation.input };
    return { ...exercise, setRecords };
  });

  return changed ? { ...session, exercises } : session;
}
