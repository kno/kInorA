/**
 * `delta` — KPI delta vs. the previous period (09c-v1-progress-dashboard-stats,
 * Slice 3a). Shared by every `StatsSummaryDTO` KPI (volume, sessions,
 * duration, PR count). Computes the percentage change from `previous` to
 * `current`, guarding the denominator: when the previous period has zero or
 * absent data, this returns `null` ("new" / no comparison) — never
 * `Infinity`, `-Infinity`, or `NaN` (design.md "KPI deltas: null when the
 * previous period is empty"). Pure — no I/O.
 */
export function delta(current: number, previous: number | null | undefined): number | null {
  if (previous === null || previous === undefined || previous === 0) {
    return null;
  }

  return ((current - previous) / previous) * 100;
}
