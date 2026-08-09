/**
 * Structural rules a hand-edited workout program must satisfy (17d PR D).
 *
 * `WorkoutProgramSchema` is what the model answers against, and it is
 * deliberately permissive: it accepts an empty `weeklySessions` array, two
 * sessions claiming the same day, a day number of 99, and a session with no
 * exercises. Those all parse, and every one of them produces a program the
 * rest of the system cannot use:
 *
 * - zero sessions  → every `startSession` 404s, the plan is unusable
 * - duplicate day  → `startSession`'s `.find()` silently picks one of the two
 * - day out of 1..7 → the start route's own JSON schema (`day: { minimum: 1,
 *   maximum: 7 }`, `routes/workout-session.ts`) rejects it AFTER the edit is
 *   stored, i.e. the tracker renders a day that can never be started
 * - empty session  → the session snapshot records a workout with no exercises
 *
 * Generation never produced any of these, so nothing checked for them. A hand
 * edit can, which is why this exists. Pure, total, framework-free: no I/O, no
 * throw, safe to run client-side for early feedback and server-side as the
 * source of truth.
 */
import type { WorkoutProgram } from "@kinora/contracts";

/**
 * One structural problem with an edited program. Stable identifiers, not
 * prose: the API returns them verbatim and each client renders its own
 * localized message.
 */
export type EditedProgramIssue =
  | "empty_program"
  | "duplicate_day"
  | "invalid_day"
  | "empty_session";

/** Inclusive day bounds, copied from the start route's own `day` schema. */
export const EDITED_PROGRAM_DAY_BOUNDS = { min: 1, max: 7 } as const;

/**
 * Validate an edited program's structure.
 *
 * Returns every DISTINCT issue found, ordered by the first session that
 * exhibits it (document order), so a client can list them in the order the
 * user would read them. An empty array means the program is structurally
 * usable — it says nothing about whether the exercises are sensible, which is
 * the user's call, not ours.
 */
export function validateEditedProgram(program: WorkoutProgram): EditedProgramIssue[] {
  const issues: EditedProgramIssue[] = [];
  const add = (issue: EditedProgramIssue): void => {
    if (!issues.includes(issue)) {
      issues.push(issue);
    }
  };

  const sessions = program.weeklySessions;
  if (sessions.length === 0) {
    return ["empty_program"];
  }

  const seenDays = new Set<number>();
  for (const session of sessions) {
    const { min, max } = EDITED_PROGRAM_DAY_BOUNDS;
    if (!Number.isInteger(session.day) || session.day < min || session.day > max) {
      add("invalid_day");
    }
    if (seenDays.has(session.day)) {
      add("duplicate_day");
    }
    seenDays.add(session.day);

    if (session.exercises.length === 0) {
      add("empty_session");
    }
  }

  return issues;
}
