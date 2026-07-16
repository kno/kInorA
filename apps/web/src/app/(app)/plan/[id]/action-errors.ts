import type { FlushErrorCode } from "@kinora/contracts";

/**
 * Discriminated error thrown by `unwrapWorkoutSession` (Phase 4 web offline).
 *
 * Deliberately kept in its OWN plain module, not `actions.ts`: files with a
 * top-level `"use server"` directive may only export async functions —
 * exporting a class there would break at the Next.js build step even though
 * Vitest/tsc would not catch it.
 *
 * Previously `unwrapWorkoutSession` threw a bare `Error(message)`, collapsing
 * every Fastify-side failure into a single shape. The offline flush handler
 * in `use-workout-session.ts` needs to route retry (`UNREACHABLE`/`SERVER`)
 * vs. poison-drop (`VALIDATION`/`NOT_FOUND`) vs. stale-action ("reload to
 * sync") WITHOUT string-matching on `message`, so this carries the
 * `FlushErrorCode` `tracker-client.ts` already resolves from the HTTP status.
 */
export class WorkoutSessionActionError extends Error {
  readonly code: FlushErrorCode;

  constructor(message: string, code: FlushErrorCode) {
    super(message);
    this.name = "WorkoutSessionActionError";
    this.code = code;
  }
}
