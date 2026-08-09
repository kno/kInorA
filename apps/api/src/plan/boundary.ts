import type { IntensityBias, PlanSpec } from "@kinora/contracts";
import { PLAN_NAME_MAX_LENGTH } from "@kinora/domain/plan";

const VALID_INTENSITY_BIASES: readonly IntensityBias[] = ["reduce", "maintain", "increase"];

/**
 * Maximum length of a plan `name` (#93). Mirrors the `workout_plans.name` column
 * (`VARCHAR(120)`) so the promote route can reject an over-long name as a clean
 * `422 plan_name_too_long` instead of blowing up the DB INSERT as a 500. The
 * name is trimmed BEFORE this bound is applied. Consumed by the route, not the
 * type validators below.
 *
 * #415 moved the constant itself into `@kinora/domain/plan`, beside
 * `validatePlanName`, so the rename path in the browser and both name-writing
 * routes read ONE bound. Re-exported here so this module's existing consumers
 * and their `plan_name_too_long` error code are unchanged.
 */
export { PLAN_NAME_MAX_LENGTH };

/**
 * Validates the optional plan `name` TYPE (#93): when present it must be a
 * string or null. Absent is valid (legacy specs and callers that never set it).
 *
 * Length is NOT enforced here. The VARCHAR(120) bound is a storage concern
 * mapped to a distinct `422 plan_name_too_long` by the promote route (see
 * apps/api/src/routes/plan.ts). Enforcing length here would surface as the
 * route's generic `409 incomplete_spec` instead — a misleading error — and make
 * the route's explicit 422 branch unreachable. Type violations stay a boundary
 * concern, shared by assertPlanSpecInput and assertPlanSpecShape.
 */
function assertPlanName(name: unknown): void {
  if (name === undefined || name === null) {
    return;
  }
  if (typeof name !== "string") {
    throw new Error("PlanSpec.name must be a string or null when present");
  }
}

/**
 * Validates the optional `intensityBias` TYPE (14b-v1.1): when present it
 * must be one of `"reduce" | "maintain" | "increase"`. Absent is valid
 * (legacy/never-adjusted specs — the contract documents absent as
 * `"maintain"`). This is a full PlanSpec (shape) concern only, NOT a wizard
 * input field — the wizard never writes it, only the `/adapt` LOAD confirm
 * branch does — so it is validated in `assertPlanSpecShape`, not
 * `assertInputFields`.
 */
function assertIntensityBias(intensityBias: unknown): void {
  if (intensityBias === undefined) {
    return;
  }
  if (
    typeof intensityBias !== "string" ||
    !VALID_INTENSITY_BIASES.includes(intensityBias as IntensityBias)
  ) {
    throw new Error(
      `PlanSpec.intensityBias must be one of ${VALID_INTENSITY_BIASES.join(", ")} when present`
    );
  }
}

/**
 * Maximum length of `branding.trainerName`/`branding.title` (15b-v2 S3), per
 * the spec's 60-character cap.
 */
export const BRANDING_FIELD_MAX_LENGTH = 60;

/**
 * Hex color pattern for `branding.accentColor` (15b-v2 S3): a `#` followed by
 * exactly 6 hex digits. Mirrors the spec's `^#[0-9a-fA-F]{6}$` requirement.
 */
const ACCENT_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

function assertBrandingTextField(value: unknown, fieldName: "trainerName" | "title"): void {
  if (value === undefined || value === null) {
    return;
  }
  if (typeof value !== "string") {
    throw new Error(`PlanSpec.branding.${fieldName} must be a string or null when present`);
  }
  if (value.length > BRANDING_FIELD_MAX_LENGTH) {
    throw new Error(
      `PlanSpec.branding.${fieldName} must be at most ${BRANDING_FIELD_MAX_LENGTH} characters`
    );
  }
}

/**
 * Validates the optional `branding` object (15b-v2 S3): when present it must
 * be an object; `trainerName`/`title` are string-or-null capped at
 * {@link BRANDING_FIELD_MAX_LENGTH}; `accentColor` must be a
 * `^#[0-9a-fA-F]{6}$` hex string or null when present. Absent branding is
 * valid — a plan without branding renders exactly as today (safe rollback).
 */
export function assertBranding(branding: unknown): void {
  if (branding === undefined) {
    return;
  }
  if (typeof branding !== "object" || branding === null) {
    throw new Error("PlanSpec.branding must be an object when present");
  }

  const b = branding as Record<string, unknown>;

  assertBrandingTextField(b.trainerName, "trainerName");
  assertBrandingTextField(b.title, "title");

  if (b.accentColor !== undefined && b.accentColor !== null) {
    if (typeof b.accentColor !== "string" || !ACCENT_COLOR_PATTERN.test(b.accentColor)) {
      throw new Error(
        "PlanSpec.branding.accentColor must match ^#[0-9a-fA-F]{6}$ when present"
      );
    }
  }
}

/**
 * Validates the wizard input fields common to both assertPlanSpecInput and
 * assertPlanSpecShape: goal, daysPerWeek, sessionDurationMinutes, location,
 * equipment (string[]), and limitations (PlanLimitation[]).
 *
 * Throws on the first violation. Extracted so both guards share one impl.
 */
function assertInputFields(obj: Record<string, unknown>): void {
  if (typeof obj.goal !== "string") {
    throw new Error("PlanSpec.goal must be a string");
  }

  if (typeof obj.daysPerWeek !== "number") {
    throw new Error("PlanSpec.daysPerWeek must be a number");
  }

  if (typeof obj.sessionDurationMinutes !== "number") {
    throw new Error("PlanSpec.sessionDurationMinutes must be a number");
  }

  if (typeof obj.location !== "string") {
    throw new Error("PlanSpec.location must be a string");
  }

  if (!Array.isArray(obj.equipment)) {
    throw new Error("PlanSpec.equipment must be an array");
  }

  for (let i = 0; i < obj.equipment.length; i++) {
    if (typeof obj.equipment[i] !== "string") {
      throw new Error(`PlanSpec.equipment[${i}] must be a string`);
    }
  }

  if (!Array.isArray(obj.limitations)) {
    throw new Error("PlanSpec.limitations must be an array");
  }

  for (let i = 0; i < obj.limitations.length; i++) {
    const limitation = obj.limitations[i] as unknown;
    if (typeof limitation !== "object" || limitation === null) {
      throw new Error(
        `PlanSpec.limitations[${i}] must be an object with {text: string, isWarning: boolean}`
      );
    }
    const lim = limitation as Record<string, unknown>;
    if (typeof lim.text !== "string") {
      throw new Error(`PlanSpec.limitations[${i}].text must be a string`);
    }
    if (typeof lim.isWarning !== "boolean") {
      throw new Error(`PlanSpec.limitations[${i}].isWarning must be a boolean`);
    }
  }

  // Optional plan name (#93) — TYPE only (string|null). Length (VARCHAR(120)) is
  // enforced by the promote route as a distinct 422 plan_name_too_long, not here.
  assertPlanName(obj.name);
}

/**
 * Validates that an unknown input carries the wizard INPUT fields only:
 * goal, daysPerWeek, sessionDurationMinutes, location, equipment, limitations.
 *
 * Does NOT require preferenceScores or confirmed — those are server-derived
 * on promote. Use this in the promote handler BEFORE calling derivePreferenceScores.
 *
 * Returns without error when all input fields are present and correctly typed.
 * Throws with a descriptive message on the first violation.
 */
export function assertPlanSpecInput(input: unknown): void {
  if (typeof input !== "object" || input === null) {
    throw new Error("PlanSpec must be an object");
  }

  const obj = input as Record<string, unknown>;
  assertInputFields(obj);
}

/**
 * Validates that an unknown input has the structural shape of a PlanSpec.
 * Throws if required fields are missing or have wrong types.
 * This is a boundary check — not full Zod validation.
 *
 * Updated (07-v1-plan-wizard): validates limitations as PlanLimitation[] (object array)
 * and preferenceScores as {strength, hypertrophy, endurance, mobility: number}.
 *
 * Atomic coupling note: change 08 (ai-plan-generation) reads PlanSpec.limitations as
 * PlanLimitation[] — this boundary validates the same shape for both 07 (wizard confirm)
 * and 08 (consumption). Both changes share this boundary file.
 */
export function assertPlanSpecShape(input: unknown): asserts input is PlanSpec {
  if (typeof input !== "object" || input === null) {
    throw new Error("PlanSpec must be an object");
  }

  const obj = input as Record<string, unknown>;

  // Validate the wizard input fields first (goal, daysPerWeek, etc.)
  assertInputFields(obj);

  // Validate preferenceScores shape — required on the full PlanSpec
  if (typeof obj.preferenceScores !== "object" || obj.preferenceScores === null) {
    throw new Error("PlanSpec.preferenceScores must be an object");
  }

  const scores = obj.preferenceScores as Record<string, unknown>;

  const scoreKeys = ["strength", "hypertrophy", "endurance", "mobility"] as const;

  for (const key of scoreKeys) {
    if (typeof scores[key] !== "number") {
      throw new Error(`PlanSpec.preferenceScores.${key} must be a number`);
    }
    if ((scores[key] as number) < 0 || (scores[key] as number) > 1) {
      throw new Error(
        `PlanSpec.preferenceScores.${key} must be in [0, 1], got ${scores[key]}`
      );
    }
  }

  if (typeof obj.confirmed !== "boolean") {
    throw new Error("PlanSpec.confirmed must be a boolean");
  }

  // Optional load bias (14b-v1.1) — server-written only via `/adapt`'s LOAD
  // branch, never by the wizard; absent = "maintain".
  assertIntensityBias(obj.intensityBias);

  // Optional plan name (#93) is validated by assertInputFields (called above)
  // via assertPlanName: string|null type + VARCHAR(120) length bound. A blank
  // wizard submission is normalized to null on promote so the read-side default
  // stays dynamic; absent is valid (legacy specs).

  // Optional trainer-authored branding (15b-v2 S3) — absent is valid (a plan
  // without branding renders exactly as today).
  assertBranding(obj.branding);
}
