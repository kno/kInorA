"use client";

/**
 * useWorkoutSession — shared inline-tracker state machine (#93 Slice 3).
 *
 * Both `PlanTrackerClient` (the `/plan` tab) and `PlanStatusClient`
 * (`/plan/[id]`) drive the SAME start/record/complete lifecycle against the
 * reused `/plan/[id]` server actions. This hook is the single source of truth
 * for that lifecycle so the three review-flagged bugs are fixed ONCE:
 *
 *   1. Completion dead-end — after `completeWorkoutSessionAction` returns a
 *      `completed` session there is no navigation escape on `/plan` (the tracker
 *      is a full state-swap). We clear `activeSession` on a successful complete
 *      so the plan/day view returns; the completed session is persisted
 *      server-side, so nothing is lost.
 *   2. Unhandled throw — `startWorkoutSessionAction` /
 *      `recordWorkoutSetAction` / `completeWorkoutSessionAction` THROW on
 *      non-conflict failures (network / not_found / invalid_response). Awaiting
 *      them without a guard surfaces as an unhandled rejection that crashes the
 *      render. Every handler is wrapped in try/catch and stores an `error`
 *      string the consumer renders as an inline `role="alert"`.
 *   3. Plan/day identity — the started session's `day` is captured in
 *      `activeDay` so the consumer can render "which plan / Day N" above the
 *      tracker (the server-rendered plan name is dropped once the tracker
 *      takes over).
 *
 * A 409 `active_session_conflict` is a NORMAL branch, not an error: the start
 * action returns `{ kind: "conflict", ... }`, which we store in `conflict`.
 */

import { useCallback, useState } from "react";
import type { WorkoutSessionRecord } from "@kinora/contracts";
import {
  completeWorkoutSessionAction,
  recordWorkoutSetAction,
  startWorkoutSessionAction,
} from "./[id]/actions";
import type { WorkoutSetUpdateInput } from "./[id]/tracker-types";

export interface WorkoutSessionConflict {
  activePlanName?: string;
  /** Normalized to `null` (never `undefined`) so the banner branch is total. */
  activeDay: number | null;
}

export interface UseWorkoutSessionResult {
  /** The in-progress session, or `undefined` when the plan/day view is shown. */
  activeSession: WorkoutSessionRecord | undefined;
  /** The day the active session was started for (identity header). */
  activeDay: number | undefined;
  /** Set when a start attempt returns a 409 conflict (structural, not an error). */
  conflict: WorkoutSessionConflict | undefined;
  /** Non-conflict failure message key (network / not_found / invalid_response). */
  error: string | undefined;
  handleStartWorkout: (planId: string, day: number) => Promise<void>;
  handleRecordSet: (setId: string, input: WorkoutSetUpdateInput) => Promise<void>;
  handleCompleteWorkout: (sessionId: string) => Promise<void>;
}

export function useWorkoutSession(): UseWorkoutSessionResult {
  const [activeSession, setActiveSession] = useState<
    WorkoutSessionRecord | undefined
  >();
  const [activeDay, setActiveDay] = useState<number | undefined>();
  const [conflict, setConflict] = useState<WorkoutSessionConflict | undefined>();
  const [error, setError] = useState<string | undefined>();

  const handleStartWorkout = useCallback(async (planId: string, day: number) => {
    try {
      const result = await startWorkoutSessionAction(planId, day);
      // A 409 conflict is a structural branch — set state, never throw/crash.
      if (result.kind === "conflict") {
        setConflict({
          activePlanName: result.activePlanName,
          activeDay: result.activeDay ?? null,
        });
        return;
      }
      // Successful start clears any prior conflict/error so a retry on another
      // day starts clean.
      setConflict(undefined);
      setError(undefined);
      setActiveDay(result.session.day ?? day);
      setActiveSession(result.session);
    } catch {
      // Non-conflict failures throw (network / not_found / invalid_response).
      // Surface them inline instead of crashing the render.
      setError("tracker_error_start");
    }
  }, []);

  const handleRecordSet = useCallback(
    async (setId: string, input: WorkoutSetUpdateInput) => {
      if (!activeSession) return;
      try {
        const session = await recordWorkoutSetAction(activeSession.id, setId, input);
        setError(undefined);
        setActiveSession(session);
      } catch {
        setError("tracker_error_record");
      }
    },
    [activeSession],
  );

  const handleCompleteWorkout = useCallback(async (sessionId: string) => {
    try {
      // The completed session is persisted server-side; we do not keep it in
      // state, otherwise the tracker would render forever with no way back to
      // the plan view (there is no navigation escape on /plan).
      await completeWorkoutSessionAction(sessionId);
      setError(undefined);
      setActiveDay(undefined);
      setActiveSession(undefined);
    } catch {
      setError("tracker_error_complete");
    }
  }, []);

  return {
    activeSession,
    activeDay,
    conflict,
    error,
    handleStartWorkout,
    handleRecordSet,
    handleCompleteWorkout,
  };
}
