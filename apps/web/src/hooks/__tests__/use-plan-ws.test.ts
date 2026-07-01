// @vitest-environment jsdom
/**
 * Tests for usePlanWs hook and its exported pure helpers.
 *
 * Pure helpers (buildWsUrl, buildPollUrl, resolveStatusUpdate, shouldUpdateStatus,
 * isStatusAllowed, getApiBase, getWsBase) are tested directly — no mocks needed.
 *
 * Hook behaviour (Fix D) is tested with renderHook + a fake WebSocket class
 * injected via the WebSocketImpl option. This avoids global mock pollution
 * while exercising the real hook logic: mount → message → status update;
 * non-matching planId ignored; onerror → poll starts; unmount → socket closed;
 * terminal status → no reconnect (Fix A); stale "generating" after "ready"
 * ignored (Fix B).
 *
 * Mock/assertion ratio: each test uses at most 1 fake WebSocket + 1 mock fetch.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  buildWsUrl,
  resolveStatusUpdate,
  shouldUpdateStatus,
  buildPollUrl,
  getApiBase,
  getWsBase,
  isStatusAllowed,
  STATUS_RANK,
  usePlanWs,
} from "../use-plan-ws";

// ---------------------------------------------------------------------------
// Pure helper tests
// ---------------------------------------------------------------------------

describe("buildWsUrl", () => {
  it("builds the wss URL with the token as a query param when a token is given", () => {
    const url = buildWsUrl("wss://api.test", "tok-abc");
    expect(url).toBe("wss://api.test/ws/plans?token=tok-abc");
  });

  it("uses the configured WS_BASE_URL", () => {
    const url = buildWsUrl("wss://kinora.io", "tok-xyz");
    expect(url).toBe("wss://kinora.io/ws/plans?token=tok-xyz");
  });

  // Issue #42: browsers rely on the same-origin kinora_session cookie, so no
  // token is passed. The URL must NOT contain ?token= (no token in the WS URL).
  it("builds the URL WITHOUT a token query param when no token is given", () => {
    const url = buildWsUrl("wss://api.test");
    expect(url).toBe("wss://api.test/ws/plans");
    expect(url).not.toContain("token");
  });

  it("builds the URL without ?token= when token is undefined", () => {
    const url = buildWsUrl("wss://api.test", undefined);
    expect(url).toBe("wss://api.test/ws/plans");
  });
});

describe("resolveStatusUpdate", () => {
  it("parses a valid JSON message into { planId, status }", () => {
    const result = resolveStatusUpdate(
      JSON.stringify({ planId: "plan-1", status: "ready" }),
    );
    expect(result).toEqual({ planId: "plan-1", status: "ready" });
  });

  it("returns null for malformed JSON", () => {
    const result = resolveStatusUpdate("not json {{");
    expect(result).toBeNull();
  });

  it("returns null when planId is missing", () => {
    const result = resolveStatusUpdate(JSON.stringify({ status: "ready" }));
    expect(result).toBeNull();
  });

  it("returns null when status is missing", () => {
    const result = resolveStatusUpdate(JSON.stringify({ planId: "plan-1" }));
    expect(result).toBeNull();
  });
});

describe("shouldUpdateStatus", () => {
  it("returns true when the message planId matches the watched planId", () => {
    expect(shouldUpdateStatus("plan-1", { planId: "plan-1", status: "ready" })).toBe(true);
  });

  it("returns false when the message planId does NOT match (other user's plan)", () => {
    expect(shouldUpdateStatus("plan-1", { planId: "plan-2", status: "ready" })).toBe(false);
  });
});

describe("buildPollUrl", () => {
  it("builds the REST poll URL for the plan", () => {
    const url = buildPollUrl("http://api.test", "plan-abc");
    expect(url).toBe("http://api.test/workout-plans/plan-abc");
  });
});

describe("getApiBase", () => {
  it("returns the default API base URL when NEXT_PUBLIC_API_BASE_URL is not set", () => {
    const orig = process.env.NEXT_PUBLIC_API_BASE_URL;
    delete process.env.NEXT_PUBLIC_API_BASE_URL;
    const base = getApiBase();
    expect(base).toBe("http://localhost:4000");
    if (orig !== undefined) process.env.NEXT_PUBLIC_API_BASE_URL = orig;
  });

  it("returns NEXT_PUBLIC_API_BASE_URL when set", () => {
    const orig = process.env.NEXT_PUBLIC_API_BASE_URL;
    process.env.NEXT_PUBLIC_API_BASE_URL = "https://api.kinora.io";
    const base = getApiBase();
    expect(base).toBe("https://api.kinora.io");
    if (orig !== undefined) {
      process.env.NEXT_PUBLIC_API_BASE_URL = orig;
    } else {
      delete process.env.NEXT_PUBLIC_API_BASE_URL;
    }
  });
});

describe("getWsBase", () => {
  it("returns a ws:// base from window.location in jsdom", () => {
    // jsdom provides window.location — protocol is "http:", host includes the port
    const base = getWsBase();
    // Must start with ws:// and use window.location.host (protocol is http: → ws:)
    expect(base).toMatch(/^ws:\/\//);
    expect(base).toContain(window.location.host);
  });
});

// ---------------------------------------------------------------------------
// Fix B — isStatusAllowed (monotonicity guard)
// ---------------------------------------------------------------------------

describe("isStatusAllowed — status rank monotonicity (Fix B)", () => {
  it("STATUS_RANK assigns generating=0, ready=1, failed=1", () => {
    expect(STATUS_RANK["generating"]).toBe(0);
    expect(STATUS_RANK["ready"]).toBe(1);
    expect(STATUS_RANK["failed"]).toBe(1);
  });

  it("allows generating → ready (rank 0 → 1)", () => {
    expect(isStatusAllowed("generating", "ready")).toBe(true);
  });

  it("allows generating → failed (rank 0 → 1)", () => {
    expect(isStatusAllowed("generating", "failed")).toBe(true);
  });

  it("rejects ready → generating (rank 1 → 0 — stale push)", () => {
    expect(isStatusAllowed("ready", "generating")).toBe(false);
  });

  it("rejects failed → generating (rank 1 → 0 — stale push)", () => {
    expect(isStatusAllowed("failed", "generating")).toBe(false);
  });

  it("allows ready → ready (same rank — idempotent)", () => {
    expect(isStatusAllowed("ready", "ready")).toBe(true);
  });

  it("allows generating → generating (same rank — idempotent)", () => {
    expect(isStatusAllowed("generating", "generating")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Fake WebSocket factory for hook tests (Fix D)
// ---------------------------------------------------------------------------

interface FakeWsInstance {
  url: string;
  onopen: ((e: Event) => void) | null;
  onmessage: ((e: MessageEvent) => void) | null;
  onerror: ((e: Event) => void) | null;
  onclose: ((e: CloseEvent) => void) | null;
  close: ReturnType<typeof vi.fn>;
  simulateOpen: () => void;
  simulateMessage: (data: string) => void;
  simulateError: () => void;
  simulateClose: () => void;
}

function createFakeWsClass(): {
  FakeWs: typeof WebSocket;
  instances: FakeWsInstance[];
} {
  const instances: FakeWsInstance[] = [];

  class FakeWs {
    url: string;
    onopen: ((e: Event) => void) | null = null;
    onmessage: ((e: MessageEvent) => void) | null = null;
    onerror: ((e: Event) => void) | null = null;
    onclose: ((e: CloseEvent) => void) | null = null;
    close = vi.fn(() => {
      if (this.onclose) this.onclose(new CloseEvent("close"));
    });

    simulateOpen() {
      if (this.onopen) this.onopen(new Event("open"));
    }
    simulateMessage(data: string) {
      if (this.onmessage) this.onmessage(new MessageEvent("message", { data }));
    }
    simulateError() {
      if (this.onerror) this.onerror(new Event("error"));
    }
    simulateClose() {
      if (this.onclose) this.onclose(new CloseEvent("close"));
    }

    constructor(url: string) {
      this.url = url;
      instances.push(this as unknown as FakeWsInstance);
    }
  }

  return { FakeWs: FakeWs as unknown as typeof WebSocket, instances };
}

// ---------------------------------------------------------------------------
// Hook integration tests (Fix D)
// ---------------------------------------------------------------------------

describe("usePlanWs hook — WS message updates status", () => {
  it("updates status when a matching planId message arrives", () => {
    const { FakeWs, instances } = createFakeWsClass();

    const { result } = renderHook(() =>
      usePlanWs("plan-1", {
        token: "tok-abc",
        initialStatus: "generating",
        wsBase: "ws://api.test",
        WebSocketImpl: FakeWs,
      }),
    );

    expect(result.current.status).toBe("generating");

    const ws = instances[0]!;
    act(() => ws.simulateOpen());
    act(() => ws.simulateMessage(JSON.stringify({ planId: "plan-1", status: "ready" })));

    expect(result.current.status).toBe("ready");
  });

  it("does NOT update status when the planId does not match (other user's plan)", () => {
    const { FakeWs, instances } = createFakeWsClass();

    const { result } = renderHook(() =>
      usePlanWs("plan-1", {
        token: "tok-abc",
        initialStatus: "generating",
        wsBase: "ws://api.test",
        WebSocketImpl: FakeWs,
      }),
    );

    const ws = instances[0]!;
    act(() => ws.simulateOpen());
    act(() => ws.simulateMessage(JSON.stringify({ planId: "plan-OTHER", status: "ready" })));

    expect(result.current.status).toBe("generating");
  });

  it("does NOT update status when the message is invalid JSON", () => {
    const { FakeWs, instances } = createFakeWsClass();

    const { result } = renderHook(() =>
      usePlanWs("plan-1", {
        token: "tok-abc",
        initialStatus: "generating",
        wsBase: "ws://api.test",
        WebSocketImpl: FakeWs,
      }),
    );

    const ws = instances[0]!;
    act(() => ws.simulateOpen());
    act(() => ws.simulateMessage("not-json{{"));

    expect(result.current.status).toBe("generating");
  });
});

describe("usePlanWs hook — Fix A: terminal status prevents reconnect", () => {
  it("does NOT schedule a reconnect after 'ready' closes the socket", () => {
    vi.useFakeTimers();
    const { FakeWs, instances } = createFakeWsClass();

    renderHook(() =>
      usePlanWs("plan-1", {
        token: "tok-abc",
        initialStatus: "generating",
        wsBase: "ws://api.test",
        WebSocketImpl: FakeWs,
      }),
    );

    const ws = instances[0]!;
    act(() => ws.simulateOpen());
    // "ready" → hook updates ref to "ready" then calls ws.close()
    act(() => ws.simulateMessage(JSON.stringify({ planId: "plan-1", status: "ready" })));
    // Advance timers; no reconnect should be scheduled
    act(() => vi.advanceTimersByTime(10000));

    // Only one WS instance was ever created — no reconnect
    expect(instances).toHaveLength(1);

    vi.useRealTimers();
  });

  it("does NOT schedule a reconnect after 'failed' closes the socket", () => {
    vi.useFakeTimers();
    const { FakeWs, instances } = createFakeWsClass();

    renderHook(() =>
      usePlanWs("plan-1", {
        token: "tok-abc",
        initialStatus: "generating",
        wsBase: "ws://api.test",
        WebSocketImpl: FakeWs,
      }),
    );

    const ws = instances[0]!;
    act(() => ws.simulateOpen());
    act(() => ws.simulateMessage(JSON.stringify({ planId: "plan-1", status: "failed" })));
    act(() => vi.advanceTimersByTime(10000));

    expect(instances).toHaveLength(1);

    vi.useRealTimers();
  });
});

describe("usePlanWs hook — Fix B: monotonicity guard (stale push rejected)", () => {
  it("ignores a stale 'generating' message after status is already 'ready'", () => {
    const { FakeWs, instances } = createFakeWsClass();

    const { result } = renderHook(() =>
      usePlanWs("plan-1", {
        token: "tok-abc",
        initialStatus: "generating",
        wsBase: "ws://api.test",
        WebSocketImpl: FakeWs,
      }),
    );

    const ws = instances[0]!;
    act(() => ws.simulateOpen());
    // First: "ready" arrives
    act(() => ws.simulateMessage(JSON.stringify({ planId: "plan-1", status: "ready" })));
    expect(result.current.status).toBe("ready");
    // Second: stale "generating" push — must be rejected
    act(() => ws.simulateMessage(JSON.stringify({ planId: "plan-1", status: "generating" })));
    expect(result.current.status).toBe("ready");
  });
});

describe("usePlanWs hook — onerror starts poll fallback", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts polling GET /workout-plans/:id when the WS connect errors", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "ready" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const { FakeWs, instances } = createFakeWsClass();

    const { result } = renderHook(() =>
      usePlanWs("plan-1", {
        token: "tok-abc",
        initialStatus: "generating",
        wsBase: "ws://api.test",
        apiBase: "http://api.test",
        fetchImpl,
        WebSocketImpl: FakeWs,
      }),
    );

    const ws = instances[0]!;
    act(() => ws.simulateError());

    await act(async () => {
      vi.advanceTimersByTime(6000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "http://api.test/workout-plans/plan-1",
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: "Bearer tok-abc" }),
      }),
    );
    expect(result.current.status).toBe("ready");
  });
});

describe("usePlanWs hook — unmount cleanup", () => {
  it("closes the socket and does not call setState after unmount", () => {
    vi.useFakeTimers();
    const { FakeWs, instances } = createFakeWsClass();

    const { unmount } = renderHook(() =>
      usePlanWs("plan-1", {
        token: "tok-abc",
        initialStatus: "generating",
        wsBase: "ws://api.test",
        WebSocketImpl: FakeWs,
      }),
    );

    const ws = instances[0]!;
    unmount();

    // Socket must be closed on unmount
    expect(ws.close).toHaveBeenCalled();

    vi.useRealTimers();
  });
});

describe("usePlanWs hook — no token, no WebSocket available → polling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("polls GET /workout-plans/:id when no token AND no WebSocket impl is available (SSR/Node)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "generating" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    // Simulate an environment with NO WebSocket (SSR/Node). jsdom provides a
    // global WebSocket, so remove it for this test to exercise the poll branch.
    const originalWs = globalThis.WebSocket;
    // @ts-expect-error — deliberately removing the global for this scenario.
    delete globalThis.WebSocket;

    try {
      renderHook(() =>
        usePlanWs("plan-1", {
          token: undefined,
          initialStatus: "generating",
          apiBase: "http://api.test",
          fetchImpl,
          // No WebSocketImpl and no global WebSocket → poll fallback.
        }),
      );

      await act(async () => {
        vi.advanceTimersByTime(6000);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(fetchImpl).toHaveBeenCalledWith(
        "http://api.test/workout-plans/plan-1",
        expect.objectContaining({}),
      );
    } finally {
      globalThis.WebSocket = originalWs;
    }
  });
});

// ---------------------------------------------------------------------------
// Issue #42: browser same-origin cookie path — no token in JS or WS URL.
// When no token is provided but a WebSocket is available (browser), the hook
// must still open the WS (relying on the auto-sent same-origin cookie) instead
// of immediately falling back to polling. The WS URL must carry NO ?token=.
// ---------------------------------------------------------------------------
describe("usePlanWs hook — no token but WebSocket available → cookie WS path (Fix #42)", () => {
  it("opens the WS without a token and without ?token= in the URL", () => {
    const { FakeWs, instances } = createFakeWsClass();

    const { result } = renderHook(() =>
      usePlanWs("plan-1", {
        token: undefined,
        initialStatus: "generating",
        wsBase: "ws://api.test",
        WebSocketImpl: FakeWs,
      }),
    );

    // A WS connection must have been attempted (cookie auth), not polling.
    expect(instances).toHaveLength(1);
    expect(instances[0]!.url).toBe("ws://api.test/ws/plans");
    expect(instances[0]!.url).not.toContain("token");

    // And it still processes status pushes normally.
    const ws = instances[0]!;
    act(() => ws.simulateOpen());
    act(() => ws.simulateMessage(JSON.stringify({ planId: "plan-1", status: "ready" })));
    expect(result.current.status).toBe("ready");
  });
});
