import { describe, it, expect, beforeEach } from "vitest";
import { createInMemoryOfflineStore } from "../__test-utils__/in-memory-store";
import { enqueueMutation, getQueuedMutations } from "../queue";
import { writeSnapshot, readSnapshot } from "../snapshot";
import { ensureIdentityScope, clearIdentityScope } from "../identity";
import { writeActiveSessionPointer, readActiveSessionPointer } from "../snapshot";
import type { WorkoutSessionRecord } from "@kinora/contracts";

/**
 * Cross-identity scoping / clear-on-logout (Phase 4 web offline design
 * decision: "Local store is scoped per authenticated identity and cleared on
 * logout"). The browser never sees a client-visible tenantId/userId (the
 * session token stays httpOnly-server-only); `identityKey` here is the
 * opaque per-login hash resolved via a Server Action
 * (`getOfflineIdentityKeyAction`) — see actions.ts and the apply-progress
 * deviation note.
 */

const session: WorkoutSessionRecord = {
  id: "session-1",
  workoutPlanId: "plan-1",
  status: "active",
  startedAt: "2026-07-06T09:00:00.000Z",
  exercises: [],
};

describe("ensureIdentityScope", () => {
  let store: ReturnType<typeof createInMemoryOfflineStore>;

  beforeEach(() => {
    store = createInMemoryOfflineStore();
  });

  it("does nothing to a first-ever identity (no prior identity recorded)", async () => {
    await enqueueMutation(store, "identity-a", {
      kind: "set",
      sessionId: "session-1",
      setId: "set-1",
      input: { completed: true },
      queuedAt: 1,
    });

    await ensureIdentityScope(store, "identity-a");

    expect(await getQueuedMutations(store, "identity-a")).toHaveLength(1);
  });

  it("clears the previous identity's queue and snapshot on logout/account switch", async () => {
    await enqueueMutation(store, "identity-a", {
      kind: "set",
      sessionId: "session-1",
      setId: "set-1",
      input: { completed: true },
      queuedAt: 1,
    });
    await writeSnapshot(store, "identity-a", "session-1", session);
    await ensureIdentityScope(store, "identity-a");

    // A new login (different token) resolves a different identityKey.
    await ensureIdentityScope(store, "identity-b");

    expect(await getQueuedMutations(store, "identity-a")).toEqual([]);
    expect(await readSnapshot(store, "identity-a", "session-1")).toBeUndefined();
  });

  it("does NOT clear the current identity's own data on repeated calls (idempotent)", async () => {
    await ensureIdentityScope(store, "identity-a");
    await enqueueMutation(store, "identity-a", {
      kind: "set",
      sessionId: "session-1",
      setId: "set-1",
      input: { completed: true },
      queuedAt: 1,
    });

    await ensureIdentityScope(store, "identity-a");

    expect(await getQueuedMutations(store, "identity-a")).toHaveLength(1);
  });

  // Judgment Day Round-2 fix #2 — clearIdentityScope previously left the
  // purged identity's `${identityKey}:activeSessionId` meta pointer behind
  // (it lives outside the mutations/snapshots prefix loop), an orphaned
  // per-abandoned-identity storage leak.
  it("clears the previous identity's activeSessionId pointer on purge", async () => {
    await writeActiveSessionPointer(store, "identity-a", "session-1");

    await clearIdentityScope(store, "identity-a");

    expect(await readActiveSessionPointer(store, "identity-a")).toBeUndefined();
  });

  it("keeps two authenticated browser tabs from purging each other's queues", async () => {
    await ensureIdentityScope(store, "identity-a", "tab-a");
    await enqueueMutation(store, "identity-a", {
      kind: "set",
      sessionId: "session-1",
      setId: "set-1",
      input: { completed: true },
      queuedAt: 1,
    });

    await ensureIdentityScope(store, "identity-b", "tab-b");

    expect(await getQueuedMutations(store, "identity-a")).toHaveLength(1);
  });

  it("still purges an account switch within the same browser tab", async () => {
    await ensureIdentityScope(store, "identity-a", "tab-a");
    await enqueueMutation(store, "identity-a", {
      kind: "set",
      sessionId: "session-1",
      setId: "set-1",
      input: { completed: true },
      queuedAt: 1,
    });

    await ensureIdentityScope(store, "identity-b", "tab-a");

    expect(await getQueuedMutations(store, "identity-a")).toEqual([]);
  });
});
