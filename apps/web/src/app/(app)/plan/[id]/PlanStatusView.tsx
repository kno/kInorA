"use client";

/**
 * PlanStatusView — presentational component for plan status rendering.
 *
 * Renders four states driven by the `status` prop:
 *   - "generating" → OrbitProgress (indeterminate) + generating message
 *   - "ready"      → workout program detail (sessions + exercises)
 *   - "failed"     → error message + Regenerate CTA button
 *   - "error"      → connection-error message + Retry CTA (issue #42): the
 *     realtime channel could neither connect nor poll, so we fail LOUD instead
 *     of leaving the user on an eternal spinner.
 *
 * All data is received as props; the client state management (WS
 * subscription, local status update) lives in PlanStatusClient which wraps
 * this view. It is a client component (not a server component) because it
 * calls `useTranslations` and is rendered by the client-side PlanStatusClient
 * tree, not directly by a server page.
 *
 * Exported as a named export so it can be unit-tested directly.
 */
import { useTranslations } from "next-intl";
import { OrbitProgress } from "@/components/orbit";
import type { WorkoutProgram } from "@kinora/contracts";

export interface PlanStatusViewProps {
  planId: string;
  status: string;
  program?: WorkoutProgram;
  specId?: string;
  onRegenerate?: () => void;
  onStartWorkout?: (day: number) => void;
}

export function PlanStatusView({
  planId: _planId,
  status,
  program,
  onRegenerate,
  onStartWorkout,
}: PlanStatusViewProps) {
  const t = useTranslations();

  if (status === "generating") {
    return (
      <main className="kin-page">
        <div className="kin-card kin-card--center">
          <OrbitProgress indeterminate size={96} aria-label={t("plan.generating.aria")} />
          <h1 className="kin-title">{t("plan.generating.title")}</h1>
          <p className="kin-text kin-muted">{t("plan.generating.desc")}</p>
        </div>
      </main>
    );
  }

  if (status === "failed") {
    return (
      <main className="kin-page">
        <div className="kin-card kin-card--center">
          <h1 className="kin-title">{t("plan.failed.title")}</h1>
          <p className="kin-text kin-muted">{t("plan.failed.desc")}</p>
          {/* Fix F: onRegenerate is always provided; removed dead handler-less fallback button */}
          <button
            type="button"
            className="kin-btn kin-btn--primary"
            onClick={onRegenerate}
          >
            {t("plan.regenerate.cta")}
          </button>
        </div>
      </main>
    );
  }

  if (status === "error") {
    return (
      <main className="kin-page">
        <div className="kin-card kin-card--center">
          <h1 className="kin-title">{t("plan.error.title")}</h1>
          <p className="kin-text kin-muted">{t("plan.error.desc")}</p>
          {onRegenerate && (
            <button
              type="button"
              className="kin-btn kin-btn--primary"
              onClick={onRegenerate}
            >
              {t("plan.error.retryCta")}
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
        <h1 className="kin-title">{t("plan.ready.title")}</h1>
        <a href="/dashboard" className="kin-link">
          {t("plan.backToDashboard")}
        </a>
      </header>
      {program?.weeklySessions.map((session) => (
        <section key={session.day} className="kin-card">
          <h2 className="kin-subtitle">
            {t("plan.session.day")} {session.day} — {session.title}
          </h2>
          <ul>
            {session.exercises.map((exercise, idx) => (
              <li key={`${session.day}-${idx}`}>
                <strong>{exercise.name}</strong>
                {" — "}
                {exercise.sets} {t("plan.sets.label")} ×{" "}
                {exercise.reps} {t("plan.reps.label")}
                {exercise.restSeconds != null && (
                  <span>
                    {" ("}
                    {exercise.restSeconds}s {t("plan.rest.label")}
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
              {t("tracker.start.cta")}
            </button>
          )}
        </section>
      ))}
      {program?.limitationWarnings && program.limitationWarnings.length > 0 && (
        <section className="kin-card kin-card--warning">
          <h3 className="kin-subtitle">{t("plan.limitation.warningLabel")}</h3>
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
