/**
 * Plan-name default rule (#93).
 *
 * A single source of truth for resolving a plan's display label. Applied
 * server-side on read so the list, detail header, and selector all show the
 * SAME value and clients never branch on a null name.
 *
 * Pure and framework-free — safe to import client- or server-side.
 */

/**
 * Resolves the effective plan name.
 *
 * A non-blank `name` is returned trimmed. A null/undefined/blank name falls
 * back to a stable, date-based label derived from `createdAt`
 * (`Plan YYYY-MM-DD`), so the result is always a non-empty string.
 */
export function defaultPlanName(
  name: string | null | undefined,
  createdAt: Date | string,
): string {
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (trimmed !== "") {
    return trimmed;
  }

  const created = createdAt instanceof Date ? createdAt : new Date(createdAt);
  const datePart = created.toISOString().slice(0, 10);
  return `Plan ${datePart}`;
}
