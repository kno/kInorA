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
  const showBanner = adaptation?.level === "low" && typeof adaptation.planSpecId === "string";

  if (showBanner && change?.kind === "reduce_frequency" && adaptation?.planSpecId) {
    return (
      <FrequencyAdaptationBanner
        planSpecId={adaptation.planSpecId}
        fromDays={change.fromDays}
        toDays={change.toDays}
        onAccept={onAccept}
      />
    );
  }

  if (showBanner && change?.kind === "adjust_load" && adaptation?.planSpecId) {
    return (
      <LoadAdaptationBanner
        planSpecId={adaptation.planSpecId}
        direction={change.direction}
        onAccept={onAccept}
      />
    );
  }

  return <StaticCoachCard />;
}

interface FrequencyAdaptationBannerProps {
  planSpecId: string;
  fromDays: number;
  toDays: number;
  onAccept?: (planSpecId: string) => Promise<AdaptAcceptResult>;
}

/**
 * Map an accept failure code (from `adaptPlan`/`adaptPlanAction`) to a distinct,
 * coaching-tone i18n key. B2 surfaces three shapes:
 * - `403` quota/allocation exhausted → "you've used your plan change / upgrade";
 * - `409` `no_adaptation` (recommendation went stale, plan already fine) →
 *   "your plan already looks like a good fit";
 * - anything else (network, unknown API error) → the generic retry error.
 */
function errorCopyKey(message: string): "quotaExhausted" | "upToDate" | "error" {
  if (message === "tenant_quota_exhausted" || message === "member_allocation_exhausted") {
    return "quotaExhausted";
  }
  if (message === "no_adaptation") {
    return "upToDate";
  }
  return "error";
}

type BannerState =
  | { phase: "idle" }
  | { phase: "submitting" }
  | { phase: "regenerating" }
  | { phase: "error"; message: string };

function FrequencyAdaptationBanner({
  planSpecId,
  fromDays,
  toDays,
  onAccept,
}: FrequencyAdaptationBannerProps) {
  const t = useTranslations("adaptation");
  return (
    <AdaptationBannerShell
      planSpecId={planSpecId}
      onAccept={onAccept}
      title={t("title")}
      body={t("suggestion", { fromDays, toDays })}
      acceptLabel={t("accept", { toDays })}
    />
  );
}

interface LoadAdaptationBannerProps {
  planSpecId: string;
  direction: "increase" | "decrease";
  onAccept?: (planSpecId: string) => Promise<AdaptAcceptResult>;
}

/**
 * RPE-driven `adjust_load` variant of the adaptation banner (14b-v1.1 Slice
 * B). Same accept/dismiss/error state machine as the frequency banner — only
 * the copy differs (no from/to day counts here, since `intensityBias` steps
 * one rung on a `reduce < maintain < increase` ladder rather than a numeric
 * day count).
 */
function LoadAdaptationBanner({ planSpecId, direction, onAccept }: LoadAdaptationBannerProps) {
  const t = useTranslations("adaptation");
  const isDecrease = direction === "decrease";
  return (
    <AdaptationBannerShell
      planSpecId={planSpecId}
      onAccept={onAccept}
      title={t("rpe.title")}
      body={t(isDecrease ? "rpe.reduceLoad" : "rpe.increaseLoad")}
      acceptLabel={t(isDecrease ? "rpe.acceptReduce" : "rpe.acceptIncrease")}
    />
  );
}

interface AdaptationBannerShellProps {
  planSpecId: string;
  title: string;
  body: string;
  acceptLabel: string;
  onAccept?: (planSpecId: string) => Promise<AdaptAcceptResult>;
}

/** Shared accept/dismiss/error/regenerating state machine for BOTH adaptation banner kinds. */
function AdaptationBannerShell({
  planSpecId,
  title,
  body,
  acceptLabel,
  onAccept,
}: AdaptationBannerShellProps) {
  const t = useTranslations("adaptation");
  const [state, setState] = useState<BannerState>({ phase: "idle" });
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  // Review fix (B1 4R reliability WARNING): guard + disable while a request is
  // in flight so a rapid double-click fires only ONE accept — otherwise a
  // second click starts a second generation (and, per the API-side fresh-nonce
  // fix, consumes a second quota unit) before the first request settles.
  const isSubmitting = state.phase === "submitting";

  async function handleAccept() {
    if (!onAccept || isSubmitting) return;
    setState({ phase: "submitting" });
    const result = await onAccept(planSpecId);
    // A failed accept (quota exhausted, 409 stale, network) leaves the plan
    // unchanged; surface the mapped error inline and keep the accept action so
    // the user can retry.
    setState(
      result.kind === "ok"
        ? { phase: "regenerating" }
        : { phase: "error", message: result.message },
    );
  }

  if (state.phase === "regenerating") {
    return (
      <article className="dash-card dash-coach-card" aria-live="polite">
        <p className="dash-coach-text">{t("regenerating")}</p>
      </article>
    );
  }

  return (
    <article className="dash-card dash-coach-card">
      <div className="dash-coach-main">
        <div className="dash-eyebrow">{title}</div>
        <p className="dash-coach-text">{body}</p>
        <div className="dash-coach-actions">
          <button
            type="button"
            className="kin-btn kin-btn--accent"
            onClick={handleAccept}
            disabled={isSubmitting}
          >
            {acceptLabel}
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
        {isSubmitting ? (
          <p className="dash-coach-text" aria-live="polite">
            {t("submitting")}
          </p>
        ) : null}
        {state.phase === "error" ? (
          <p className="dash-coach-error" role="alert">
            {t(errorCopyKey(state.message))}
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
