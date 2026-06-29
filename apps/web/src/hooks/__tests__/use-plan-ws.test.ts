/**
 * Tests for usePlanWs hook.
 *
 * The hook:
 *  - Opens wss://.../ws/plans?token=<token>
 *  - Updates status when it receives { planId, status } for the matching planId
 *  - Ignores messages for other planIds
 *  - Falls back to polling GET /workout-plans/:id when WebSocket connect fails
 *
 * Uses a mock WebSocket class injected via options (no browser globals required).
 * Pure logic extracted as testable units so we can test without a real DOM/hook runner.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  buildWsUrl,
  resolveStatusUpdate,
  shouldUpdateStatus,
  buildPollUrl,
  getApiBase,
  getWsBase,
} from "../use-plan-ws";

// ---------------------------------------------------------------------------
// Pure function tests (no mock WS needed)
// ---------------------------------------------------------------------------

describe("buildWsUrl", () => {
  it("builds the wss URL with the token as a query param", () => {
    const url = buildWsUrl("wss://api.test", "tok-abc");
    expect(url).toBe("wss://api.test/ws/plans?token=tok-abc");
  });

  it("uses the configured WS_BASE_URL", () => {
    const url = buildWsUrl("wss://kinora.io", "tok-xyz");
    expect(url).toBe("wss://kinora.io/ws/plans?token=tok-xyz");
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
  it("returns an empty string when window is undefined (SSR context)", () => {
    // In vitest (Node environment), window is not defined.
    // getWsBase detects typeof window === 'undefined' and returns "".
    const base = getWsBase();
    expect(base).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Integration: mock WebSocket — subscribe, update, ignore other planIds
// ---------------------------------------------------------------------------

interface MockWsInstance {
  onopen: ((e: Event) => void) | null;
  onmessage: ((e: MessageEvent) => void) | null;
  onerror: ((e: Event) => void) | null;
  onclose: ((e: CloseEvent) => void) | null;
  close: () => void;
  send: (data: string) => void;
  /** Simulate message received */
  receive: (data: string) => void;
  /** Simulate connect */
  connect: () => void;
  /** Simulate error */
  fail: () => void;
}

function createMockWs(): MockWsInstance {
  const ws: MockWsInstance = {
    onopen: null,
    onmessage: null,
    onerror: null,
    onclose: null,
    close: vi.fn(),
    send: vi.fn(),
    receive(data: string) {
      if (ws.onmessage) {
        ws.onmessage({ data } as MessageEvent);
      }
    },
    connect() {
      if (ws.onopen) ws.onopen(new Event("open"));
    },
    fail() {
      if (ws.onerror) ws.onerror(new Event("error"));
    },
  };
  return ws;
}

describe("WS message handling (pure logic)", () => {
  it("updates status when a matching planId message arrives", () => {
    const onStatusChange = vi.fn();
    const planId = "plan-abc";

    const msg = JSON.stringify({ planId, status: "ready" });
    const parsed = resolveStatusUpdate(msg);

    if (parsed && shouldUpdateStatus(planId, parsed)) {
      onStatusChange(parsed.status);
    }

    expect(onStatusChange).toHaveBeenCalledWith("ready");
  });

  it("does NOT update status when the planId does not match", () => {
    const onStatusChange = vi.fn();
    const planId = "plan-abc";

    const msg = JSON.stringify({ planId: "plan-OTHER", status: "ready" });
    const parsed = resolveStatusUpdate(msg);

    if (parsed && shouldUpdateStatus(planId, parsed)) {
      onStatusChange(parsed.status);
    }

    expect(onStatusChange).not.toHaveBeenCalled();
  });

  it("does NOT update status when the message is invalid JSON", () => {
    const onStatusChange = vi.fn();
    const planId = "plan-abc";

    const parsed = resolveStatusUpdate("broken{{json");

    if (parsed && shouldUpdateStatus(planId, parsed)) {
      onStatusChange(parsed.status);
    }

    expect(onStatusChange).not.toHaveBeenCalled();
  });

  it("handles both ready and failed status updates (triangulation)", () => {
    const onStatusChange = vi.fn();
    const planId = "plan-1";

    for (const status of ["ready", "failed"] as const) {
      const msg = JSON.stringify({ planId, status });
      const parsed = resolveStatusUpdate(msg);
      if (parsed && shouldUpdateStatus(planId, parsed)) {
        onStatusChange(parsed.status);
      }
    }

    expect(onStatusChange).toHaveBeenCalledTimes(2);
    expect(onStatusChange).toHaveBeenNthCalledWith(1, "ready");
    expect(onStatusChange).toHaveBeenNthCalledWith(2, "failed");
  });
});
