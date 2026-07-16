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
 *   3. When WS pushes "ready" but the initial render had no program (was still
 *      "generating" at SSR), calls getPlanStatusAction (a server action) to
 *      fetch the program server-side. The browser never calls the API directly.
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
import { useTranslations } from "next-intl";
import { usePlanWs } from "@/hooks/use-plan-ws";
import { getPlanStatusAction } from "./actions";
import { regeneratePlanAction } from "@/app/(app)/create-plan/actions";
import { PlanStatusView } from "./PlanStatusView";
import { TrackerPanel } from "./TrackerPanel";
import { useWorkoutSession } from "@/app/(app)/plan/use-workout-session";
import type { WorkoutProgram } from "@kinora/contracts";

export interface PlanStatusClientProps {
  planId: string;
  specId?: string;
  /** Resolved plan label — shown in the identity header while a session is active. */
  planName?: string;
  initialStatus: string;
  initialProgram?: WorkoutProgram;
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
  initialProgram,
}: PlanStatusClientProps) {
  const [program, setProgram] = useState<WorkoutProgram | undefined>(
    initialProgram,
  );
  const [regenerating, setRegenerating] = useState(false);
  // #93 Slice 3: the start/record/complete lifecycle (including the 409-conflict
  // branch, the completion-return-to-plan fix, the throw guard, and the day
  // identity) lives in the shared useWorkoutSession hook so /plan and /plan/[id]
  // stay in lockstep.
  const {
    activeSession,
    activeDay,
    conflict,
    error,
    syncNotice,
    handleStartWorkout: startWorkout,
    handleRecordSet,
    handleCompleteWorkout,
  } = useWorkoutSession();

  const t = useTranslations();
  const errorKey = error ? ERROR_KEYS[error] ?? GENERIC_ERROR_KEY : undefined;
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

  // When WS pushes "ready" but we have no program content (the page was
  // server-rendered while still "generating"), fetch the program via a server
  // action. The server action calls the API server-to-server (internal
  // API_BASE_URL) — the browser never touches the API directly.
  useEffect(() => {
    if (status === "ready" && !program) {
      void getPlanStatusAction(planId).then((result) => {
        if (result.kind === "ok" && result.plan.program) {
          setProgram(result.plan.program as WorkoutProgram);
        }
      });
    }
    // Only trigger when status changes to "ready" — program is stable once set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const handleRegenerate = useCallback(async () => {
    if (!specId) return;
    setRegenerating(true);
    try {
      // Route through a server action — the browser never calls the API directly.
      // regeneratePlanAction reads the session cookie server-side and calls
      // POST /plan-specs/:specId/regenerate via the internal API_BASE_URL.
      await regeneratePlanAction(specId);
      // Status will be pushed via WS; clear the stale program
      setProgram(undefined);
    } catch {
      // Network error — user can try again
    } finally {
      setRegenerating(false);
    }
  }, [specId]);

  // Bind the shared start handler to this plan's id (the hook is plan-agnostic).
  const handleStartWorkout = useCallback(
    (day: number) => startWorkout(planId, day),
    [startWorkout, planId],
  );

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

  // Localized conflict banner (#93 Slice 3) — reuses the plan.start.conflict*
  // keys so /plan/[id] matches /plan.
  const conflictText = (() => {
    if (!conflict) return "";
    if (!conflict.activePlanName) {
      return t("plan.start.conflict_generic");
    }
    if (conflict.activeDay == null) {
      return t("plan.start.conflict_no_day", { plan: conflict.activePlanName });
    }
    return t("plan.start.conflict", { plan: conflict.activePlanName, n: conflict.activeDay });
  })();

  return (
    <>
      {conflict && (
        <p role="alert" data-testid="start-conflict">
          {conflictText}
        </p>
      )}
      {syncNoticeBanner}
      {errorKey && (
        <p role="alert" data-testid="tracker-error">
          {t(errorKey)}
        </p>
      )}
      <PlanStatusView
        planId={planId}
        status={regenerating ? "generating" : status}
        program={program}
        specId={specId}
        onRegenerate={handleRegenerate}
        onStartWorkout={handleStartWorkout}
      />
    </>
  );
}
