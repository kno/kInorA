import type { WorkoutProgram } from "@kinora/contracts";

/**
 * Outcome of `PUT /workout-plans/:id/program` (17d PR D).
 *
 * Declared HERE, in a client-safe module, rather than beside the fetch that
 * produces it: `program-edit-client.ts` is `server-only`, and the editor is a
 * client component that needs the shape to narrow the Server Action's result.
 * The UI → API guardrail rejects any import from a server-only module in a
 * client component — including a type-only one — so the contract lives apart
 * from the transport.
 *
 * The two 409s are SEPARATE branches on purpose. They share a status code but
 * mean different things to the person who just lost their edit: `conflict`
 * means someone else saved first and a reload recovers the current version;
 * `not_ready` means the plan is generating or failed and editing does not
 * apply at all. Collapsing them into one "save failed" would leave the user
 * guessing which, and a reload is the right move for only one of them.
 *
 * `invalid` carries the server's structural issues verbatim (the
 * `EditedProgramIssue` and `PlanNameIssue` identifiers) so the form can point
 * at the actual rule that was broken.
 *
 * `ok` carries the plan's `name` as the SERVER resolved it (#415) — through
 * the same blank→default layer every other plan read goes through — rather
 * than echoing what the editor typed, so the header shows what `/plans` will.
 */
export type UpdateProgramResult =
  | { kind: "ok"; name: string; program: WorkoutProgram; version: number }
  | { kind: "conflict"; currentVersion: number | null }
  | { kind: "not_ready" }
  | { kind: "invalid"; issues: string[] }
  | { kind: "error"; message: string };
