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
import { usePlanWs } from "@/hooks/use-plan-ws";
import {
  completeWorkoutSessionAction,
  getPlanStatusAction,
  recordWorkoutSetAction,
  startWorkoutSessionAction,
} from "./actions";
import { regeneratePlanAction } from "@/app/(app)/create-plan/actions";
import { PlanStatusView } from "./PlanStatusView";
import { TrackerPanel } from "./TrackerPanel";
import type { WorkoutProgram, WorkoutSessionRecord } from "@kinora/contracts";
import type { Messages } from "@/i18n/locale";
import type { WorkoutSetUpdateInput } from "./tracker-types";

export interface PlanStatusClientProps {
  planId: string;
  specId?: string;
  initialStatus: string;
  initialProgram?: WorkoutProgram;
  messages?: Messages;
}

export function PlanStatusClient({
  planId,
  specId,
  initialStatus,
  initialProgram,
  messages,
}: PlanStatusClientProps) {
  const [program, setProgram] = useState<WorkoutProgram | undefined>(
    initialProgram,
  );
  const [regenerating, setRegenerating] = useState(false);
  const [activeSession, setActiveSession] = useState<WorkoutSessionRecord | undefined>();
  // #93 F1: a start attempt can return a 409 conflict (another day is already
  // active). This must NOT crash the page — we hold the conflict scope in state
  // and render a minimal inline message. The fully localized banner is Slice 3.
  const [conflict, setConflict] = useState<
    { activePlanName?: string; activeDay?: number | null } | undefined
  >();

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

  const handleStartWorkout = useCallback(async (day: number) => {
    const result = await startWorkoutSessionAction(planId, day);
    // #93 F1: handle the conflict branch structurally — no throw, no crash.
    if (result.kind === "conflict") {
      setConflict({
        activePlanName: result.activePlanName,
        activeDay: result.activeDay,
      });
      return;
    }
    setConflict(undefined);
    setActiveSession(result.session);
  }, [planId]);

  const handleRecordSet = useCallback(async (setId: string, input: WorkoutSetUpdateInput) => {
    if (!activeSession) return;
    const session = await recordWorkoutSetAction(activeSession.id, setId, input);
    setActiveSession(session);
  }, [activeSession]);

  const handleCompleteWorkout = useCallback(async (sessionId: string) => {
    const session = await completeWorkoutSessionAction(sessionId);
    setActiveSession(session);
  }, []);

  if (activeSession) {
    return (
      <TrackerPanel
        session={activeSession}
        messages={messages as Record<string, string> | undefined}
        onRecordSet={handleRecordSet}
        onCompleteSession={handleCompleteWorkout}
      />
    );
  }

  return (
    <>
      {conflict && (
        // #93 F1: minimal inline conflict notice (full localized banner is
        // Slice 3). Rendered instead of crashing when start returns a 409.
        <p role="alert" data-testid="start-conflict">
          {conflict.activePlanName
            ? `You already have an active session for ${conflict.activePlanName}${
                conflict.activeDay != null ? ` · Day ${conflict.activeDay}` : ""
              }.`
            : "You already have an active workout session."}
        </p>
      )}
      <PlanStatusView
        planId={planId}
        status={regenerating ? "generating" : status}
        program={program}
        specId={specId}
        messages={messages as Record<string, string> | undefined}
        onRegenerate={handleRegenerate}
        onStartWorkout={handleStartWorkout}
      />
    </>
  );
}
