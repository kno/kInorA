"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { joinFacetValues } from "./facet-values";
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

/**
 * Whether a click on a link may be intercepted and turned into a soft
 * navigation.
 *
 * Only a PLAIN primary-button click may. Cmd/Ctrl+click (new tab),
 * Shift+click (new window) and Alt+click (save target) all arrive as ordinary
 * `click` events, so a handler that calls `preventDefault()` unconditionally
 * swallows them and navigates in the same tab instead — the control looks like
 * a link, shows a target in the status bar, and then refuses to behave like
 * one. Letting these through costs one full page load and keeps the promise
 * the `href` makes.
 *
 * Middle-click needs nothing here: it fires `auxclick`, not `click`.
 *
 * Only used by the CLEAR-FILTERS link now — the facet controls are
 * checkboxes, which have no navigation target and therefore no modifier-click
 * contract to honour (design §7).
 */
function isPlainClick(event: React.MouseEvent): boolean {
  return (
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

/** The filter fields the library exposes, in the order they are rendered. */
const FILTER_FIELDS = ["bodyPart", "equipment", "target"] as const;

type FilterField = (typeof FILTER_FIELDS)[number];

/** Whether a submitted form field name is one of the facet groups. */
function isFilterField(name: string): name is FilterField {
  return (FILTER_FIELDS as readonly string[]).includes(name);
}

/** The current checkbox selection per facet group. */
type SelectedFilters = Partial<Record<FilterField, string[]>>;

/**
 * A stable, value-based signature of the resolved selection.
 *
 * Used instead of comparing the `selected` object by reference: a Server
 * Component parent hands down a NEW object literal on every render, so `!==`
 * would treat "the same selection, re-rendered" as a change and reset the
 * reader's in-progress toggle. Comparing by value mirrors how the search box
 * already tracks `search` (a primitive) across renders.
 */
function selectedSignature(selected: SelectedFilters): string {
  return FILTER_FIELDS.map((field) => `${field}:${(selected[field] ?? []).join(",")}`).join("|");
}

export interface ExerciseLibraryControlsProps {
  facets: ExerciseLibraryFacets;
  /** The currently applied filters, as resolved server-side from the URL. */
  selected: SelectedFilters;
  search?: string;
  /**
   * Query parameters to carry through a search submit, as hidden fields —
   * every active param EXCEPT `search` (the field itself), `offset` (a new
   * search must land on page 1) and `bodyPart`/`equipment`/`target` (the
   * facet checkboxes, now inside this same form, contribute those
   * themselves).
   *
   * `[key, value][]` rather than a `Record`, so a repeated key is never
   * silently collapsed to its last value by `Object.fromEntries`. Passed from
   * the server rather than read from `useSearchParams()` so the hidden inputs
   * are present in the SERVER-RENDERED html — what lets the form compose with
   * the active filters even before (or without) React hydrating.
   */
  preserved?: [string, string][];
  /**
   * Every active query parameter EXCEPT `offset`, used as the base the
   * clear-filters link mutates into a complete destination URL.
   *
   * `[key, value][]` — the same reason `preserved` carries pairs rather than
   * a `Record`. Server-rendered, like `preserved`, so
   * the clear-filters link carries a real `href` and navigates through the
   * browser itself when React has not hydrated.
   */
  carried?: [string, string][];
}

/**
 * ExerciseLibraryControls — search box plus facet filter checkboxes for
 * `/exercises`, all inside ONE `method="get"` form.
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
  preserved = [],
  carried = [],
}: ExerciseLibraryControlsProps) {
  const router = useRouter();
  const t = useTranslations();
  const searchParams = useSearchParams();
  // See `taxonomy.ts`. The chip LABEL is translated; the chip's VALUE stays the
  // raw catalog term, because that is what the API's filter parameters expect.
  const tax = t as unknown as TaxonomyTranslator;

  const hasFilters =
    Boolean(search) || FILTER_FIELDS.some((field) => (selected[field]?.length ?? 0) > 0);

  // The search box is CONTROLLED, and resets itself when — and only when — the
  // APPLIED term changes (React's documented "adjust state during render"
  // pattern). Two bugs meet here:
  //  - `defaultValue` alone seeded an uncontrolled field once. `router.push` is
  //    a soft navigation that keeps this component mounted, so after "Clear
  //    filters" the box still showed the old term and pressing Search silently
  //    re-applied a filter the reader believed cleared.
  //  - Keying the input on the applied term fixed that by REMOUNTING the node,
  //    which threw focus to <body> on every submit — on a phone, that closes
  //    the on-screen keyboard after each search.
  // Adjusting state keeps one stable DOM node, so focus and caret survive a
  // submit, while an unrelated navigation (a chip click, which leaves `search`
  // untouched) never disturbs what the reader is mid-way through typing.
  const [term, setTerm] = useState(search ?? "");
  const [appliedTerm, setAppliedTerm] = useState(search);
  if (appliedTerm !== search) {
    setAppliedTerm(search);
    setTerm(search ?? "");
  }

  // The checkbox selection is CONTROLLED the same way, comparing by VALUE
  // (`selectedSignature`) rather than object reference — see that helper.
  // Each checkbox is keyed on `${field}:${value}` (never on `selected`), so
  // toggling one never remounts it: that is what keeps DOM focus on the
  // checkbox the reader just clicked once the auto-submitted navigation
  // lands (#343's lesson — remounting is exactly what stole focus there).
  const [checkedByField, setCheckedByField] = useState<SelectedFilters>(selected);
  const [appliedSignature, setAppliedSignature] = useState(selectedSignature(selected));
  const currentSignature = selectedSignature(selected);
  if (appliedSignature !== currentSignature) {
    setAppliedSignature(currentSignature);
    setCheckedByField(selected);
  }

  function navigate(mutate: (params: URLSearchParams) => void) {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    mutate(params);
    // The result set changed — restart from the first page.
    params.delete("offset");
    const query = params.toString();
    router.push(query ? `/exercises?${query}` : "/exercises");
  }

  /**
   * The URL the clear-filters link points at, built from the SERVER-RENDERED
   * `carried` params rather than `useSearchParams()`.
   *
   * That is what makes the `href` present in the html the browser first
   * receives, so the control navigates natively with JavaScript disabled. When
   * React is live the click handler below intercepts and soft-navigates
   * instead, still reading the live params — so the hydrated path is
   * unchanged.
   */
  function hrefFor(mutate: (params: URLSearchParams) => void): string {
    const params = new URLSearchParams(carried);
    mutate(params);
    const query = params.toString();
    return query ? `/exercises?${query}` : "/exercises";
  }

  function clearHref(): string {
    return hrefFor((params) => {
      params.delete("search");
      for (const field of FILTER_FIELDS) params.delete(field);
    });
  }

  function handleClear() {
    navigate((params) => {
      params.delete("search");
      for (const field of FILTER_FIELDS) params.delete(field);
    });
  }

  /**
   * Toggle one facet value, then auto-submit the form.
   *
   * `event.currentTarget.form?.requestSubmit()` fires the form's own
   * `onSubmit`, which does a soft `router.push` — the same component stays
   * mounted, so this is a NAVIGATION, not a client-side filter. It is called
   * synchronously here, reading the DOM's own (already-toggled, by the
   * browser's default action) checkbox state rather than waiting on this
   * `setState` to flush — so the submitted form always reflects what the
   * reader just clicked, not a stale render.
   */
  function handleToggle(
    field: FilterField,
    value: string,
    event: React.ChangeEvent<HTMLInputElement>
  ) {
    setCheckedByField((prev) => {
      const current = prev[field] ?? [];
      const next = current.includes(value)
        ? current.filter((entry) => entry !== value)
        : [...current, value];
      return { ...prev, [field]: next };
    });
    event.currentTarget.form?.requestSubmit();
  }

  /**
   * Rebuilt from the submitted form's OWN entries, not from live
   * `useSearchParams()`.
   *
   * That is what lets one submit carry the search term plus every ticked
   * checkbox plus the hidden `title`/`lang` fields coherently: reading the
   * live URL instead would let a stale single-value param survive a
   * multi-select change it should have replaced. `offset` is never part of
   * this form, so it is never emitted — every submit restarts at page 1.
   *
   * The three facet groups submit as a REPEATED key (that is what a native
   * multi-checkbox form does) and are JOINED here into one occurrence before
   * the push. Pushing the repeated form is what broke #345: Next's router
   * keys the page's cached segment on
   * `Object.fromEntries(new URLSearchParams(search))`, which keeps only the
   * LAST occurrence, so `?bodyPart=chest&bodyPart=cardio` was
   * indistinguishable from `?bodyPart=cardio` — the RSC payload came back
   * correct and was discarded in favour of the previous results. See
   * `facet-values.ts`. The native no-JS submit still sends the repeated form,
   * which the page reads and then canonicalises.
   */
  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const params = new URLSearchParams();
    const facetValues = new Map<FilterField, string[]>();

    for (const [name, raw] of new FormData(event.currentTarget).entries()) {
      if (typeof raw !== "string") continue;
      if (isFilterField(name)) {
        const value = raw.trim();
        if (value) facetValues.set(name, [...(facetValues.get(name) ?? []), value]);
        continue;
      }
      const value = name === "search" ? raw.trim() : raw;
      if (value) params.append(name, value);
    }

    for (const field of FILTER_FIELDS) {
      const joined = joinFacetValues(facetValues.get(field) ?? []);
      if (joined) params.set(field, joined);
    }

    const query = params.toString();
    router.push(query ? `/exercises?${query}` : "/exercises");
  }

  return (
    <section className="kin-ex-toolbar">
      {/* ONE real GET form: `action` + `method` mean submitting navigates to
          /exercises?…&search=…&bodyPart=… through the browser itself, with no
          JavaScript involved — the search row, every facet checkbox and the
          trailing "Apply filters" button all live inside it (design §7).

          `onSubmit` is a progressive ENHANCEMENT: when React is live it
          intercepts and does a soft client-side push from the form's own
          FormData. When it is not, the native submit still produces a
          working URL with repeated `bodyPart=…` pairs. */}
      <form className="kin-ex-search" method="get" action="/exercises" onSubmit={handleSubmit} role="search">
        <label className="kin-label" htmlFor="exercise-search">
          {t("exercises.library.searchLabel")}
        </label>

        {/* Carries `title`/`lang` through the submit — everything the facet
            checkboxes do not already contribute. */}
        {preserved.map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} readOnly />
        ))}

        <div className="kin-ex-search__row">
          {/* Controlled, but never remounted — see the state above. React
              server-renders the `value` attribute, so the no-JS form still
              submits the applied term. */}
          <input
            id="exercise-search"
            name="search"
            type="search"
            className="kin-input"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder={t("exercises.library.searchPlaceholder")}
          />
          <button type="submit" className="kin-btn kin-btn--accent">
            {t("exercises.library.searchSubmit")}
          </button>
        </div>

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
                {/* Native CHECKBOXES, not links: multi-select has no correct
                    ARIA on an anchor — an `<a>` cannot legally carry
                    `aria-pressed`, and `aria-current` means "the current
                    SINGLE item". A checkbox natively submits repeated
                    same-name values with zero JavaScript, and its `checked`
                    state IS the applied/unapplied signal, so no `aria-*`
                    attribute is needed at all.

                    Keyed on `${field}:${value}` — NEVER on `selected` — so
                    toggling one never remounts it and DOM focus survives the
                    auto-submitted navigation. */}
                {facets[field].map((facet) => {
                  const checked = (checkedByField[field] ?? []).includes(facet.value);
                  return (
                    <label
                      key={`${field}:${facet.value}`}
                      className={`kin-ex-chip${checked ? " kin-ex-chip--active" : ""}`}
                    >
                      <input
                        type="checkbox"
                        className="kin-visually-hidden"
                        name={field}
                        value={facet.value}
                        checked={checked}
                        onChange={(event) => handleToggle(field, facet.value, event)}
                      />
                      {taxonomyLabel(tax, facet.value)}
                      <span className="kin-ex-chip__count">{facet.count}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )
        )}

        {/* ALWAYS rendered, so the no-JS/pre-hydration path can submit a
            checkbox change at all — the search button beside it only submits
            the search box's OWN row visually, but this one is the form's
            single always-present control dedicated to the facet groups. */}
        <button type="submit" className="kin-btn kin-btn--ghost kin-ex-apply">
          {t("exercises.library.applyFilters")}
        </button>
      </form>

      {hasFilters && (
        <a
          className="kin-btn kin-btn--ghost"
          href={clearHref()}
          onClick={(event) => {
            if (!isPlainClick(event)) return;
            event.preventDefault();
            handleClear();
          }}
        >
          {t("exercises.library.clearFilters")}
        </a>
      )}
    </section>
  );
}
