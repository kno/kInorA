/**
 * Exercise taxonomy lookup — translates the dataset's controlled vocabulary.
 *
 * The upstream catalog stores body parts, equipment, targets and secondary
 * muscles as raw lowercase English (`"body weight"`, `"lats"`, `"hip
 * flexors"`). Rendering those verbatim inside translated sentence frames
 * produced spanglish for the ES locale, so all 85 distinct terms live in the
 * `exercises.taxonomy.*` namespace, keyed by the RAW catalog value.
 *
 * The four dimensions overlap (`traps`, `lats`, `biceps`, `calves` and
 * `upper back` each appear in more than one), so a term is defined exactly
 * once in a single flat map rather than duplicated across four.
 *
 * UNKNOWN TERMS FALL THROUGH TO THE RAW VALUE. The upstream dataset can add
 * vocabulary we have not mapped, and a regenerated catalog must degrade to
 * English rather than blanking the UI or leaking an `exercises.taxonomy.foo`
 * key path on screen. `packages/i18n`'s taxonomy-coverage test fails CI when a
 * new term appears, so the fallback is a safety net, not the plan.
 */

/**
 * Structural subset of next-intl's translator. Declared here because the real
 * type keys `t()` to literal message paths, which a runtime-built key can
 * never satisfy — and because both the server (`getTranslations`) and client
 * (`useTranslations`) translators satisfy this same shape.
 */
export interface TaxonomyTranslator {
  (key: string): string;
  has(key: string): boolean;
}

/** Translate one raw catalog term, in its natural (sentence-body) form. */
export function taxonomyTerm(t: TaxonomyTranslator, value: string): string {
  const key = `exercises.taxonomy.${value}`;
  return t.has(key) ? t(key) : value;
}

/**
 * Translate one term for standalone display (chips, tags, stat values), where
 * it starts a line and should read as a label.
 *
 * Capitalises only the FIRST character, never the rest: `"EZ barbell"` and
 * `"SkiErg machine"` carry meaningful internal capitals that CSS
 * `text-transform: capitalize` would corrupt into `"Ez Barbell"`.
 */
export function taxonomyLabel(t: TaxonomyTranslator, value: string): string {
  const term = taxonomyTerm(t, value);
  return term.charAt(0).toUpperCase() + term.slice(1);
}

/** Translate a list of terms and join them for display. */
export function taxonomyList(
  t: TaxonomyTranslator,
  values: string[],
  separator = " · "
): string {
  return values.map((value) => taxonomyTerm(t, value)).join(separator);
}
