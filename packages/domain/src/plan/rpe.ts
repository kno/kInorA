export type RpeValidation =
  | { ok: true; rpe: number }
  | { ok: false; reason: string };

const MIN_RPE = 0;
const MAX_RPE = 10;

export function validateRpe(value: unknown): RpeValidation {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { ok: false, reason: "RPE must be a finite number between 0 and 10." };
  }

  if (!Number.isInteger(value)) {
    return { ok: false, reason: "RPE must be an integer between 0 and 10." };
  }

  if (value < MIN_RPE || value > MAX_RPE) {
    return { ok: false, reason: "RPE must be between 0 and 10 inclusive." };
  }

  return { ok: true, rpe: value };
}
