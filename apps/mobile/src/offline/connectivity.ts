import NetInfo from "@react-native-community/netinfo";
import type { ConnectivityMonitor } from "@kinora/contracts";

/**
 * Mobile `ConnectivityMonitor` implementation (Phase 5 mobile offline
 * design: "Connectivity as a shared port type, per-runtime impls"). The
 * port type lives in `@kinora/contracts`; runtime detection is
 * platform-specific — web uses `navigator.onLine` + `online`/`offline`
 * window events, mobile uses `@react-native-community/netinfo`. NetInfo
 * does not match a deps-guard prohibited pattern.
 *
 * `isOnline()` reflects the LAST NetInfo state observed by a single,
 * always-on internal subscription (started at module-scope call time,
 * i.e. when `createConnectivityMonitor()` runs) — never a fresh
 * `NetInfo.fetch()` per call, so `isOnline()` stays synchronous (matching
 * the shared `ConnectivityMonitor` port's synchronous signature).
 *
 * `isConnected: null` (NetInfo's "unknown" state, e.g. immediately after
 * app launch before the native module reports back) is treated as ONLINE —
 * an ambiguous connectivity signal must never block a flush attempt; a
 * genuine offline condition will surface as an `UNREACHABLE`/network
 * failure on the actual API call regardless.
 */
export function createConnectivityMonitor(): ConnectivityMonitor {
  let online = true;
  const listeners = new Set<(online: boolean) => void>();

  NetInfo.addEventListener((state: { isConnected: boolean | null }) => {
    online = state.isConnected !== false;
    for (const cb of listeners) cb(online);
  });

  return {
    isOnline(): boolean {
      return online;
    },
    subscribe(cb: (online: boolean) => void): () => void {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
  };
}
