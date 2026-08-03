"use client";

/**
 * PlanStatusView — presentational component for plan status rendering.
 *
 * Renders the transient/terminal states driven by the `status` prop:
 *   - "generating" → OrbitProgress (indeterminate) + generating message
 *   - "failed"     → error message + Regenerate CTA button
 *   - "error"      → connection-error message + Retry CTA (issue #42): the
 *     realtime channel could neither connect nor poll, so we fail LOUD instead
 *     of leaving the user on an eternal spinner.
 *
 * There is intentionally NO "ready" rendering here: once a plan becomes ready,
 * PlanStatusClient redirects the browser to the canonical `/plan` page (which
 * renders the polished PlanWeekView + the workout-start path). This component
 * therefore renders `null` for the "ready" status — the redirect takes over.
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

export interface PlanStatusViewProps {
  planId: string;
  status: string;
  specId?: string;
  onRegenerate?: () => void;
}

export function PlanStatusView({
  status,
  onRegenerate,
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

  // status === "ready": nothing to render — PlanStatusClient redirects to the
  // canonical `/plan` page (PlanWeekView), which owns the ready rendering and
  // the workout-start path. Rendering null avoids a flash of the legacy list
  // during the redirect tick.
  return null;
}
