import { describe, expect, it, vi } from "vitest";
import { createInMemoryStore } from "../__test-utils__/in-memory-store";
import { clearIdentityScope, ensureIdentityScope, resolveIdentityKey } from "../identity";
import { enqueueMutation, getQueuedMutations } from "../queue";
import { readActiveSessionPointer, writeActiveSessionPointer, writeSnapshot, readSnapshot } from "../snapshot";

async function seedIdentity(store: ReturnType<typeof createInMemoryStore>, identityKey: string) {
  await enqueueMutation(store, identityKey, {
    kind: "set",
    sessionId: "s1",
    setId: "set1",
    input: { completed: true },
    queuedAt: 1000,
  });
  await writeSnapshot(store, identityKey, "s1", {
    id: "s1",
    workoutPlanId: "p1",
    status: "active",
    startedAt: "2026-07-16T10:00:00.000Z",
    exercises: [],
  });
  await writeActiveSessionPointer(store, identityKey, "s1");
}

describe("ensureIdentityScope", () => {
  it("is a no-op the first time an identity is ever seen (nothing to clear)", async () => {
    const store = createInMemoryStore();
    await ensureIdentityScope(store, "id-1");
    // First-run: no prior identity marker, so nothing is purged.
    await seedIdentity(store, "id-1");
    expect(await getQueuedMutations(store, "id-1")).toHaveLength(1);
  });

  it("is idempotent for the SAME identity across repeated calls (e.g. app relaunch by the same user)", async () => {
    const store = createInMemoryStore();
    await ensureIdentityScope(store, "id-1");
    await seedIdentity(store, "id-1");

    await ensureIdentityScope(store, "id-1");
    expect(await getQueuedMutations(store, "id-1")).toHaveLength(1);
    expect(await readSnapshot(store, "id-1", "s1")).toBeDefined();
  });

  it("purges the PREVIOUS identity's queue+snapshot+pointer on an identity switch, never the new identity's", async () => {
    const store = createInMemoryStore();
    await ensureIdentityScope(store, "id-1");
    await seedIdentity(store, "id-1");

    // Account switch: a different identity now authenticates.
    await ensureIdentityScope(store, "id-2");
    await seedIdentity(store, "id-2");

    expect(await getQueuedMutations(store, "id-1")).toHaveLength(0);
    expect(await readSnapshot(store, "id-1", "s1")).toBeUndefined();
    expect(await readActiveSessionPointer(store, "id-1")).toBeUndefined();

    // The NEW identity's own data must never be touched by the purge.
    expect(await getQueuedMutations(store, "id-2")).toHaveLength(1);
    expect(await readSnapshot(store, "id-2", "s1")).toBeDefined();
  });
});

describe("clearIdentityScope", () => {
  it("clears mutations, snapshots, the clientSeq counter, and the active-session pointer for one identity", async () => {
    const store = createInMemoryStore();
    await seedIdentity(store, "id-1");

    await clearIdentityScope(store, "id-1");

    expect(await getQueuedMutations(store, "id-1")).toHaveLength(0);
    expect(await readSnapshot(store, "id-1", "s1")).toBeUndefined();
    expect(await readActiveSessionPointer(store, "id-1")).toBeUndefined();
    // The clientSeq high-water-mark is reset too — a fully logged-out
    // identity has nothing left to keep monotonic against.
    expect(await store.get("meta", "id-1:lastClientSeq")).toBeUndefined();
  });

  it("never touches another identity's data", async () => {
    const store = createInMemoryStore();
    await seedIdentity(store, "id-1");
    await seedIdentity(store, "id-2");

    await clearIdentityScope(store, "id-1");

    expect(await getQueuedMutations(store, "id-2")).toHaveLength(1);
    expect(await readSnapshot(store, "id-2", "s1")).toBeDefined();
  });
});

describe("resolveIdentityKey", () => {
  it("returns undefined when there is no session (no_session)", async () => {
    const key = await resolveIdentityKey({
      getIdentity: async () => ({ kind: "error", message: "no_session" }),
    });
    expect(key).toBeUndefined();
  });

  it("returns undefined when the identity lookup fails (expired/revoked session)", async () => {
    const key = await resolveIdentityKey({
      getIdentity: async () => ({ kind: "error", message: "auth_identity_request_failed" }),
    });
    expect(key).toBeUndefined();
  });

  it("hashes (tenantId, userId) into a stable, context-prefixed key via the injected hash fn", async () => {
    const hash = vi.fn(async (input: string) => `hashed(${input})`);
    const key = await resolveIdentityKey({
      getIdentity: async () => ({ kind: "ok", tenantId: "t1", userId: "u1" }),
      hash,
    });
    expect(hash).toHaveBeenCalledWith("workout-offline:t1:u1");
    expect(key).toBe("hashed(workout-offline:t1:u1)");
  });

  it("is STABLE for the same (tenantId, userId) across repeated calls — never derived from a rotating token", async () => {
    const getIdentity = async () => ({ kind: "ok" as const, tenantId: "t1", userId: "u1" });
    const key1 = await resolveIdentityKey({ getIdentity, hash: async (s) => s });
    const key2 = await resolveIdentityKey({ getIdentity, hash: async (s) => s });
    expect(key1).toBe(key2);
  });

  it("is DISTINCT for different accounts", async () => {
    const keyA = await resolveIdentityKey({
      getIdentity: async () => ({ kind: "ok", tenantId: "t1", userId: "u1" }),
      hash: async (s) => s,
    });
    const keyB = await resolveIdentityKey({
      getIdentity: async () => ({ kind: "ok", tenantId: "t1", userId: "u2" }),
      hash: async (s) => s,
    });
    expect(keyA).not.toBe(keyB);
  });
});
