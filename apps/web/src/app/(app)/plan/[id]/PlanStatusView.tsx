/**
 * PlanStatusView — pure presentational component for plan status rendering.
 *
 * Renders four states driven by the `status` prop:
 *   - "generating" → OrbitProgress (indeterminate) + generating message
 *   - "ready"      → workout program detail (sessions + exercises)
 *   - "failed"     → error message + Regenerate CTA button
 *   - "error"      → connection-error message + Retry CTA (issue #42): the
 *     realtime channel could neither connect nor poll, so we fail LOUD instead
 *     of leaving the user on an eternal spinner.
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
  onStartWorkout?: (day: number) => void;
}

export function PlanStatusView({
  planId: _planId,
  status,
  program,
  messages,
  onRegenerate,
  onStartWorkout,
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
          {/* Fix F: onRegenerate is always provided; removed dead handler-less fallback button */}
          <button
            type="button"
            className="kin-btn kin-btn--primary"
            onClick={onRegenerate}
          >
            {t("plan_regenerate_cta", "Regenerate plan")}
          </button>
        </div>
      </main>
    );
  }

  if (status === "error") {
    return (
      <main className="kin-page">
        <div className="kin-card kin-card--center">
          <h1 className="kin-title">
            {t("plan_error_title", "Connection problem")}
          </h1>
          <p className="kin-text kin-muted">
            {t(
              "plan_error_desc",
              "We lost the live connection and could not fetch your plan status. Check your connection or sign in again, then retry.",
            )}
          </p>
          {onRegenerate && (
            <button
              type="button"
              className="kin-btn kin-btn--primary"
              onClick={onRegenerate}
            >
              {t("plan_error_retry_cta", "Retry")}
            </button>
          )}
        </div>
      </main>
    );
  }

  // status === "ready"
  return (
    <main className="kin-page">
      <header className="kin-card kin-card--header">
        <h1 className="kin-title">{t("plan_ready_title", "Your plan is ready")}</h1>
        <a href="/dashboard" className="kin-link">
          {t("plan_back_to_dashboard", "Back to dashboard")}
        </a>
      </header>
      {program?.weeklySessions.map((session) => (
        <section key={session.day} className="kin-card">
          <h2 className="kin-subtitle">
            {t("plan_session_day", "Day")} {session.day} — {session.title}
          </h2>
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
          {onStartWorkout && (
            <button
              type="button"
              className="kin-btn kin-btn--primary"
              onClick={() => onStartWorkout(session.day)}
            >
              {t("tracker_start_cta", "Start workout")}
            </button>
          )}
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
