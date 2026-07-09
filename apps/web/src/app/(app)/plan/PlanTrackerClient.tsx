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
import type { WorkoutProgram } from "@kinora/contracts";
import { DayDetailPanel } from "./DayDetailPanel";
import { TrackerPanel } from "./[id]/TrackerPanel";
import { useWorkoutSession } from "./use-workout-session";

export interface PlanTrackerClientProps {
  program: WorkoutProgram;
  planId: string;
  messages: Record<string, string>;
  /** Resolved plan label — shown in the identity header while a session is active. */
  planName?: string;
  /**
   * Server-rendered summary strip / warnings + plan name, shown above the day
   * grid. NOTE: `children` is HIDDEN while a session is active — the tracker
   * replaces the whole view, and the identity header re-supplies plan name + day.
   */
  children?: React.ReactNode;
}

export function PlanTrackerClient({
  program,
  planId,
  messages,
  planName,
  children,
}: PlanTrackerClientProps) {
  const {
    activeSession,
    activeDay,
    conflict,
    error,
    handleStartWorkout,
    handleRecordSet,
    handleCompleteWorkout,
  } = useWorkoutSession();

  const t = (key: string, fallback: string): string => messages[key] ?? fallback;

  // Session active → the tracker takes over the whole view (no navigation).
  // The identity header re-supplies the plan name + day, since `children`
  // (the server-rendered plan name) is hidden in this branch.
  if (activeSession) {
    const dayLabel =
      activeDay != null
        ? t("tracker_tracking_day", "Day {n}").replace("{n}", String(activeDay))
        : null;
    return (
      <div>
        {(planName || dayLabel) && (
          <header data-testid="tracker-identity">
            {planName && <h1>{planName}</h1>}
            {dayLabel && <p>{dayLabel}</p>}
          </header>
        )}
        {error && (
          <p role="alert" data-testid="tracker-error">
            {t(error, "Something went wrong. Please try again.")}
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
      {error && (
        <p role="alert" data-testid="tracker-error">
          {t(error, "Something went wrong. Please try again.")}
        </p>
      )}
      <DayDetailPanel
        sessions={program.weeklySessions}
        messages={messages}
        onStartWorkout={(day) => handleStartWorkout(planId, day)}
        conflict={conflict}
      />
    </div>
  );
}
