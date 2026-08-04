/**
 * Pure, in-memory query surface over the generated exercise catalog.
 *
 * The only I/O is the static JSON import below: every exported function is a
 * deterministic projection of that frozen dataset, so this module is fully
 * unit-testable with no fixtures, no network and no filesystem access.
 *
 * `../data/exercises.catalog.json` deliberately resolves to the SAME file from
 * the TypeScript source (`src/…/../data`) and from the build output
 * (`dist/…/../data`), so the built package needs no asset-copy step.
 */
import rawCatalog from "../data/exercises.catalog.json" with { type: "json" };

import type {
  ExerciseCatalogFilters,
  ExerciseCatalogPage,
  ExerciseCatalogRecord,
  ExerciseFacetFilters,
} from "./types.js";

/**
 * The generated file is written by `scripts/import-exercise-catalog.ts`, which
 * validates every record against `ExerciseCatalogRecord` before writing. See
 * `json-module.d.ts` for why the import is opaque and narrowed here.
 */
const records = rawCatalog as ExerciseCatalogRecord[];

interface IndexedExercise {
  record: ExerciseCatalogRecord;
  /** `record.name` run through `normalizeSearchText`, precomputed once. */
  normalizedName: string;
}

/**
 * Lowercases and strips diacritics so that `"peto"`, `"PETO"` and `"pétô"` all
 * match the same names. NFD decomposition separates the combining marks, which
 * the `\p{Diacritic}` class then removes.
 */
function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

function toIndexed(record: ExerciseCatalogRecord): IndexedExercise {
  return { record, normalizedName: normalizeSearchText(record.name) };
}

const indexed: IndexedExercise[] = records.map(toIndexed);

const byId: ReadonlyMap<string, ExerciseCatalogRecord> = new Map(
  indexed.map(toIdEntry),
);

function toIdEntry(entry: IndexedExercise): [string, ExerciseCatalogRecord] {
  return [entry.record.id, entry.record];
}

/**
 * Clamps a caller-supplied offset into `[0, total]`. Undefined, negative and
 * fractional values are all tolerated so an untrusted query string cannot
 * produce a nonsensical slice.
 */
function clampOffset(offset: number | undefined, total: number): number {
  if (offset === undefined) {
    return 0;
  }
  const truncated = Math.trunc(offset);
  if (truncated < 0) {
    return 0;
  }
  return Math.min(truncated, total);
}

/** Clamps a caller-supplied limit; `undefined` means "every remaining match". */
function clampLimit(limit: number | undefined, remaining: number): number {
  if (limit === undefined) {
    return remaining;
  }
  const truncated = Math.trunc(limit);
  if (truncated < 0) {
    return 0;
  }
  return Math.min(truncated, remaining);
}

/**
 * Membership test for one list-valued filter field. Absent and empty are both
 * "unconstrained" — enforced in exactly this one place so no per-field branch
 * can diverge from it.
 */
function selects(chosen: readonly string[] | undefined, actual: string): boolean {
  return chosen === undefined || chosen.length === 0 || chosen.includes(actual);
}

function matches(
  entry: IndexedExercise,
  filters: ExerciseCatalogFilters,
  normalizedSearch: string,
): boolean {
  const { record } = entry;
  if (!selects(filters.bodyPart, record.bodyPart)) {
    return false;
  }
  if (!selects(filters.equipment, record.equipment)) {
    return false;
  }
  if (!selects(filters.target, record.target)) {
    return false;
  }
  if (normalizedSearch !== "" && !entry.normalizedName.includes(normalizedSearch)) {
    return false;
  }
  return true;
}

/**
 * Returns the catalog records matching every supplied filter, in catalog
 * (upstream id) order, together with the pre-pagination match count.
 *
 * Filters combine with AND. `bodyPart`, `equipment` and `target` are exact
 * matches; `search` is a case- and accent-insensitive substring match on the
 * exercise name. A blank/whitespace-only `search` is treated as absent.
 */
export function listExercises(
  filters: ExerciseCatalogFilters = {},
): ExerciseCatalogPage {
  const normalizedSearch =
    filters.search === undefined ? "" : normalizeSearchText(filters.search);

  const matched: ExerciseCatalogRecord[] = [];
  for (const entry of indexed) {
    if (matches(entry, filters, normalizedSearch)) {
      matched.push(entry.record);
    }
  }

  const start = clampOffset(filters.offset, matched.length);
  const size = clampLimit(filters.limit, matched.length - start);
  return { items: matched.slice(start, start + size), total: matched.length };
}

/** Returns the record with the given upstream id, or `undefined` if unknown. */
export function getExerciseById(id: string): ExerciseCatalogRecord | undefined {
  return byId.get(id);
}

/** One filterable group whose distinct values can be tallied. */
export type ExerciseFacetField = "bodyPart" | "equipment" | "target";

/** One distinct facet value plus how many matching records carry it. */
export interface ExerciseFacetTally {
  value: string;
  count: number;
}

/** Same (count desc, value asc) ordering as the tally itself. */
function compareFacetTally(a: ExerciseFacetTally, b: ExerciseFacetTally): number {
  if (a.count !== b.count) {
    return b.count - a.count;
  }
  return a.value.localeCompare(b.value);
}

/** Tally one field across a set of records, ordered count desc, then value asc. */
function tallyField(
  records: readonly ExerciseCatalogRecord[],
  pick: (record: ExerciseCatalogRecord) => string,
): ExerciseFacetTally[] {
  const counts = new Map<string, number>();
  for (const record of records) {
    const value = pick(record);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort(compareFacetTally);
}

/**
 * Per-group facet tally, scoped to the current result set. For each group G,
 * the count reflects every OTHER active filter (including `search`) but
 * ignores G's own selection — a record excluded by the current bodyPart
 * selection must still be countable in the bodyPart facet itself.
 *
 * This is why the parameter type is {@link ExerciseFacetFilters}: it cannot
 * express `limit`/`offset`, so a tally can never be silently computed over
 * page 1 only. It genuinely re-filters per group — three `listExercises`
 * passes, each with that group's own key deleted — because records excluded
 * from the current result set by definition cannot appear in a single shared
 * filtered pass.
 */
export function tallyExerciseFacets(
  filters: ExerciseFacetFilters = {},
): Record<ExerciseFacetField, ExerciseFacetTally[]> {
  const withoutBodyPart = listExercises({ ...filters, bodyPart: undefined }).items;
  const withoutEquipment = listExercises({ ...filters, equipment: undefined }).items;
  const withoutTarget = listExercises({ ...filters, target: undefined }).items;

  return {
    bodyPart: tallyField(withoutBodyPart, (record) => record.bodyPart),
    equipment: tallyField(withoutEquipment, (record) => record.equipment),
    target: tallyField(withoutTarget, (record) => record.target),
  };
}
