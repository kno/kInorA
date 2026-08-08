/**
 * `resolveBodyweightForSession` (17c-profile-body-metrics, PR 4) — decides
 * which bodyweight reading applies to a given session date, per design.md
 * "The weight resolution rule" (decision 5).
 *
 * A pure function specifically so the load-bearing resolution rule is
 * provable in the always-run unit suite rather than depending on the
 * real-Postgres CI job's hardcoded file list (#382).
 */
export interface BodyweightEntry {
  weightKg: number;
  /** ISO-8601 instant the reading was recorded. */
  recordedAt: string;
}

/**
 * The bodyweight that applies to a session completed at `sessionAt`.
 *
 * Nearest reading at-or-before the session; when every reading is LATER than
 * the session (i.e. the session predates the user's first weigh-in), the
 * EARLIEST reading is the backstop. Returns `undefined` only when there are
 * no readings at all — never a guessed or averaged number.
 *
 * A later weigh-in never rewrites an already-resolved older session: adding
 * a new reading only changes the resolution of sessions between the
 * previous nearest-before reading and the new one.
 *
 * `entries` need not be pre-sorted — this function sorts a copy ascending by
 * `recordedAt` before resolving. JS's `Array.prototype.sort` is stable
 * (guaranteed since ES2019), so two entries recorded at the identical
 * instant keep their relative input order; the caller (the repository's
 * batched `recordedAt ASC, id ASC` read) is what makes "later-inserted" the
 * one that sorts last among ties.
 */
export function resolveBodyweightForSession(
  entries: readonly BodyweightEntry[],
  sessionAt: string,
): number | undefined {
  if (entries.length === 0) {
    return undefined;
  }

  const ascending = [...entries].sort(
    (left, right) => new Date(left.recordedAt).getTime() - new Date(right.recordedAt).getTime(),
  );

  const sessionTime = new Date(sessionAt).getTime();
  let atOrBefore: BodyweightEntry | undefined;

  for (const entry of ascending) {
    if (new Date(entry.recordedAt).getTime() <= sessionTime) {
      // Entries are ascending, so the last qualifying one is both the
      // nearest-before reading and, among same-instant ties, the
      // later-inserted one (stable sort preserves that order).
      atOrBefore = entry;
    }
  }

  return (atOrBefore ?? ascending[0])?.weightKg;
}
