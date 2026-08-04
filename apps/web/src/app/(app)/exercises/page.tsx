import { getTranslations } from "next-intl/server";
import {
  getExerciseCatalogFacetsAction,
  getExerciseDetailAction,
  listExerciseCatalogAction,
} from "./actions";
import { ExerciseAttribution } from "./ExerciseAttribution";
import { ExerciseLibraryControls, type ExerciseLibraryFacets } from "./ExerciseLibraryControls";
import { taxonomyTerm, type TaxonomyTranslator } from "./taxonomy";
import {
  EXERCISE_PAGE_SIZE,
  carriedFilterParams,
  normalizeLibraryParams,
  pageHref,
  parseOffset,
  preservedSearchParams,
  type RawExerciseLibraryParams,
} from "./library-query";

interface ExercisesPageProps {
  /**
   * `?title=` selects an exercise for the read-only recent-history reference
   * (09c-v1-progress-dashboard-stats, Slice 4b). Optional — absent falls
   * back to the plain scaffold with no history section.
   *
   * `?search=`, `?bodyPart=`, `?equipment=`, `?target=` and `?offset=` drive
   * the library grid; they are forwarded to the API, never applied in the
   * browser (see `exercise-catalog-client.ts`).
   *
   * Typed RAW (`string | string[]`) because that is what the App Router
   * actually delivers — a repeated key arrives as an array. Everything below
   * works on the normalised form (see `normalizeLibraryParams`).
   */
  searchParams?: Promise<RawExerciseLibraryParams>;
}

/**
 * Exercises — protected page rendered inside the AppShell.
 *
 * Ships the exercise library (search + facet filters + paginated card grid)
 * and, when `?title=` selects a previously-performed exercise, a read-only
 * recent-history reference (Slice 4b, design.md "Exercise detail"). The
 * history section is a purely additive block: it is entirely omitted when
 * there is no history, never a live-tracking substitute (spec.md "Exercise
 * Detail Progress References").
 *
 * The catalog holds ~1300 records: only the requested page crosses the wire,
 * because search, filtering and pagination are resolved by the API.
 *
 * User-facing copy comes from next-intl (see `@/i18n/request`), whose
 * locale is resolved from the `?lang=` query parameter (via the
 * `x-kinora-lang` header injected by `proxy.ts`) or the `Accept-Language`
 * header.
 */
export default async function ExercisesPage({ searchParams }: ExercisesPageProps) {
  const t = await getTranslations();
  // See `taxonomy.ts` — runtime-built keys cannot satisfy next-intl's typing.
  const tax = t as unknown as TaxonomyTranslator;
  // Collapses repeated keys and drops/clamps values the API would reject, so a
  // hand-written URL yields an ordinary result rather than a crash or a false
  // "library unavailable" card.
  const params = normalizeLibraryParams((await searchParams) ?? {});
  const { title, search, bodyPart, equipment, target } = params;

  const detailResult = title ? await getExerciseDetailAction(title) : undefined;
  const recentSets = detailResult?.kind === "ok" ? detailResult.detail.recentSets : [];
  const exerciseTitle = detailResult?.kind === "ok" ? detailResult.detail.exerciseTitle : undefined;

  const offset = parseOffset(params.offset);
  const [listResult, facetsResult] = await Promise.all([
    listExerciseCatalogAction({
      search,
      bodyPart,
      equipment,
      target,
      limit: EXERCISE_PAGE_SIZE,
      offset,
    }),
    getExerciseCatalogFacetsAction(),
  ]);

  const facets: ExerciseLibraryFacets =
    facetsResult.kind === "ok"
      ? facetsResult.facets
      : { bodyPart: [], equipment: [], target: [] };

  return (
    <main className="kin-page">
      <div className="kin-card kin-card--center">
        <h1 className="kin-title">{t("exercises.title")}</h1>
        <p className="kin-text kin-muted">{t("exercises.description")}</p>
      </div>

      {/* `?title=` means the reader ARRIVED HERE by clicking "View my history"
          on a detail page, so this block must always answer. Rendering it only
          for a non-empty `recentSets` made that button a silent no-op for every
          exercise the reader has never logged — the click navigated and nothing
          on the page acknowledged it. */}
      {title && detailResult?.kind === "error" && (
        <div className="kin-card kin-card--warning" data-testid="exercise-history-error">
          <h2 className="kin-title">{t("exercises.history.error.title")}</h2>
          <p className="kin-text kin-muted">{t("exercises.history.error.description")}</p>
        </div>
      )}

      {title && detailResult?.kind === "ok" && recentSets.length === 0 && (
        <div className="kin-card kin-card--center" data-testid="exercise-history-empty">
          <h2 className="kin-title">
            {t("exercises.history.empty.title", { exerciseTitle: exerciseTitle ?? title })}
          </h2>
          <p className="kin-text kin-muted">{t("exercises.history.empty.description")}</p>
        </div>
      )}

      {recentSets.length > 0 && (
        <div className="kin-card" data-testid="exercise-history">
          {exerciseTitle && <h3 className="kin-title">{t("exercises.history.exerciseHeading", { exerciseTitle })}</h3>}
          <h2 className="kin-title">{t("exercises.history.title")}</h2>
          <table>
            <thead>
              <tr>
                <th>{t("exercises.history.date")}</th>
                <th>{t("exercises.history.weight")}</th>
                <th>{t("exercises.history.reps")}</th>
                <th>{t("exercises.history.rpe")}</th>
              </tr>
            </thead>
            <tbody>
              {recentSets.map((set, index) => (
                <tr key={`${set.completedAt}-${index}`}>
                  <td>{set.completedAt.slice(0, 10)}</td>
                  <td>{set.weightKg ?? "—"}</td>
                  <td>{set.actualReps ?? "—"}</td>
                  <td>{set.rpe ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ExerciseLibraryControls
        facets={facets}
        selected={{ bodyPart, equipment, target }}
        search={search}
        preserved={preservedSearchParams(params)}
        carried={carriedFilterParams(params)}
      />

      {listResult.kind === "error" ? (
        <div className="kin-card kin-card--warning" data-testid="exercise-library-error">
          <h2 className="kin-title">{t("exercises.library.error.title")}</h2>
          <p className="kin-text kin-muted">{t("exercises.library.error.description")}</p>
        </div>
      ) : listResult.page.items.length === 0 && listResult.page.total > 0 ? (
        /* The filters DO match — this page is simply past the end of them
           (`?offset=5000`). Saying "nothing matches" would be a lie, and the
           pager below is skipped on this branch, so without this link the
           reader has no way back to a page that exists. */
        <div className="kin-card kin-card--center" data-testid="exercise-library-out-of-range">
          <h2 className="kin-title">{t("exercises.library.outOfRange.title")}</h2>
          <p className="kin-text kin-muted">
            {t("exercises.library.outOfRange.description", { total: listResult.page.total })}
          </p>
          <a className="kin-btn kin-btn--accent" href={pageHref(params, 0)}>
            {t("exercises.library.outOfRange.action")}
          </a>
        </div>
      ) : listResult.page.items.length === 0 ? (
        <div className="kin-card kin-card--center" data-testid="exercise-library-empty">
          <h2 className="kin-title">{t("exercises.library.empty.title")}</h2>
          <p className="kin-text kin-muted">{t("exercises.library.empty.description")}</p>
        </div>
      ) : (
        <>
          <p className="kin-text kin-muted kin-ex-count" data-testid="exercise-library-count">
            {t("exercises.library.resultCount", { total: listResult.page.total })}
          </p>

          <ul className="kin-ex-grid" data-testid="exercise-library-grid">
            {listResult.page.items.map((item) => (
              <li key={item.id}>
                <a className="kin-ex-card" href={`/exercises/${encodeURIComponent(item.id)}`}>
                  <img
                    className="kin-ex-card__media"
                    src={item.imagePath}
                    alt=""
                    loading="lazy"
                    width={180}
                    height={180}
                  />
                  <span className="kin-ex-card__body">
                    <span className="kin-ex-card__name">{item.name}</span>
                    <span className="kin-ex-card__meta">
                      {t("exercises.library.card.target")}: {taxonomyTerm(tax, item.target)}
                    </span>
                    <span className="kin-ex-card__meta">
                      {t("exercises.library.card.equipment")}: {taxonomyTerm(tax, item.equipment)}
                    </span>
                  </span>
                </a>
              </li>
            ))}
          </ul>

          {/* The API CLAMPS an over-max limit rather than rejecting it, so the
              pager steps by the window the response says was applied, never by
              the size we asked for. */}
          <nav className="kin-ex-pager" aria-label={t("exercises.title")}>
            {offset > 0 ? (
              <a
                className="kin-btn kin-btn--ghost"
                href={pageHref(params, Math.max(0, offset - listResult.page.limit))}
              >
                {t("exercises.library.previous")}
              </a>
            ) : (
              <span />
            )}

            <span className="kin-text kin-muted" data-testid="exercise-library-page-status">
              {t("exercises.library.pageStatus", {
                from: offset + 1,
                to: offset + listResult.page.items.length,
                total: listResult.page.total,
              })}
            </span>

            {offset + listResult.page.items.length < listResult.page.total ? (
              <a
                className="kin-btn kin-btn--ghost"
                href={pageHref(params, offset + listResult.page.limit)}
              >
                {t("exercises.library.next")}
              </a>
            ) : (
              <span />
            )}
          </nav>
        </>
      )}

      <ExerciseAttribution />
    </main>
  );
}
