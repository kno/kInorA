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
 * v1 token-in-URL tradeoff: the session token is short-lived and opaque; the
 * connection is always TLS-encrypted in production. Cookie-on-WS upgrade is
 * the preferred hardening path but requires same-origin (web + API on the same
 * domain) and `@fastify/cookie` on the server. Tracked for v2.
 *
 * On connect: listens for { planId, status } messages. Updates local status
 *   when planId matches AND the new status rank ≥ current rank (monotonicity
 *   guard — prevents a late "generating" push from overwriting a "ready").
 * On connect failure: falls back to polling GET /workout-plans/:planId.
 * On disconnect: attempts reconnect ONLY when NOT in a terminal state, using a
 *   ref (not stale closure) to check the current status.
 *
 * Pure helper functions are exported separately for unit testing.
 */
import { useEffect, useRef, useState, useCallback } from "react";

// ---------------------------------------------------------------------------
// Status rank — monotonicity guard (Fix B)
// ---------------------------------------------------------------------------

/** Numeric rank for status strings. Higher rank = cannot be overwritten. */
export const STATUS_RANK: Record<string, number> = {
  generating: 0,
  ready: 1,
  failed: 1,
};

/**
 * Returns true only when the incoming status rank ≥ the current status rank.
 * Prevents out-of-order/late "generating" pushes from overwriting "ready"/"failed".
 *
 * Unknown statuses (rank undefined) are treated as rank 0 (lowest precedence).
 */
export function isStatusAllowed(
  currentStatus: string,
  incomingStatus: string,
): boolean {
  const currentRank = STATUS_RANK[currentStatus] ?? 0;
  const incomingRank = STATUS_RANK[incomingStatus] ?? 0;
  return incomingRank >= currentRank;
}

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

export function getWsBase(): string {
  if (typeof window === "undefined") return "";
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}`;
}

export function getApiBase(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";
}

// ---------------------------------------------------------------------------
// Hook configuration
// ---------------------------------------------------------------------------

const MAX_RECONNECTS = 5;
const RECONNECT_DELAY_MS = 3000;
const POLL_INTERVAL_MS = 5000;

/** Returns true when a status value represents a terminal state. */
function isTerminal(s: string): boolean {
  return s === "ready" || s === "failed";
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
  /** Override WebSocket constructor (testing). */
  WebSocketImpl?: typeof WebSocket;
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
    WebSocketImpl,
  } = options;

  const [status, setStatus] = useState(initialStatus);

  // Fix A: track current status in a ref so onclose can read the LIVE value,
  // not the stale closure value captured when connect() was created.
  const currentStatusRef = useRef(initialStatus);

  const reconnectCount = useRef(0);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const isMounted = useRef(true);

  /** Update both state and the ref atomically. */
  const updateStatus = useCallback((next: string) => {
    currentStatusRef.current = next;
    setStatus(next);
  }, []);

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
            // Fix B: apply monotonicity guard on poll results too
            if (isStatusAllowed(currentStatusRef.current, body.status)) {
              updateStatus(body.status);
            }
            // Stop polling once in a terminal state
            if (isTerminal(body.status)) {
              stopPolling();
            }
          }
        } catch {
          // Network error during poll — keep trying
        }
      })();
    }, POLL_INTERVAL_MS);
  }, [planId, token, apiBase, fetchImpl, stopPolling, updateStatus]);

  useEffect(() => {
    isMounted.current = true;
    // Sync the ref if initialStatus changes between renders
    currentStatusRef.current = initialStatus;

    if (!token) {
      // No session — fall back to polling immediately
      startPolling();
      return () => {
        isMounted.current = false;
        stopPolling();
      };
    }

    const WS = WebSocketImpl ?? (typeof WebSocket !== "undefined" ? WebSocket : undefined);
    if (!WS) {
      // No WebSocket in environment (SSR/Node) — fall back to polling
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
        ws = new WS!(url);
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
        if (
          msg &&
          shouldUpdateStatus(planId, msg) &&
          // Fix B: monotonicity — reject late "generating" after "ready"/"failed"
          isStatusAllowed(currentStatusRef.current, msg.status) &&
          isMounted.current
        ) {
          updateStatus(msg.status);
          // In terminal state we don't need to keep the socket open
          if (isTerminal(msg.status)) {
            ws.close();
          }
        }
      };

      ws.onerror = () => {
        // On error, fall back to polling (only start once)
        if (reconnectCount.current === 0) {
          startPolling();
        }
      };

      ws.onclose = () => {
        wsRef.current = null;
        if (!isMounted.current) return;
        // Fix A: read currentStatusRef (live value), NOT the stale closure `status`.
        // This prevents a spurious reconnect after the socket closes following a
        // "ready"/"failed" message (the onmessage handler updates the ref before
        // calling ws.close(), so onclose sees the correct terminal value).
        if (
          !isTerminal(currentStatusRef.current) &&
          reconnectCount.current < MAX_RECONNECTS
        ) {
          reconnectCount.current += 1;
          setTimeout(connect, RECONNECT_DELAY_MS);
        } else {
          // Terminal state OR exhausted reconnects — fall back to polling
          if (!isTerminal(currentStatusRef.current)) {
            startPolling();
          }
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
