import type { WorkoutSessionRecordStatus } from "@kinora/contracts";

/**
 * A session is TERMINAL once the server has moved it out of `"active"`:
 * `"completed"` (the user finished it) or `"abandoned"` (an explicit discard,
 * or the 24h auto-close). Only an `"active"` session may be hydrated as the
 * tracker's current session.
 *
 * Deliberately written as "not active" rather than an allow-list of terminal
 * values: a status the client does not recognise must NOT be treated as
 * resumable. Rendering a non-active session as the active one is exactly what
 * traps a user on `/plan`, where the tracker is a full state swap with no
 * navigation escape.
 */
export function isTerminalSessionStatus(
  status: WorkoutSessionRecordStatus,
): boolean {
  return status !== "active";
}
