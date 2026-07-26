"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { AdaptationRecommendation } from "@kinora/contracts";

/**
 * Result of accepting an adherence adaptation. Mirrors the `regeneratePlan`
 * client result so the banner can surface an inline error (quota exhausted, 409,
 * network) while leaving the plan unchanged.
 */
export type AdaptAcceptResult = { kind: "ok" } | { kind: "error"; message: string };

interface DashboardCoachCardProps {
  /**
   * 14a-v1.1 adherence adaptation recommendation from the dashboard read. The
   * suggestion banner renders ONLY when `level === "low"` with a
   * `suggestedChange`; otherwise the static coach card is shown. `ok` /
   * `insufficient_data` never render a banner.
   */
  adaptation?: AdaptationRecommendation;
  /**
   * Accept handler — a server action that POSTs `{}` to
   * `/plan-specs/:planSpecId/adapt`. The banner sends only the spec id; the
   * target frequency is re-derived server-side. Omitted in the static fallback.
   */
  onAccept?: (planSpecId: string) => Promise<AdaptAcceptResult>;
}

/**
 * Coach AI card.
 *
 * 14a-v1.1 Slice B1: when the dashboard read returns a `low` adherence
 * adaptation with a frequency-reduction `suggestedChange`, this renders an
 * option-framed suggestion banner (accept + dismiss). Accept confirms via the
 * server action (the ONLY path that regenerates — no auto-apply); dismiss is a
 * pure no-op that leaves the plan unchanged. A failed accept surfaces an inline
 * error and keeps the retry affordance. Everything else falls back to the
 * original static coach card (fuller state/i18n polish is B2).
 */
export function DashboardCoachCard({ adaptation, onAccept }: DashboardCoachCardProps = {}) {
  const change = adaptation?.suggestedChange;
  const showBanner =
    adaptation?.level === "low" &&
    change?.kind === "reduce_frequency" &&
    typeof adaptation.planSpecId === "string";

  if (showBanner && change && adaptation?.planSpecId) {
    return (
      <AdaptationBanner
        planSpecId={adaptation.planSpecId}
        fromDays={change.fromDays}
        toDays={change.toDays}
        onAccept={onAccept}
      />
    );
  }

  return <StaticCoachCard />;
}

interface AdaptationBannerProps {
  planSpecId: string;
  fromDays: number;
  toDays: number;
  onAccept?: (planSpecId: string) => Promise<AdaptAcceptResult>;
}

function AdaptationBanner({ planSpecId, fromDays, toDays, onAccept }: AdaptationBannerProps) {
  const t = useTranslations("adaptation");
  const [state, setState] = useState<"idle" | "submitting" | "regenerating" | "error">("idle");
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  // Review fix (B1 4R reliability WARNING): guard + disable while a request is
  // in flight so a rapid double-click fires only ONE accept — otherwise a
  // second click starts a second generation (and, per the API-side fresh-nonce
  // fix, consumes a second quota unit) before the first request settles.
  const isSubmitting = state === "submitting";

  async function handleAccept() {
    if (!onAccept || isSubmitting) return;
    setState("submitting");
    const result = await onAccept(planSpecId);
    // A failed accept (quota exhausted, 409, network) leaves the plan unchanged;
    // surface the error inline and keep the accept action for a retry.
    setState(result.kind === "ok" ? "regenerating" : "error");
  }

  if (state === "regenerating") {
    return (
      <article className="dash-card dash-coach-card" aria-live="polite">
        <p className="dash-coach-text">{t("regenerating")}</p>
      </article>
    );
  }

  return (
    <article className="dash-card dash-coach-card">
      <div className="dash-coach-main">
        <div className="dash-eyebrow">{t("title")}</div>
        <p className="dash-coach-text">{t("suggestion", { fromDays, toDays })}</p>
        <div className="dash-coach-actions">
          <button
            type="button"
            className="kin-btn kin-btn--accent"
            onClick={handleAccept}
            disabled={isSubmitting}
          >
            {t("accept", { toDays })}
          </button>
          <button
            type="button"
            className="kin-btn"
            onClick={() => setDismissed(true)}
            disabled={isSubmitting}
          >
            {t("dismiss")}
          </button>
        </div>
        {state === "error" ? (
          <p className="dash-coach-error" role="alert">
            {t("error")}
          </p>
        ) : null}
      </div>
    </article>
  );
}

/**
 * Static presentational coach card — the pre-14a mock copy. Rendered whenever
 * there is no actionable `low` adaptation. "Apply advice" swaps the body text
 * and raises an ephemeral toast (no coaching engine behind it yet).
 */
function StaticCoachCard() {
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
