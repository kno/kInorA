import { describe, expect, it } from "vitest";
import type { WorkoutSessionRecord } from "@kinora/contracts";
import { createInMemoryStore } from "../__test-utils__/in-memory-store";
import {
  applyOptimisticComplete,
  clearSnapshot,
  readSnapshot,
  writeSnapshot,
} from "../snapshot";

const session: WorkoutSessionRecord = {
  id: "s1",
  workoutPlanId: "p1",
  status: "active",
  startedAt: "2026-07-16T10:00:00.000Z",
  exercises: [],
};

describe("writeSnapshot / readSnapshot / clearSnapshot", () => {
  it("round-trips a snapshot for a session", async () => {
    const store = createInMemoryStore();
    await writeSnapshot(store, "id-1", "s1", session);
    const snapshot = await readSnapshot(store, "id-1", "s1");
    expect(snapshot?.session).toEqual(session);
    expect(snapshot?.sessionId).toBe("s1");
    expect(typeof snapshot?.cachedAt).toBe("number");
  });

  it("returns undefined for a missing session snapshot", async () => {
    const store = createInMemoryStore();
    expect(await readSnapshot(store, "id-1", "unknown")).toBeUndefined();
  });

  it("scopes snapshots by identityKey", async () => {
    const store = createInMemoryStore();
    await writeSnapshot(store, "id-1", "s1", session);
    expect(await readSnapshot(store, "id-2", "s1")).toBeUndefined();
  });

  it("clears a snapshot", async () => {
    const store = createInMemoryStore();
    await writeSnapshot(store, "id-1", "s1", session);
    await clearSnapshot(store, "id-1", "s1");
    expect(await readSnapshot(store, "id-1", "s1")).toBeUndefined();
  });
});

describe("applyOptimisticComplete", () => {
  it("flips session.status to completed without mutating the input", () => {
    const store_snapshot = {
      sessionId: "s1",
      session,
      cachedAt: 1000,
    };
    const result = applyOptimisticComplete(store_snapshot);
    expect(result.session.status).toBe("completed");
    expect(store_snapshot.session.status).toBe("active");
  });
});
