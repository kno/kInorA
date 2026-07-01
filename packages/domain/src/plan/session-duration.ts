/**
 * Session-duration domain rules for the create-plan wizard.
 *
 * A single source of truth for the allowed session length so the wizard's
 * static options, its custom numeric input, and any server-side check all
 * agree. Pure and framework-free — safe to import client- or server-side.
 */

/** Inclusive minute bounds for a valid session duration. */
export const SESSION_DURATION_LIMITS = {
  min: 15,
  max: 240,
} as const;

export type SessionDurationValidation =
  | { ok: true; minutes: number }
  | { ok: false; reason: string };

/**
 * Validates a session duration in minutes against the domain bounds.
 *
 * A valid duration is a finite integer within
 * [{@link SESSION_DURATION_LIMITS.min}, {@link SESSION_DURATION_LIMITS.max}].
 * Zero, negatives, fractions, and non-finite values are rejected.
 */
export function validateSessionDuration(
  minutes: number,
): SessionDurationValidation {
  const { min, max } = SESSION_DURATION_LIMITS;
  const outOfRange = `Enter a duration between ${min} and ${max} minutes.`;

  if (!Number.isFinite(minutes) || !Number.isInteger(minutes)) {
    return { ok: false, reason: outOfRange };
  }

  if (minutes < min || minutes > max) {
    return { ok: false, reason: outOfRange };
  }

  return { ok: true, minutes };
}
