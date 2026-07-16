import type { ConnectivityMonitor } from "@kinora/contracts";

/**
 * Web `ConnectivityMonitor` implementation (Phase 4 web offline design:
 * "Connectivity as a shared port type, per-runtime impls"). The port type
 * lives in `@kinora/contracts`; runtime detection is platform-specific and
 * cannot be shared as code — mobile's impl uses
 * `@react-native-community/netinfo` instead (Phase 5, out of this slice).
 */
export function createConnectivityMonitor(): ConnectivityMonitor {
  return {
    isOnline(): boolean {
      return typeof navigator === "undefined" ? true : navigator.onLine;
    },
    subscribe(cb: (online: boolean) => void): () => void {
      if (typeof window === "undefined") {
        return () => {};
      }

      const handleOnline = () => cb(true);
      const handleOffline = () => cb(false);

      window.addEventListener("online", handleOnline);
      window.addEventListener("offline", handleOffline);

      return () => {
        window.removeEventListener("online", handleOnline);
        window.removeEventListener("offline", handleOffline);
      };
    },
  };
}
