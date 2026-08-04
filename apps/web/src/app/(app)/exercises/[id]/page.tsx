import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getExerciseCatalogDetailAction } from "../actions";
import { ExerciseAttribution } from "../ExerciseAttribution";
import { ExerciseDetailTabs } from "./ExerciseDetailTabs";
import { ExerciseMediaCard } from "./ExerciseMediaCard";
import {
  taxonomyLabel,
  taxonomyList,
  taxonomyTerm,
  type TaxonomyTranslator,
} from "../taxonomy";

interface ExerciseDetailPageProps {
  params: Promise<{ id: string }>;
}

/**
 * Exercise detail — /exercises/[id]
 *
 * Server component rendering one library record per Open Design
 * `screens/web-exercise-detail.html`: a media card with a movement/position
 * toggle beside a detail card carrying the tags, name, three stats, the
 * execution/muscles tabs and the page actions.
 *
 * ADAPTED TO THE REAL DATA. The prototype invented three fields the dataset
 * does not have, and none of them are faked here:
 *  - the "level" chip and the prose "summary" are dropped (no such field);
 *  - the "work" stat (`4 × 8`) becomes the record's body part, because a
 *    catalog entry carries no prescribed set scheme;
 *  - the "coach cues" tab becomes the muscle breakdown (see
 *    `ExerciseDetailTabs`).
 * The prototype's session strip is also dropped: this route is the library,
 * not a session, and navigation already lives in the AppShell.
 *
 * Instruction steps ship in both locales; the reader's next-intl locale
 * selects one. An unknown id renders Next.js' own not-found page.
 */
export default async function ExerciseDetailPage({ params }: ExerciseDetailPageProps) {
  const { id } = await params;
  const t = await getTranslations();
  const locale = await getLocale();

  const result = await getExerciseCatalogDetailAction(id);

  if (result.kind === "not-found") {
    notFound();
  }

  if (result.kind === "error") {
    return (
      <main className="kin-page">
        <a className="kin-link" href="/exercises">
          {t("exercises.detail.backToLibrary")}
        </a>
        <div className="kin-card kin-card--warning" data-testid="exercise-detail-error">
          <h1 className="kin-title">{t("exercises.detail.error.title")}</h1>
          <p className="kin-text kin-muted">{t("exercises.detail.error.description")}</p>
        </div>
        <ExerciseAttribution />
      </main>
    );
  }

  const exercise = result.exercise;
  const steps = exercise.instructionSteps[locale === "es" ? "es" : "en"];
  // next-intl's translator types `t()` to literal message paths, which a
  // taxonomy key built from catalog data cannot satisfy — see `taxonomy.ts`.
  const tax = t as unknown as TaxonomyTranslator;

  return (
    <main className="kin-page">
      {/* Back navigation lives ONLY in the action row below, mirroring the
          prototype's two-action layout. A second standalone link at the top
          rendered the same label twice on one screen. */}
      <section className="kin-ex-hero">
        <ExerciseMediaCard
          name={exercise.name}
          imagePath={exercise.imagePath}
          gifPath={exercise.gifPath}
        />

        <article className="kin-ex-detail">
          <p className="kin-ex-eyebrow">{t("exercises.detail.eyebrow")}</p>

          <div className="kin-ex-tags">
            <span className="kin-ex-tag">{taxonomyLabel(tax, exercise.equipment)}</span>
            <span className="kin-ex-tag">{taxonomyLabel(tax, exercise.bodyPart)}</span>
            <span className="kin-ex-tag">{taxonomyLabel(tax, exercise.target)}</span>
          </div>

          <h1 className="kin-ex-name">{exercise.name}</h1>

          {/* Where the prototype had a hand-written summary paragraph. The
              dataset has no such field, so this sentence is DERIVED: the frame
              is translated and the three values are looked up in the taxonomy,
              so the ES locale reads as real Spanish rather than a Spanish
              frame around English data. Never generate exercise prose here. */}
          <p className="kin-ex-summary">
            {t("exercises.detail.summary", {
              equipment: taxonomyTerm(tax, exercise.equipment),
              target: taxonomyTerm(tax, exercise.target),
              bodyPart: taxonomyTerm(tax, exercise.bodyPart),
            })}
          </p>

          <div className="kin-ex-stats">
            <div className="kin-ex-stat">
              <span>{t("exercises.detail.stats.bodyPart")}</span>
              <strong>{taxonomyLabel(tax, exercise.bodyPart)}</strong>
            </div>
            <div className="kin-ex-stat">
              <span>{t("exercises.detail.stats.target")}</span>
              <strong>{taxonomyLabel(tax, exercise.target)}</strong>
            </div>
            <div className="kin-ex-stat">
              <span>{t("exercises.detail.stats.secondary")}</span>
              <strong>
                {exercise.secondaryMuscles.length > 0
                  ? taxonomyList(tax, exercise.secondaryMuscles)
                  : "—"}
              </strong>
            </div>
          </div>

          <ExerciseDetailTabs
            steps={steps}
            bodyPart={exercise.bodyPart}
            target={exercise.target}
            muscleGroup={exercise.muscleGroup}
            secondaryMuscles={exercise.secondaryMuscles}
          />

          <div className="kin-ex-actions">
            <a
              className="kin-btn kin-btn--accent"
              href={`/exercises?title=${encodeURIComponent(exercise.name)}`}
            >
              {t("exercises.detail.viewHistory")}
            </a>
            <a className="kin-btn kin-btn--ghost" href="/exercises">
              {t("exercises.detail.backToLibrary")}
            </a>
          </div>
        </article>
      </section>

      <p className="kin-text kin-muted kin-ex-record-attribution">{exercise.attribution}</p>

      <ExerciseAttribution />
    </main>
  );
}
