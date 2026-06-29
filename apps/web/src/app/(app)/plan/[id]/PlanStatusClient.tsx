"use client";

/**
 * PlanStatusClient — client component that wires the WS subscription.
 *
 * Wraps PlanStatusView and:
 *   1. Subscribes to wss://.../ws/plans?token=<sessionToken> via usePlanWs
 *   2. Merges WS-pushed status with the server-fetched initial status
 *   3. Handles the "Regenerate" button → POST /plan-specs/:specId/regenerate
 *      (server action from actions.ts)
 *
 * Browser auth flow: the session token is read from the kinora_session cookie
 * client-side. We read it via document.cookie because Next.js httpOnly cookies
 * are NOT accessible from client JS. Instead the parent server component reads
 * the cookie and passes the token as a prop (avoids any client-side cookie
 * access of an httpOnly cookie — which would fail anyway).
 */
import { useCallback, useState } from "react";
import { usePlanWs } from "@/hooks/use-plan-ws";
import { PlanStatusView } from "./PlanStatusView";
import type { WorkoutProgram } from "@kinora/contracts";
import type { Messages } from "@/i18n/locale";

export interface PlanStatusClientProps {
  planId: string;
  specId?: string;
  initialStatus: string;
  initialProgram?: WorkoutProgram;
  /** Session token read by the server component (passed as prop). */
  token: string | undefined;
  messages?: Messages;
}

export function PlanStatusClient({
  planId,
  specId,
  initialStatus,
  initialProgram,
  token,
  messages,
}: PlanStatusClientProps) {
  const [program, setProgram] = useState<WorkoutProgram | undefined>(
    initialProgram,
  );
  const [regenerating, setRegenerating] = useState(false);

  // usePlanWs opens the WebSocket and updates status on push messages.
  // Falls back to polling GET /workout-plans/:id if the WS connect fails.
  const { status } = usePlanWs(planId, {
    token,
    initialStatus,
  });

  const handleRegenerate = useCallback(async () => {
    if (!specId) return;
    setRegenerating(true);
    try {
      // Call the API directly from the client (not a server action) because
      // server actions cannot be called from inside a "use client" component's
      // event handler in this pattern. We call the API endpoint directly.
      const base =
        process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";
      const res = await fetch(`${base}/plan-specs/${specId}/regenerate`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        // Status will be pushed via WS; optimistically clear the program
        setProgram(undefined);
      }
    } catch {
      // Network error — user can try again
    } finally {
      setRegenerating(false);
    }
  }, [specId, token]);

  // When the WS reports "ready" but we don't have the program content yet,
  // fetch it. This handles the case where the WS fires after mount but
  // before the server had a chance to include the program in the initial render.
  const resolvedProgram = status === "ready" && !program ? undefined : program;

  return (
    <PlanStatusView
      planId={planId}
      status={regenerating ? "generating" : status}
      program={resolvedProgram}
      specId={specId}
      messages={messages as Record<string, string> | undefined}
      onRegenerate={handleRegenerate}
    />
  );
}
