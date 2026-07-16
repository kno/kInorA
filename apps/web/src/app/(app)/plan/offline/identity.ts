import type { OfflineStore } from "./store";
import { clearActiveSessionPointer } from "./snapshot";

/**
 * Cross-identity scoping / clear-on-logout (Phase 4 web offline design:
 * "Local store is scoped per authenticated identity and cleared on logout").
 *
 * The browser never sees a client-visible tenantId/userId — the session
 * token stays httpOnly-server-only by design (issue #42 / `tracker-client.ts`
 * header). `identityKey` is an opaque hash of the STABLE `(tenantId, userId)`
 * pair, resolved server-side via a Server Action
 * (`getOfflineIdentityKeyAction` in `actions.ts`, which calls the
 * authenticated `GET /auth/identity` endpoint since the web app has no
 * direct DB access) and passed in here — matching the design's literal
 * `(tenantId, userId)` key prefix (not a token-hash deviation; see the
 * `getOfflineIdentityKeyAction` doc comment for why a token-hash key was
 * rejected: it rotates every login and would treat the SAME user's
 * re-login as a new identity, silently purging their own unsynced queue).
 *
 * Rather than requiring an explicit logout hook wired into the logout
 * Server Action (which would widen this slice's file-change footprint to
 * `dashboard/actions.ts`/`page.tsx`, outside the design's File Changes
 * list), `ensureIdentityScope` detects the identity change itself: it
 * persists a single, UN-scoped "last active identity" marker in the `meta`
 * store, and whenever the resolved identity differs from that marker, it
 * wipes the PREVIOUS identity's queue + snapshot before letting the new
 * identity's session load. Because `identityKey` is now stable per account,
 * "logout then log back in as the same user" is a genuine no-op (the
 * marker is unchanged AND no other code path can produce a different key
 * for the same account) — not merely an accident of marker comparison.
 * "Logout then a different user logs in" / shared-device account switch
 * still purges the PREVIOUS identity's data before the new identity ever
 * enqueues anything; the CURRENT (new) identity's own data is never
 * touched by this purge.
 */

const LAST_IDENTITY_META_KEY = "__lastIdentityKey__";

export async function clearIdentityScope(
  store: OfflineStore,
  identityKey: string,
): Promise<void> {
  const prefix = `${identityKey}:`;
  for (const name of ["mutations", "snapshots"] as const) {
    const all = await store.entries(name);
    for (const { key } of all) {
      if (key.startsWith(prefix)) {
        await store.delete(name, key);
      }
    }
  }
  await store.delete("meta", `${identityKey}:lastClientSeq`);
  // Judgment Day Round-2 fix #2 — the `${identityKey}:activeSessionId`
  // pointer (written by `writeActiveSessionPointer` in snapshot.ts) lives in
  // the `meta` store under its OWN per-identity key, not the `mutations`/
  // `snapshots` prefix loop above, so it was previously left behind on an
  // account switch: an orphaned pointer for an identity that will never be
  // scoped again (fails-safe today — nothing reads a stale identity's
  // pointer — but a permanent per-abandoned-identity storage leak).
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
