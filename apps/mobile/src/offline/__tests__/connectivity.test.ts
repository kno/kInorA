import { afterEach, describe, expect, it, vi } from "vitest";

const addEventListener = vi.fn();
const fetchState = vi.fn();

vi.mock("@react-native-community/netinfo", () => ({
  default: {
    addEventListener: (...args: unknown[]) => addEventListener(...args),
    fetch: (...args: unknown[]) => fetchState(...args),
  },
}));

describe("createConnectivityMonitor (NetInfo, mobile)", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("isOnline() reflects the last NetInfo state observed via the internal subscription", async () => {
    let internalListener: ((state: { isConnected: boolean | null }) => void) | undefined;
    addEventListener.mockImplementation((cb) => {
      internalListener = cb;
      return () => {};
    });

    const { createConnectivityMonitor } = await import("../connectivity");
    const monitor = createConnectivityMonitor();

    // Defaults to true (optimistic) before the first NetInfo event arrives.
    expect(monitor.isOnline()).toBe(true);

    internalListener?.({ isConnected: false });
    expect(monitor.isOnline()).toBe(false);

    internalListener?.({ isConnected: true });
    expect(monitor.isOnline()).toBe(true);
  });

  it("treats a null isConnected (unknown) as online — never blocks a flush on ambiguous state", async () => {
    let internalListener: ((state: { isConnected: boolean | null }) => void) | undefined;
    addEventListener.mockImplementation((cb) => {
      internalListener = cb;
      return () => {};
    });

    const { createConnectivityMonitor } = await import("../connectivity");
    const monitor = createConnectivityMonitor();
    internalListener?.({ isConnected: false });
    internalListener?.({ isConnected: null });
    expect(monitor.isOnline()).toBe(true);
  });

  it("subscribe() notifies external listeners on a true connectivity transition", async () => {
    let internalListener: ((state: { isConnected: boolean | null }) => void) | undefined;
    addEventListener.mockImplementation((cb) => {
      internalListener = cb;
      return () => {};
    });

    const { createConnectivityMonitor } = await import("../connectivity");
    const monitor = createConnectivityMonitor();
    const onChange = vi.fn();
    monitor.subscribe(onChange);

    internalListener?.({ isConnected: false });
    internalListener?.({ isConnected: true });

    expect(onChange).toHaveBeenNthCalledWith(1, false);
    expect(onChange).toHaveBeenNthCalledWith(2, true);
  });

  it("subscribe() returns an unsubscribe function that stops further notifications", async () => {
    let internalListener: ((state: { isConnected: boolean | null }) => void) | undefined;
    addEventListener.mockImplementation((cb) => {
      internalListener = cb;
      return () => {};
    });

    const { createConnectivityMonitor } = await import("../connectivity");
    const monitor = createConnectivityMonitor();
    const onChange = vi.fn();
    const unsubscribe = monitor.subscribe(onChange);
    unsubscribe();

    internalListener?.({ isConnected: false });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("releases the NetInfo subscription when the last monitor listener unsubscribes", async () => {
    const netInfoUnsubscribe = vi.fn();
    addEventListener.mockReturnValue(netInfoUnsubscribe);

    const { createConnectivityMonitor } = await import("../connectivity");
    const monitor = createConnectivityMonitor();
    const unsubscribe = monitor.subscribe(() => {});

    unsubscribe();

    expect(netInfoUnsubscribe).toHaveBeenCalledTimes(1);
  });
});
