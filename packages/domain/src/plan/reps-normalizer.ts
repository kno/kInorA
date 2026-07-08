import type { WorkoutProgram } from "@kinora/contracts";

/**
 * Fallback reps value used when a reps string is missing, empty, or contains
 * no salvageable digits.
 */
export const DEFAULT_REPS = "8-12";

/** Canonical count form, e.g. "15". */
const COUNT_PATTERN = /^\d+$/;

/** Canonical range form, e.g. "8-12". */
const RANGE_PATTERN = /^\d+-\d+$/;

/** Canonical time form, e.g. "20 min", "30s", "45 sec". */
const TIME_PATTERN = /^\d+\s?(s|sec|secs|min|mins)$/i;

/** Detects a time unit token anywhere in the string (case-insensitive). */
const TIME_UNIT_TOKEN_PATTERN = /(\d+)\s?(s|sec|secs|min|mins)\b/i;

/** Matches every run of digits in the string, in order. */
const INTEGER_PATTERN = /\d+/g;

/**
 * Normalizes a single, possibly-corrupted `reps` string into a canonical
 * form the UI can safely render.
 *
 * `reps` is a free-form string that legitimately covers count ("15"), range
 * ("8-12"), and time-based ("20 min", "30s") values. The AI generator
 * occasionally leaks model tokens into this field (e.g. "6- vain? 8",
 * "5-7lng"). Rather than rejecting the whole plan, this function SALVAGES
 * the numeric intent from the corrupted string, falling back to
 * {@link DEFAULT_REPS} only when no digits can be recovered.
 *
 * Pure function — no side effects.
 *
 * @param raw The raw reps value (expected to be a string, but tolerated to
 *            be null/undefined/non-string from untrusted upstream data).
 * @returns A canonical reps string: a count, a range, a time value, or
 *          {@link DEFAULT_REPS}.
 */
export function normalizeReps(raw: string): string {
  if (typeof raw !== "string") {
    return DEFAULT_REPS;
  }

  const trimmed = raw.trim();

  if (
    COUNT_PATTERN.test(trimmed) ||
    RANGE_PATTERN.test(trimmed) ||
    TIME_PATTERN.test(trimmed)
  ) {
    return trimmed;
  }

  const timeMatch = TIME_UNIT_TOKEN_PATTERN.exec(trimmed);
  if (timeMatch?.[1] !== undefined && timeMatch[2] !== undefined) {
    return `${timeMatch[1]} ${timeMatch[2].toLowerCase()}`;
  }

  const integers = trimmed.match(INTEGER_PATTERN);
  if (!integers || integers.length === 0) {
    return DEFAULT_REPS;
  }

  if (integers.length >= 2) {
    return `${integers[0]}-${integers[1]}`;
  }

  return integers[0]!;
}

/**
 * Returns a NEW WorkoutProgram with every exercise's `reps` value passed
 * through {@link normalizeReps}. Does not mutate the input program.
 *
 * @param program The workout program to normalize.
 * @returns A new WorkoutProgram with salvaged/normalized reps values.
 */
export function normalizeProgramReps(program: WorkoutProgram): WorkoutProgram {
  return {
    ...program,
    weeklySessions: program.weeklySessions.map((session) => ({
      ...session,
      exercises: session.exercises.map((exercise) => ({
        ...exercise,
        reps: normalizeReps(exercise.reps),
      })),
    })),
  };
}
