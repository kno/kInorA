import type { AuthIdentityResult } from "../api/auth-identity";
import type { OfflineStore } from "./store";
import { clearActiveSessionPointer } from "./snapshot";

/**
 * Cross-identity scoping / clear-on-logout (Phase 5 mobile offline design:
 * "Local store is scoped per authenticated identity and cleared on logout").
 *
 * Unlike web (which has no client-visible tenantId/userId and must derive
 * identity via a Server Action), mobile calls the API directly and already
 * holds the Bearer token — so it resolves `(tenantId, userId)` itself via
 * `GET /auth/identity` (see `../api/auth-identity.ts`) and hashes it into
 * the SAME opaque, context-prefixed `identityKey` shape web uses:
 * `sha256("workout-offline:" + tenantId + ":" + userId)` — see
 * `resolveIdentityKey`.
 *
 * `ensureIdentityScope` detects an identity CHANGE (vs. a persisted
 * `__lastIdentityKey__` marker) and wipes the PREVIOUS identity's queue +
 * snapshot + active-session pointer before letting the new identity's
 * session load — covering BOTH "logout then relogin as the same user" (a
 * no-op, since the key is stable per account) and "logout then a different
 * user logs in / shared-device switch" (previous data purged, new identity
 * never touched).
 *
 * `clearIdentityScope` is ALSO invoked explicitly from
 * `WorkoutTrackerScreen.tsx`'s `handleUnauthenticatedSession` (mobile's
 * only existing "session ended" hook — no dedicated Logout screen exists in
 * this app) so a detected session expiry/revocation clears the CURRENT
 * identity's data immediately, rather than waiting for the NEXT identity's
 * mount to detect the switch.
 */

const LAST_IDENTITY_META_KEY = "__lastIdentityKey__";

export async function clearIdentityScope(
  store: OfflineStore,
  identityKey: string,
): Promise<void> {
  const prefix = `${identityKey}:`;
  for (const name of ["mutations", "snapshots"] as const) {
    while (true) {
      const all = await store.entries(name);
      const matching = all.filter(({ key }) => key.startsWith(prefix));
      if (matching.length === 0) break;
      for (const { key } of matching) {
        await store.delete(name, key);
      }
    }
  }
  await store.delete("meta", `${identityKey}:lastClientSeq`);
  await clearActiveSessionPointer(store, identityKey);
}

export async function ensureIdentityScope(
  store: OfflineStore,
  identityKey: string,
): Promise<void> {
  const lastIdentityKey = await store.get<string>("meta", LAST_IDENTITY_META_KEY);

  if (lastIdentityKey !== undefined && lastIdentityKey !== identityKey) {
    await clearIdentityScope(store, lastIdentityKey);
  }

  await store.put("meta", LAST_IDENTITY_META_KEY, identityKey);
}

/**
 * Lazily imports `expo-crypto` so this module's graph does not pull in the
 * native Expo crypto binding at import time — mirrors the lazy
 * `expo-secure-store` import in `../api/workout-session.ts`, keeping this
 * module unit-testable under vitest without mocking a native module.
 */
async function defaultHash(input: string): Promise<string> {
  const { digestStringAsync, CryptoDigestAlgorithm } = await import("expo-crypto");
  return digestStringAsync(CryptoDigestAlgorithm.SHA256, input);
}

interface ResolveIdentityKeyOptions {
  getIdentity: () => Promise<AuthIdentityResult>;
  hash?: (input: string) => Promise<string>;
}

/**
 * Resolves an opaque, PER-ACCOUNT `identityKey` for scoping the offline
 * store (design: "Local store is scoped per authenticated identity...").
 *
 * Unlike web (no client-visible tenantId/userId — must go through a Server
 * Action), mobile calls `GET /auth/identity` directly (it already holds the
 * Bearer token) and hashes the result into the SAME opaque,
 * context-prefixed shape web uses: `sha256("workout-offline:" + tenantId +
 * ":" + userId)`.
 *
 * Deliberately derived from `(tenantId, userId)`, NOT the session token: the
 * token rotates on every login, so a token-hash key would treat the SAME
 * user's re-login as a brand-new identity and `ensureIdentityScope` would
 * silently purge that user's own unsynced queue (the exact Judgment-Day-
 * flagged bug web's PR4 fixed) — see `../../offline-invariants` in Engram
 * and the design's identity-scoping ADR.
 *
 * Returns `undefined` when there is no session or the identity lookup fails
 * (expired/revoked session) — callers must degrade to the pre-offline
 * direct-call behavior rather than crash.
 */
export async function resolveIdentityKey(
  options: ResolveIdentityKeyOptions,
): Promise<string | undefined> {
  const identity = await options.getIdentity();
  if (identity.kind === "error") return undefined;

  const hash = options.hash ?? defaultHash;
  return hash(`workout-offline:${identity.tenantId}:${identity.userId}`);
}
