import { describe, it, expect, beforeEach } from "vitest";
import type { WorkoutSessionRecord } from "@kinora/contracts";
import { createInMemoryOfflineStore } from "../__test-utils__/in-memory-store";
import {
  writeSnapshot,
  readSnapshot,
  clearSnapshot,
  applyOptimisticComplete,
} from "../snapshot";

const IDENTITY = "identity-a";

const activeSession: WorkoutSessionRecord = {
  id: "session-1",
  workoutPlanId: "plan-1",
  status: "active",
  startedAt: "2026-07-06T09:00:00.000Z",
  exercises: [],
};

describe("writeSnapshot / readSnapshot / clearSnapshot", () => {
  let store: ReturnType<typeof createInMemoryOfflineStore>;

  beforeEach(() => {
    store = createInMemoryOfflineStore();
  });

  it("round-trips a session snapshot keyed by (identity, sessionId)", async () => {
    await writeSnapshot(store, IDENTITY, "session-1", activeSession);

    const snapshot = await readSnapshot(store, IDENTITY, "session-1");

    expect(snapshot?.session).toEqual(activeSession);
    expect(snapshot?.sessionId).toBe("session-1");
  });

  it("returns undefined when no snapshot has been written for that session", async () => {
    const snapshot = await readSnapshot(store, IDENTITY, "session-missing");
    expect(snapshot).toBeUndefined();
  });

  it("evicts the cached snapshot once the session is completed AND synced", async () => {
    await writeSnapshot(store, IDENTITY, "session-1", activeSession);

    await clearSnapshot(store, IDENTITY, "session-1");

    expect(await readSnapshot(store, IDENTITY, "session-1")).toBeUndefined();
  });
});

describe("applyOptimisticComplete", () => {
  it("flips session.status to completed WITHOUT waiting for server ack", () => {
    const snapshot = {
      sessionId: "session-1",
      session: activeSession,
      cachedAt: 100,
    };

    const result = applyOptimisticComplete(snapshot);

    expect(result.session.status).toBe("completed");
    // The original snapshot object must not be mutated in place.
    expect(snapshot.session.status).toBe("active");
  });
});
