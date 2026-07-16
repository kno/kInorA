"use client";

/**
 * PlanTrackerClient — inline state-swap wrapper for the `/plan` tab (#93 Slice 3).
 *
 * Mirrors the `PlanStatusClient` (`/plan/[id]`) `activeSession` state-swap, but
 * lives on `/plan` so a user reaching a ready plan through normal navigation can
 * start a specific day WITHOUT an extra route hop to `/plan/[id]` (design
 * Decision 1, option a).
 *
 * The lifecycle (start / record / complete + conflict + error handling) lives
 * in the shared `useWorkoutSession` hook, so both `/plan` and `/plan/[id]` get
 * the same fixes: no completion dead-end, no unhandled-throw crash, and a
 * plan/day identity header while a session is active.
 *
 * Data flow (proves #85 route-layer compliance):
 *   DayDetailPanel.onStartWorkout(day)
 *     → startWorkoutSessionAction(planId, day)   (reused `/plan/[id]` server action)
 *       → tracker-client → fetch(API_BASE_URL + /workout-sessions)  (server-only)
 *   The browser never sees API_BASE_URL; we reuse the existing server actions
 *   verbatim, so no new API boundary is introduced.
 *
 * The `children` slot carries the server-rendered summary strip (from
 * PlanWeekView); it is shown alongside the day grid and HIDDEN once a session
 * is active (the tracker takes over the whole view, so the identity header
 * re-supplies the plan name + day).
 */

import * as React from "react";
import { useTranslations } from "next-intl";
import type { WorkoutProgram } from "@kinora/contracts";
import { DayDetailPanel } from "./DayDetailPanel";
import { TrackerPanel } from "./[id]/TrackerPanel";
import { useWorkoutSession } from "./use-workout-session";

export interface PlanTrackerClientProps {
  program: WorkoutProgram;
  planId: string;
  /** Resolved plan label — shown in the identity header while a session is active. */
  planName?: string;
  /**
   * Server-rendered summary strip / warnings + plan name, shown above the day
   * grid. NOTE: `children` is HIDDEN while a session is active — the tracker
   * replaces the whole view, and the identity header re-supplies plan name + day.
   */
  children?: React.ReactNode;
}

/**
 * Maps the legacy `useWorkoutSession` error codes to their ICU catalog key.
 * The hook is shared with `PlanStatusClient` and predates the i18n migration;
 * translating the code here (instead of touching the hook, out of this
 * slice's scope) keeps the mapping local to each consumer.
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

export function PlanTrackerClient({
  program,
  planId,
  planName,
  children,
}: PlanTrackerClientProps) {
  const {
    activeSession,
    activeDay,
    conflict,
    error,
    syncNotice,
    handleStartWorkout,
    handleRecordSet,
    handleCompleteWorkout,
  } = useWorkoutSession();

  const t = useTranslations();
  const errorKey = error ? ERROR_KEYS[error] ?? GENERIC_ERROR_KEY : undefined;

  // Session active → the tracker takes over the whole view (no navigation).
  // The identity header re-supplies the plan name + day, since `children`
  // (the server-rendered plan name) is hidden in this branch.
  // Phase 4 web offline: surface a notice regardless of which view is
  // showing for every flush outcome that needs user awareness — a stale
  // Server Action reference (post-redeploy, "reload to sync"), a session
  // that expired mid-flush ("auth_required" — still queued, retryable), or
  // a poison-dropped mutation ("dropped" — permanently lost, MUST be
  // surfaced, never silent, Judgment Day fix #3).
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

  if (activeSession) {
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

  return (
    <div>
      {children}
      {syncNoticeBanner}
      {errorKey && (
        <p role="alert" data-testid="tracker-error">
          {t(errorKey)}
        </p>
      )}
      <DayDetailPanel
        sessions={program.weeklySessions}
        onStartWorkout={(day) => handleStartWorkout(planId, day)}
        conflict={conflict}
      />
    </div>
  );
}
