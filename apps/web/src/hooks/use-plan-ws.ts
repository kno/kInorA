"use client";

/**
 * usePlanWs — React hook that subscribes to the plan-status WebSocket.
 *
 * Opens: wss://<host>/ws/plans?token=<sessionToken>
 *
 * Browsers cannot send custom headers on WebSocket connections, so the
 * session token is passed as a URL query parameter — matching the server-side
 * `routes/ws.ts` preValidation that reads `request.query.token`.
 *
 * On connect: listens for { planId, status } messages and updates local status
 *   when planId matches the watched planId.
 * On connect failure: falls back to polling GET /workout-plans/:planId.
 * On disconnect: attempts reconnect (up to MAX_RECONNECTS times).
 *
 * Pure helper functions are exported separately so they can be unit-tested
 * without a DOM environment or hook runner.
 */
import { useEffect, useRef, useState, useCallback } from "react";

// ---------------------------------------------------------------------------
// Pure helper functions (exported for testing)
// ---------------------------------------------------------------------------

/** Builds the WebSocket URL with the session token as a query param. */
export function buildWsUrl(wsBase: string, token: string): string {
  return `${wsBase}/ws/plans?token=${encodeURIComponent(token)}`;
}

/** Builds the REST poll URL for a plan. */
export function buildPollUrl(apiBase: string, planId: string): string {
  return `${apiBase}/workout-plans/${planId}`;
}

export interface WsMessage {
  planId: string;
  status: string;
}

/** Parses a raw WS message string → WsMessage | null. */
export function resolveStatusUpdate(raw: string): WsMessage | null {
  try {
    const data = JSON.parse(raw) as unknown;
    if (
      typeof data === "object" &&
      data !== null &&
      "planId" in data &&
      "status" in data &&
      typeof (data as Record<string, unknown>).planId === "string" &&
      typeof (data as Record<string, unknown>).status === "string"
    ) {
      const rec = data as Record<string, string>;
      return {
        planId: rec.planId!,
        status: rec.status!,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/** Returns true when the message's planId matches the watched planId. */
export function shouldUpdateStatus(
  watchedPlanId: string,
  msg: WsMessage,
): boolean {
  return msg.planId === watchedPlanId;
}

// ---------------------------------------------------------------------------
// Hook configuration
// ---------------------------------------------------------------------------

const MAX_RECONNECTS = 5;
const RECONNECT_DELAY_MS = 3000;
const POLL_INTERVAL_MS = 5000;

export function getWsBase(): string {
  if (typeof window === "undefined") return "";
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}`;
}

export function getApiBase(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UsePlanWsOptions {
  /** Session token (from cookie — already read by the parent page). */
  token: string | undefined;
  /** Initial status from server-side fetch. */
  initialStatus: string;
  /** Override websocket base URL (testing). */
  wsBase?: string;
  /** Override api base URL (testing). */
  apiBase?: string;
  /** Override fetch (testing). */
  fetchImpl?: typeof fetch;
}

export interface UsePlanWsResult {
  status: string;
}

export function usePlanWs(
  planId: string,
  options: UsePlanWsOptions,
): UsePlanWsResult {
  const {
    token,
    initialStatus,
    wsBase,
    apiBase,
    fetchImpl = fetch,
  } = options;

  const [status, setStatus] = useState(initialStatus);
  const reconnectCount = useRef(0);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const isMounted = useRef(true);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current !== null) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const startPolling = useCallback(() => {
    if (pollTimerRef.current !== null) return; // already polling
    const base = apiBase ?? getApiBase();
    const url = buildPollUrl(base, planId);

    pollTimerRef.current = setInterval(() => {
      void (async () => {
        if (!isMounted.current) return;
        try {
          const res = await fetchImpl(url, {
            headers: token ? { authorization: `Bearer ${token}` } : {},
            cache: "no-store",
          });
          if (!res.ok) return;
          const body = (await res.json()) as { status?: string };
          if (body.status && isMounted.current) {
            setStatus(body.status);
            // Stop polling once in a terminal state
            if (body.status === "ready" || body.status === "failed") {
              stopPolling();
            }
          }
        } catch {
          // Network error during poll — keep trying
        }
      })();
    }, POLL_INTERVAL_MS);
  }, [planId, token, apiBase, fetchImpl, stopPolling]);

  useEffect(() => {
    isMounted.current = true;

    if (!token) {
      // No session — fall back to polling immediately
      startPolling();
      return () => {
        isMounted.current = false;
        stopPolling();
      };
    }

    const base = wsBase ?? getWsBase();

    function connect() {
      if (!isMounted.current) return;
      const url = buildWsUrl(base, token!);
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch {
        // Constructor can throw in some environments
        startPolling();
        return;
      }

      wsRef.current = ws;

      ws.onopen = () => {
        reconnectCount.current = 0;
        stopPolling(); // WS connected — no need to poll
      };

      ws.onmessage = (event: MessageEvent<string>) => {
        const msg = resolveStatusUpdate(event.data);
        if (msg && shouldUpdateStatus(planId, msg) && isMounted.current) {
          setStatus(msg.status);
          // In terminal state we don't need to keep the socket open
          if (msg.status === "ready" || msg.status === "failed") {
            ws.close();
          }
        }
      };

      ws.onerror = () => {
        // On error, fall back to polling
        if (reconnectCount.current === 0) {
          startPolling();
        }
      };

      ws.onclose = () => {
        wsRef.current = null;
        if (!isMounted.current) return;
        // Reconnect unless we're in a terminal state or out of attempts
        if (
          status !== "ready" &&
          status !== "failed" &&
          reconnectCount.current < MAX_RECONNECTS
        ) {
          reconnectCount.current += 1;
          setTimeout(connect, RECONNECT_DELAY_MS);
        } else {
          // Give up on WS — fall back to polling
          startPolling();
        }
      };
    }

    connect();

    return () => {
      isMounted.current = false;
      wsRef.current?.close();
      wsRef.current = null;
      stopPolling();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planId, token]);

  return { status };
}
