"use client";

/**
 * PlanStatusClient — client component that wires the WS subscription.
 *
 * Wraps PlanStatusView and:
 *   1. Subscribes to wss://.../ws/plans?token=<sessionToken> via usePlanWs
 *   2. Merges WS-pushed status with the server-fetched initial status
 *   3. When WS pushes "ready" but the initial render had no program (was still
 *      "generating" at SSR), calls getPlanStatusAction (a server action) to
 *      fetch the program server-side. The browser never calls the API directly.
 *   4. Handles the "Regenerate" button → POST /plan-specs/:specId/regenerate
 *      via NEXT_PUBLIC_API_BASE_URL (the public origin, allowed for browser calls)
 *
 * Token-in-URL tradeoff (v1): the session token is read server-side from the
 * httpOnly kinora_session cookie and passed as a prop to avoid client-side
 * httpOnly access (which would fail). It is forwarded to usePlanWs which
 * appends it as ?token=... on the WS URL. Both paths (WS URL param + API
 * Bearer header) use the same short-lived opaque TLS-protected token.
 *
 * Cookie-on-WS upgrade (preferred v2 path) requires same-origin deployment
 * (web + API on the same domain) and @fastify/cookie on the server — deferred
 * because the dev setup runs web:3000 / api:4000 (cross-origin). Tracked for
 * the v2 architecture pass.
 */
import { useCallback, useEffect, useState } from "react";
import { usePlanWs } from "@/hooks/use-plan-ws";
import { getPlanStatusAction } from "./actions";
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
        // Status will be pushed via WS; clear the stale program
        setProgram(undefined);
      }
    } catch {
      // Network error — user can try again
    } finally {
      setRegenerating(false);
    }
  }, [specId, token]);

  return (
    <PlanStatusView
      planId={planId}
      status={regenerating ? "generating" : status}
      program={program}
      specId={specId}
      messages={messages as Record<string, string> | undefined}
      onRegenerate={handleRegenerate}
    />
  );
}
