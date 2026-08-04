"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { taxonomyLabel, type TaxonomyTranslator } from "./taxonomy";

/**
 * One distinct filter value plus its match count.
 *
 * Intentionally duplicated from `exercise-catalog-client.ts` rather than
 * imported: that module is `server-only` and importing it here would drag a
 * throwing module into the browser bundle (same boundary `PlanSelector`
 * documents for `plan-draft-client`).
 */
export interface FacetValue {
  value: string;
  count: number;
}

export interface ExerciseLibraryFacets {
  bodyPart: FacetValue[];
  equipment: FacetValue[];
  target: FacetValue[];
}

/** The filter fields the library exposes, in the order they are rendered. */
const FILTER_FIELDS = ["bodyPart", "equipment", "target"] as const;

type FilterField = (typeof FILTER_FIELDS)[number];

export interface ExerciseLibraryControlsProps {
  facets: ExerciseLibraryFacets;
  /** The currently applied filters, as resolved server-side from the URL. */
  selected: Partial<Record<FilterField, string>>;
  search?: string;
  /**
   * Query parameters to carry through a search submit, as hidden fields —
   * every active param EXCEPT `search` (the field itself) and `offset` (a new
   * search must land on page 1).
   *
   * Passed from the server rather than read from `useSearchParams()` so the
   * hidden inputs are present in the SERVER-RENDERED html. That is what lets
   * the form compose with the active filters even before (or without) React
   * hydrating.
   */
  preserved?: Record<string, string>;
}

/**
 * ExerciseLibraryControls — search box plus facet filter chips for
 * `/exercises`.
 *
 * Every interaction is a NAVIGATION: the component rewrites the query string
 * and lets the server component re-fetch the matching page. The ~1300-record
 * catalog is never shipped to the browser, so filtering client-side is not an
 * option — see `exercise-catalog-client.ts`.
 *
 * Any unrelated query parameter already on the URL (notably `?title=`, which
 * drives the read-only history reference) is preserved; `offset` is reset
 * whenever the result set changes, so a filter never lands on a page that no
 * longer exists.
 *
 * This component MUST NOT import a server-only module or reference
 * API_BASE_URL / NEXT_PUBLIC_API_BASE_URL — it only navigates.
 */
export function ExerciseLibraryControls({
  facets,
  selected,
  search,
  preserved = {},
}: ExerciseLibraryControlsProps) {
  const router = useRouter();
  const t = useTranslations();
  const searchParams = useSearchParams();
  // See `taxonomy.ts`. The chip LABEL is translated; the chip's VALUE stays the
  // raw catalog term, because that is what the API's filter parameters expect.
  const tax = t as unknown as TaxonomyTranslator;

  const hasFilters =
    Boolean(search) || FILTER_FIELDS.some((field) => Boolean(selected[field]));

  function navigate(mutate: (params: URLSearchParams) => void) {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    mutate(params);
    // The result set changed — restart from the first page.
    params.delete("offset");
    const query = params.toString();
    router.push(query ? `/exercises?${query}` : "/exercises");
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = new FormData(event.currentTarget).get("search");
    const term = typeof value === "string" ? value.trim() : "";
    navigate((params) => {
      if (term) params.set("search", term);
      else params.delete("search");
    });
  }

  function handleChipClick(field: FilterField, value: string) {
    navigate((params) => {
      // Clicking the active chip clears that filter (chips are a toggle).
      if (selected[field] === value) params.delete(field);
      else params.set(field, value);
    });
  }

  function handleClear() {
    navigate((params) => {
      params.delete("search");
      for (const field of FILTER_FIELDS) params.delete(field);
    });
  }

  return (
    <section className="kin-ex-toolbar">
      {/* A REAL GET form: `action` + `method` mean submitting navigates to
          /exercises?…&search=… through the browser itself, with no JavaScript
          involved. The previous version carried only an `onSubmit` handler, so
          the entire feature silently depended on this client component having
          hydrated — when it had not, the button did nothing at all.

          `onSubmit` is now a progressive ENHANCEMENT: when React is live it
          intercepts, drops an empty `search` and does a soft client-side push.
          When it is not, the native submit still produces a working URL. */}
      <form className="kin-ex-search" method="get" action="/exercises" onSubmit={handleSubmit} role="search">
        <label className="kin-label" htmlFor="exercise-search">
          {t("exercises.library.searchLabel")}
        </label>

        {/* Carries the active filters through the submit, so a search NARROWS
            the current view instead of replacing it. `offset` is deliberately
            absent: a new search restarts at page 1. */}
        {Object.entries(preserved).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} readOnly />
        ))}

        <div className="kin-ex-search__row">
          <input
            id="exercise-search"
            name="search"
            type="search"
            className="kin-input"
            defaultValue={search ?? ""}
            placeholder={t("exercises.library.searchPlaceholder")}
          />
          <button type="submit" className="kin-btn kin-btn--accent">
            {t("exercises.library.searchSubmit")}
          </button>
        </div>
      </form>

      {FILTER_FIELDS.map((field) =>
        facets[field].length === 0 ? null : (
          <div className="kin-ex-facet" key={field}>
            <p className="kin-ex-facet__label" id={`exercise-facet-${field}`}>
              {t(`exercises.library.filters.${field}`)}
            </p>
            <div
              className="kin-ex-chips kin-scroll"
              role="group"
              aria-labelledby={`exercise-facet-${field}`}
            >
              {facets[field].map((facet) => {
                const active = selected[field] === facet.value;
                return (
                  <button
                    key={facet.value}
                    type="button"
                    aria-pressed={active}
                    className={`kin-ex-chip${active ? " kin-ex-chip--active" : ""}`}
                    onClick={() => handleChipClick(field, facet.value)}
                  >
                    {taxonomyLabel(tax, facet.value)}
                    <span className="kin-ex-chip__count">{facet.count}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )
      )}

      {hasFilters && (
        <button type="button" className="kin-btn kin-btn--ghost" onClick={handleClear}>
          {t("exercises.library.clearFilters")}
        </button>
      )}
    </section>
  );
}
