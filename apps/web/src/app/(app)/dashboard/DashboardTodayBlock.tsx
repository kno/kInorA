"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";

/**
 * "Bloque de hoy" — today's block exercise list.
 *
 * Presentational only — no data model yet. Built to the `.session-list`
 * block in screens/web-dashboard.html. The three exercises are static
 * catalog copy; the check buttons toggle a local completed state and raise
 * an ephemeral toast, mirroring the mockup's inline script. The real
 * session lives in the Tracker slice, not here.
 */
export function DashboardTodayBlock() {
  const t = useTranslations("dashboard");
  const [toast, setToast] = useState<string | null>(null);
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const exercises = [
    { name: t("ex1Name"), meta: t("ex1Meta"), load: t("ex1Load") },
    { name: t("ex2Name"), meta: t("ex2Meta"), load: t("ex2Load") },
    { name: t("ex3Name"), meta: t("ex3Meta"), load: t("ex3Load") },
  ];

  function flash(message: string) {
    setToast(message);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 1800);
  }

  function toggle(index: number) {
    const next = !checked[index];
    setChecked((prev) => ({ ...prev, [index]: next }));
    flash(next ? t("exerciseCompletedToast") : t("exerciseReactivatedToast"));
  }

  return (
    <article className="dash-card dash-card-pad">
      <div className="dash-section-head">
        <div>
          <div className="dash-eyebrow">{t("todayEyebrow")}</div>
          <h2 className="dash-section-title">{t("todayTitle")}</h2>
        </div>
        <span className="dash-status-chip">{t("todayDurationChip")}</span>
      </div>
      <div className="dash-session-list">
        {exercises.map((exercise, index) => {
          const isChecked = Boolean(checked[index]);
          return (
            <div className="dash-exercise-row" key={exercise.name}>
              <button
                type="button"
                className="dash-ex-check"
                aria-label={t("checkExercise", { name: exercise.name })}
                aria-checked={isChecked}
                data-checked={isChecked}
                onClick={() => toggle(index)}
              >
                {isChecked ? (
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="var(--accent-fg)"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : null}
              </button>
              <div>
                <div className="dash-ex-name" data-checked={isChecked}>
                  {exercise.name}
                </div>
                <div className="dash-ex-meta">{exercise.meta}</div>
              </div>
              <div className="dash-ex-load">{exercise.load}</div>
            </div>
          );
        })}
      </div>
      <a className="kin-btn dash-mobile-more" href="/plan">
        {t("viewAllExercises")}
      </a>
      {toast ? (
        <div className="dash-toast" role="status" aria-live="polite">
          {toast}
        </div>
      ) : null}
    </article>
  );
}

export default DashboardTodayBlock;
