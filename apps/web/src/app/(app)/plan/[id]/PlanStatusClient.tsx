"use client";

/**
 * PlanStatusClient — client component that wires the WS subscription.
 *
 * Wraps PlanStatusView and:
 *   1. Subscribes to wss://.../ws/plans via usePlanWs. Authentication uses the
 *      same-origin, httpOnly kinora_session cookie the browser auto-sends on
 *      the WS upgrade — NO session token is passed to client JS or placed in
 *      the WS URL (issue #42). The server (routes/ws.ts) reads the cookie.
 *   2. Merges WS-pushed status with the server-fetched initial status.
 *   3. When the plan resolves to "ready" and there is NO active workout
 *      session, redirects the browser to the canonical `/plan?planId=<id>`
 *      page (PlanWeekView) via `router.replace`. The legacy in-page program
 *      list is gone — the canonical page owns the ready rendering and the
 *      workout-start path. `replace` (not `push`) keeps the intermediate
 *      `/plan/[id]` screen out of the Back-button history.
 *   4. Handles the "Regenerate" button via regeneratePlanAction (a server
 *      action in create-plan/actions.ts) — the browser never fetches the API.
 *
 * Security (issue #42): this component no longer receives the session token.
 * The httpOnly cookie stays httpOnly; nothing leaks into the RSC payload or the
 * WS URL. In cross-origin local dev (web:3000 / api:4000) the cookie is not
 * sent on the WS upgrade, so usePlanWs falls back to polling — an accepted
 * tradeoff. Prod proxies the API same-origin so the cookie path works.
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { usePlanWs } from "@/hooks/use-plan-ws";
import { regeneratePlanAction } from "@/app/(app)/create-plan/actions";
import { PlanStatusView } from "./PlanStatusView";
import { TrackerPanel } from "./TrackerPanel";
import { useWorkoutSession } from "@/app/(app)/plan/use-workout-session";

export interface PlanStatusClientProps {
  planId: string;
  specId?: string;
  /** Resolved plan label — shown in the identity header while a session is active. */
  planName?: string;
  initialStatus: string;
}

/**
 * Maps the legacy `useWorkoutSession` error codes to their ICU catalog key.
 * Mirrors the same mapping in `PlanTrackerClient` (the hook is shared but out
 * of this slice's migration scope).
 *
 * Any code NOT in this map (unknown/future codes) falls back to
 * `GENERIC_ERROR_KEY`, NOT to a specific start/record/complete message —
 * mislabeling an unrelated error as "couldn't start the session" would be a
 * user-facing regression.
 */
const GENERIC_ERROR_KEY = "tracker.error.generic";

const ERROR_KEYS: Record<string, string> = {
  tracker_error_start: "tracker.error.start",
  tracker_error_record: "tracker.error.record",
  tracker_error_complete: "tracker.error.complete",
};

export function PlanStatusClient({
  planId,
  specId,
  planName,
  initialStatus,
}: PlanStatusClientProps) {
  const [regenerating, setRegenerating] = useState(false);
  // A failed regenerate must never look like a no-op button — surfaced with
  // the same generic action-failure copy mobile's PlanStatusScreen already
  // uses for its own failed regenerate/adapt calls (`planStatus.error`).
  const [regenerateFailed, setRegenerateFailed] = useState(false);
  // #93 Slice 3: the start/record/complete lifecycle (including the 409-conflict
  // branch, the completion-return-to-plan fix, the throw guard, and the day
  // identity) lives in the shared useWorkoutSession hook so /plan and /plan/[id]
  // stay in lockstep.
  const {
    activeSession,
    activeDay,
    conflict,
    autoCloseNotice,
    discardFailed,
    error,
    syncNotice,
    handleRecordSet,
    handleCompleteWorkout,
    handleDiscardSession,
    handleResumeSession,
  } = useWorkoutSession();

  const router = useRouter();
  const t = useTranslations();
  const errorKey = error ? ERROR_KEYS[error] ?? GENERIC_ERROR_KEY : undefined;
  // 17b scope A: one required confirmation step before Discard takes effect.
  const [discardConfirming, setDiscardConfirming] = useState(false);
  // 17b scope A: the mirror image of the conflict banner — non-blocking,
  // role="status" (polite), never takes focus.
  const autoCloseNoticeBanner = autoCloseNotice && (
    <p role="status" data-testid="auto-close-notice">
      {t("plan.start.autoClosed", { date: new Date(autoCloseNotice.startedAt) })}
    </p>
  );
  // Phase 4 web offline: surface a notice regardless of which view is
  // showing for every flush outcome that needs user awareness — a stale
  // Server Action reference (post-redeploy, "reload to sync"), a session
  // that expired mid-flush ("auth_required" — still queued, retryable), or
  // a poison-dropped mutation ("dropped" — permanently lost, MUST be
  // surfaced, never silent, Judgment Day fix #3). Mirrors PlanTrackerClient.
  const syncNoticeKey =
    syncNotice === "reload_required"
      ? "tracker.sync.reload_required"
      : syncNotice === "auth_required"
        ? "tracker.sync.auth_required"
        : syncNotice === "dropped"
          ? "tracker.sync.dropped"
          : undefined;
  const syncNoticeBanner = syncNoticeKey && (
    <p role="status" data-testid="tracker-sync-notice">
      {t(syncNoticeKey)}
    </p>
  );

  // usePlanWs opens the WebSocket and updates status on push messages.
  // Falls back to polling GET /workout-plans/:id if the WS connect fails.
  // Issue #42: no token is passed — the browser authenticates the WS upgrade
  // via the same-origin, httpOnly kinora_session cookie, so the token never
  // touches client JS or the WS URL.
  const { status } = usePlanWs(planId, {
    initialStatus,
  });

  // Post-generation navigation: once the plan is "ready", hand off to the
  // canonical `/plan` page (PlanWeekView), which renders the polished week
  // view AND owns the workout-start path. We use `router.replace` (not
  // `push`) so the Back button does not return to this intermediate
  // `/plan/[id]` screen.
  //
  // Guard: never redirect while a workout session is active — that would yank
  // the user out of the live tracker. No redirect loop is possible: the
  // canonical `/plan` page renders a `ready` plan inline and only redirects a
  // `generating` plan back to `/plan/[id]`, so a `ready` → `/plan` hop settles.
  useEffect(() => {
    if (status === "ready" && !activeSession) {
      router.replace(`/plan?planId=${planId}`);
    }
  }, [status, activeSession, planId, router]);

  const handleRegenerate = useCallback(async () => {
    if (!specId) return;
    setRegenerating(true);
    setRegenerateFailed(false);
    try {
      // Route through a server action — the browser never calls the API directly.
      // regeneratePlanAction reads the session cookie server-side and calls
      // POST /plan-specs/:specId/regenerate via the internal API_BASE_URL.
      await regeneratePlanAction(specId);
      // Status will be pushed via WS; the ready redirect then takes over.
    } catch {
      // Network/server error — surface it instead of silently no-op'ing;
      // the user needs to be able to tell "it failed" from "nothing happened".
      setRegenerateFailed(true);
    } finally {
      setRegenerating(false);
    }
  }, [specId]);

  if (activeSession) {
    // The tracker takes over the whole view. Re-supply the plan name + day
    // identity above it, and surface any non-conflict action error inline.
    const dayLabel = activeDay != null ? t("tracker.tracking.day", { n: activeDay }) : null;
    return (
      <div>
        {(planName || dayLabel) && (
          <header data-testid="tracker-identity">
            {planName && <h1>{planName}</h1>}
            {dayLabel && <p>{dayLabel}</p>}
          </header>
        )}
        {autoCloseNoticeBanner}
        {syncNoticeBanner}
        {errorKey && (
          <p role="alert" data-testid="tracker-error">
            {t(errorKey)}
          </p>
        )}
        <TrackerPanel
          session={activeSession}
          onRecordSet={handleRecordSet}
          onCompleteSession={handleCompleteWorkout}
        />
      </div>
    );
  }

  // Localized conflict banner (#93 Slice 3; actionable since 17b scope A) —
  // reuses the plan.start.conflict* keys so /plan/[id] matches /plan. No
  // focus management here (out of scope by design — this banner already
  // renders first in the returned fragment, already above the fold).
  const conflictText = (() => {
    if (!conflict) return "";
    const parsed = new Date(conflict.activeStartedAt);
    const date = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
    if (!conflict.activePlanName) {
      return t("plan.start.conflict_generic", { date });
    }
    if (conflict.activeDay == null) {
      return t("plan.start.conflict_no_day", { plan: conflict.activePlanName, date });
    }
    return t("plan.start.conflict", { plan: conflict.activePlanName, n: conflict.activeDay, date });
  })();

  function handleDiscardConfirmYes(): void {
    setDiscardConfirming(false);
    handleDiscardSession();
  }

  return (
    <>
      {conflict && (
        <div role="alert" data-testid="start-conflict">
          <p>{conflictText}</p>
          <div>
            <button
              type="button"
              className="kin-btn kin-btn--secondary"
              onClick={() => handleResumeSession(conflict.activeSessionId)}
            >
              {t("plan.start.resume")}
            </button>
            {!discardConfirming && (
              <button
                type="button"
                className="kin-btn kin-btn--secondary"
                onClick={() => setDiscardConfirming(true)}
              >
                {t("plan.start.discard")}
              </button>
            )}
          </div>
          {discardConfirming && (
            <div>
              <p>{t("plan.start.discardConfirm")}</p>
              <button type="button" className="kin-btn kin-btn--primary" onClick={handleDiscardConfirmYes}>
                {t("plan.start.discardConfirmYes")}
              </button>
              <button
                type="button"
                className="kin-btn kin-btn--secondary"
                onClick={() => setDiscardConfirming(false)}
              >
                {t("plan.start.discardCancel")}
              </button>
            </div>
          )}
          {discardFailed && <p role="status">{t("plan.start.discardFailed")}</p>}
        </div>
      )}
      {syncNoticeBanner}
      {errorKey && (
        <p role="alert" data-testid="tracker-error">
          {t(errorKey)}
        </p>
      )}
      {regenerateFailed && (
        <p role="alert" data-testid="regenerate-error">
          {t("planStatus.error")}
        </p>
      )}
      <PlanStatusView
        planId={planId}
        status={regenerating ? "generating" : status}
        specId={specId}
        onRegenerate={handleRegenerate}
      />
    </>
  );
}
