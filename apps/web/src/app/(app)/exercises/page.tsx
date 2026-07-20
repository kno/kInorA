import { getTranslations } from "next-intl/server";
import { getExerciseDetailAction } from "./actions";

interface ExercisesPageProps {
  /**
   * `?title=` selects an exercise for the read-only recent-history reference
   * (09c-v1-progress-dashboard-stats, Slice 4b). Optional — absent falls
   * back to the plain scaffold with no history section.
   */
  searchParams?: Promise<{ title?: string }>;
}

/**
 * Exercises — protected page rendered inside the AppShell.
 *
 * Ships the library scaffold plus, when `?title=` selects a previously-
 * performed exercise, a read-only recent-history reference (Slice 4b,
 * design.md "Exercise detail"). The section is a purely additive block: it
 * is entirely omitted when there is no history, never a live-tracking
 * substitute (spec.md "Exercise Detail Progress References").
 *
 * User-facing copy comes from next-intl (see `@/i18n/request`), whose
 * locale is resolved from the `?lang=` query parameter (via the
 * `x-kinora-lang` header injected by `proxy.ts`) or the `Accept-Language`
 * header.
 */
export default async function ExercisesPage({ searchParams }: ExercisesPageProps) {
  const t = await getTranslations();
  const title = (await searchParams)?.title;

  const detailResult = title ? await getExerciseDetailAction(title) : undefined;
  const recentSets = detailResult?.kind === "ok" ? detailResult.detail.recentSets : [];

  return (
    <main className="kin-page">
      <div className="kin-card kin-card--center">
        <h1 className="kin-title">{t("exercises.title")}</h1>
        <p className="kin-text kin-muted">{t("exercises.description")}</p>
      </div>

      {recentSets.length > 0 && (
        <div className="kin-card" data-testid="exercise-history">
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
    </main>
  );
}
