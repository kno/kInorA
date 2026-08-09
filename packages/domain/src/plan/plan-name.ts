/**
 * Rules a user-supplied plan name must satisfy (#415).
 *
 * Renaming is the first path that lets a user write `workout_plans.name`
 * directly, so it is the first path that needs a rule for what a name may be.
 * Generation authored the column before, and never authored anything blank or
 * oversized, which is why nothing checked.
 *
 * Two rules, and both exist because of a concrete failure downstream:
 *
 * - `plan_name_empty` — a whitespace-only name is REJECTED rather than stored.
 *   `defaultPlanName` would resolve a blank stored name to `Plan YYYY-MM-DD`
 *   on read, so storing `"   "` would not render a blank row; it would render
 *   a plan the user believes they named and that every surface labels with a
 *   date instead. Rejecting says so at the moment they can still fix it. The
 *   blank→default layer stays exactly where it is, as the ONE rule for legacy
 *   and wizard-authored blanks — this adds no second one.
 * - `plan_name_too_long` — `name` is `varchar(120)` (`schema.ts`). A longer value
 *   is a database error, not a user-facing message, so the bound is checked
 *   here in the same place the client can check it before the round-trip.
 *
 * Pure, total, framework-free — the same discipline as `validateEditedProgram`,
 * and for the same reason: the client runs it for early feedback and the
 * server runs it as the source of truth.
 */

/** Inclusive upper bound, matching `workout_plans.name`'s `varchar(120)`. */
export const PLAN_NAME_MAX_LENGTH = 120;

/**
 * One problem with a submitted plan name. Stable identifiers, not prose: the
 * API returns them verbatim and each client renders its own localized message,
 * exactly like `EditedProgramIssue`.
 */
export type PlanNameIssue = "plan_name_empty" | "plan_name_too_long";

/**
 * Validate a submitted plan name.
 *
 * Length is measured on the TRIMMED value, because the trimmed value is what
 * gets stored — a name padded past 120 characters with spaces is not too long,
 * it is untrimmed. Returns every distinct issue; an empty array means the name
 * is storable as `normalizePlanName` returns it.
 */
export function validatePlanName(name: string): PlanNameIssue[] {
  const trimmed = normalizePlanName(name);
  const issues: PlanNameIssue[] = [];

  if (trimmed === "") {
    issues.push("plan_name_empty");
  }
  if (trimmed.length > PLAN_NAME_MAX_LENGTH) {
    issues.push("plan_name_too_long");
  }

  return issues;
}

/**
 * The value a valid name is stored as. Separate from the check so the caller
 * cannot validate one string and persist another.
 */
export function normalizePlanName(name: string): string {
  return name.trim();
}
