"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";

/**
 * Coach AI card — presentational only, no data model yet.
 *
 * Built to the `.coach-card` block in screens/web-dashboard.html. The copy
 * is static (sourced from the i18n catalog); "Apply advice" swaps the body
 * text and raises an ephemeral toast, mirroring the mockup's inline script.
 * There is no coaching engine behind this yet.
 */
export function DashboardCoachCard() {
  const t = useTranslations("dashboard");
  const [applied, setApplied] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  function flash(message: string) {
    setToast(message);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 1800);
  }

  return (
    <article className="dash-card dash-coach-card">
      <div className="dash-coach-main">
        <div className="dash-coach-avatar" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.9">
            <path d="M12 3v3M5.6 5.6l2.1 2.1M3 12h3M18 12h3M16.3 7.7l2.1-2.1" />
            <path d="M8 14a4 4 0 0 0 8 0c0-2.2-1.8-4-4-4s-4 1.8-4 4z" />
            <path d="M9 19h6" />
          </svg>
        </div>
        <div>
          <div className="dash-eyebrow">{t("coachEyebrow")}</div>
          <h2 className="dash-coach-title">{t("coachTitle")}</h2>
        </div>
        <p className="dash-coach-text">{applied ? t("coachApplied") : t("coachText")}</p>
        <div className="dash-coach-actions">
          <button
            type="button"
            className="kin-btn kin-btn--accent"
            onClick={() => {
              setApplied(true);
              flash(t("coachAppliedToast"));
            }}
          >
            {t("coachApply")}
          </button>
          <button type="button" className="kin-btn" onClick={() => flash(t("coachDismissedToast"))}>
            {t("coachDismiss")}
          </button>
        </div>
      </div>
      {toast ? (
        <div className="dash-toast" role="status" aria-live="polite">
          {toast}
        </div>
      ) : null}
    </article>
  );
}

export default DashboardCoachCard;
