/**
 * PlanStatusView — pure presentational component for plan status rendering.
 *
 * Renders three states driven by the `status` prop:
 *   - "generating" → OrbitProgress (indeterminate) + generating message
 *   - "ready"      → workout program detail (sessions + exercises)
 *   - "failed"     → error message + Regenerate CTA button
 *
 * This component is intentionally NOT a client component — it receives all
 * data as props. The client state management (WS subscription, local status
 * update) lives in PlanStatusClient which wraps this view.
 *
 * Exported as a named export so it can be unit-tested directly.
 */
import { OrbitProgress } from "@/components/orbit";
import type { WorkoutProgram } from "@kinora/contracts";

export interface PlanStatusViewProps {
  planId: string;
  status: string;
  program?: WorkoutProgram;
  specId?: string;
  messages?: Record<string, string>;
  onRegenerate?: () => void;
}

/**
 * Renders the appropriate plan status UI.
 *
 * Exported as a plain function (not a React component) so the React tree
 * inspection helpers in tests can operate on it without DOM/RTL overhead.
 * In production it is used as a JSX component via <PlanStatusView ... />.
 */
export function PlanStatusView({
  planId: _planId,
  status,
  program,
  messages,
  onRegenerate,
}: PlanStatusViewProps) {
  const t = (key: string, fallback: string): string =>
    messages?.[key] ?? fallback;

  if (status === "generating") {
    return (
      <main className="kin-page">
        <div className="kin-card kin-card--center">
          <OrbitProgress
            indeterminate
            size={96}
            aria-label={t("plan_generating_aria", "Generating plan")}
          />
          <h1 className="kin-title">{t("plan_generating_title", "Generating your plan…")}</h1>
          <p className="kin-text kin-muted">
            {t(
              "plan_generating_desc",
              "Your personalized workout plan is being created. This usually takes about 30 seconds.",
            )}
          </p>
        </div>
      </main>
    );
  }

  if (status === "failed") {
    return (
      <main className="kin-page">
        <div className="kin-card kin-card--center">
          <h1 className="kin-title">{t("plan_failed_title", "Plan generation failed")}</h1>
          <p className="kin-text kin-muted">
            {t(
              "plan_failed_desc",
              "Something went wrong while generating your plan. You can try again.",
            )}
          </p>
          {onRegenerate && (
            <button
              type="button"
              className="kin-btn kin-btn--primary"
              onClick={onRegenerate}
            >
              {t("plan_regenerate_cta", "Regenerate plan")}
            </button>
          )}
          {!onRegenerate && (
            <button
              type="button"
              className="kin-btn kin-btn--primary"
            >
              {t("plan_regenerate_cta", "Regenerate plan")}
            </button>
          )}
        </div>
      </main>
    );
  }

  // status === "ready"
  return (
    <main className="kin-page">
      <h1 className="kin-title">{t("plan_ready_title", "Your plan is ready")}</h1>
      {program?.weeklySessions.map((session) => (
        <section key={session.day} className="kin-card">
          <h2 className="kin-subtitle">{session.title}</h2>
          <ul>
            {session.exercises.map((exercise, idx) => (
              <li key={`${session.day}-${idx}`}>
                <strong>{exercise.name}</strong>
                {" — "}
                {exercise.sets} {t("plan_sets_label", "sets")} ×{" "}
                {exercise.reps} {t("plan_reps_label", "reps")}
                {exercise.restSeconds != null && (
                  <span>
                    {" ("}
                    {exercise.restSeconds}s {t("plan_rest_label", "rest")}
                    {")"}
                  </span>
                )}
                {exercise.substitutionNote && (
                  <em> — {exercise.substitutionNote}</em>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
      {program?.limitationWarnings && program.limitationWarnings.length > 0 && (
        <section className="kin-card kin-card--warning">
          <h3 className="kin-subtitle">
            {t("plan_limitation_warning_label", "Note")}
          </h3>
          <ul>
            {program.limitationWarnings.map((warning, idx) => (
              <li key={idx}>{warning}</li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
