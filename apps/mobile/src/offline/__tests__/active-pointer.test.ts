import { describe, expect, it } from "vitest";
import type { WorkoutSessionRecord } from "@kinora/contracts";
import { createInMemoryStore } from "../__test-utils__/in-memory-store";
import {
  clearActiveSessionPointer,
  discardTerminalSession,
  readActiveSessionPointer,
  readSnapshot,
  writeActiveSessionPointer,
  writeSnapshot,
} from "../snapshot";

function session(id: string): WorkoutSessionRecord {
  return {
    id,
    workoutPlanId: "plan-1",
    status: "completed",
    startedAt: "2026-08-07T09:00:00.000Z",
    day: 1,
    exercises: [],
  };
}

describe("active session pointer", () => {
  it("round-trips the pointer for an identity", async () => {
    const store = createInMemoryStore();
    await writeActiveSessionPointer(store, "id-1", "s1");
    expect(await readActiveSessionPointer(store, "id-1")).toBe("s1");
  });

  it("returns undefined when no pointer has been written", async () => {
    const store = createInMemoryStore();
    expect(await readActiveSessionPointer(store, "id-1")).toBeUndefined();
  });

  it("scopes the pointer by identityKey", async () => {
    const store = createInMemoryStore();
    await writeActiveSessionPointer(store, "id-1", "s1");
    expect(await readActiveSessionPointer(store, "id-2")).toBeUndefined();
  });

  it("clears the pointer", async () => {
    const store = createInMemoryStore();
    await writeActiveSessionPointer(store, "id-1", "s1");
    await clearActiveSessionPointer(store, "id-1");
    expect(await readActiveSessionPointer(store, "id-1")).toBeUndefined();
  });
});

describe("discardTerminalSession", () => {
  it("drops the snapshot and the pointer when the pointer names the discarded session", async () => {
    const store = createInMemoryStore();
    await writeSnapshot(store, "id-1", "s1", session("s1"));
    await writeActiveSessionPointer(store, "id-1", "s1");

    await discardTerminalSession(store, "id-1", "s1");

    expect(await readSnapshot(store, "id-1", "s1")).toBeUndefined();
    expect(await readActiveSessionPointer(store, "id-1")).toBeUndefined();
  });

  it("leaves a NEWER session's pointer alone while dropping the old snapshot", async () => {
    const store = createInMemoryStore();
    await writeSnapshot(store, "id-1", "s1", session("s1"));
    await writeActiveSessionPointer(store, "id-1", "s2");

    await discardTerminalSession(store, "id-1", "s1");

    expect(await readSnapshot(store, "id-1", "s1")).toBeUndefined();
    expect(await readActiveSessionPointer(store, "id-1")).toBe("s2");
  });

  it("is a safe no-op when there is nothing left to discard", async () => {
    const store = createInMemoryStore();
    await expect(discardTerminalSession(store, "id-1", "s1")).resolves.toBeUndefined();
    expect(await readActiveSessionPointer(store, "id-1")).toBeUndefined();
  });
});
