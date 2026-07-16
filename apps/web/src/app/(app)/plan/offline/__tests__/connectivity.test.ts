// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { createConnectivityMonitor } from "../connectivity";

/**
 * Web `ConnectivityMonitor` implementation (Phase 4 web offline design:
 * "Connectivity as a shared port type, per-runtime impls" —
 * `navigator.onLine` + `online`/`offline` window events on web).
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createConnectivityMonitor (web)", () => {
  it("isOnline() reflects navigator.onLine", () => {
    vi.stubGlobal("navigator", { onLine: true });
    const monitor = createConnectivityMonitor();
    expect(monitor.isOnline()).toBe(true);

    vi.stubGlobal("navigator", { onLine: false });
    expect(monitor.isOnline()).toBe(false);
  });

  it("subscribe() invokes the callback with true on a window 'online' event", () => {
    const monitor = createConnectivityMonitor();
    const cb = vi.fn();
    monitor.subscribe(cb);

    window.dispatchEvent(new Event("online"));

    expect(cb).toHaveBeenCalledWith(true);
  });

  it("subscribe() invokes the callback with false on a window 'offline' event", () => {
    const monitor = createConnectivityMonitor();
    const cb = vi.fn();
    monitor.subscribe(cb);

    window.dispatchEvent(new Event("offline"));

    expect(cb).toHaveBeenCalledWith(false);
  });

  it("the returned unsubscribe function stops further callback invocations", () => {
    const monitor = createConnectivityMonitor();
    const cb = vi.fn();
    const unsubscribe = monitor.subscribe(cb);

    unsubscribe();
    window.dispatchEvent(new Event("online"));

    expect(cb).not.toHaveBeenCalled();
  });
});
