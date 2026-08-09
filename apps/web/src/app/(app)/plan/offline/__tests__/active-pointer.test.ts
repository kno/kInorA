import { describe, it, expect, beforeEach } from "vitest";
import type { WorkoutSessionRecord } from "@kinora/contracts";
import { createInMemoryOfflineStore } from "../__test-utils__/in-memory-store";
import {
  writeActiveSessionPointer,
  readActiveSessionPointer,
  clearActiveSessionPointer,
  discardTerminalSession,
  writeSnapshot,
  readSnapshot,
} from "../snapshot";

/**
 * The "active session pointer" tells offline hydration WHICH cached
 * snapshot to read on mount, since the tracker only learns a `sessionId`
 * after a session is started/resumed — there is exactly one active session
 * per identity at a time (the existing 409 active_session_conflict rule).
 */

const IDENTITY = "identity-a";

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


describe("writeActiveSessionPointer / readActiveSessionPointer / clearActiveSessionPointer", () => {
  let store: ReturnType<typeof createInMemoryOfflineStore>;

  beforeEach(() => {
    store = createInMemoryOfflineStore();
  });

  it("round-trips the active sessionId for an identity", async () => {
    await writeActiveSessionPointer(store, IDENTITY, "session-1");

    expect(await readActiveSessionPointer(store, IDENTITY)).toBe("session-1");
  });

  it("returns undefined when no active session pointer has been set", async () => {
    expect(await readActiveSessionPointer(store, IDENTITY)).toBeUndefined();
  });

  it("clears the pointer so a completed+synced session is no longer treated as active", async () => {
    await writeActiveSessionPointer(store, IDENTITY, "session-1");

    await clearActiveSessionPointer(store, IDENTITY);

    expect(await readActiveSessionPointer(store, IDENTITY)).toBeUndefined();
  });
});

describe("discardTerminalSession", () => {
  let store: ReturnType<typeof createInMemoryOfflineStore>;

  beforeEach(() => {
    store = createInMemoryOfflineStore();
  });

  it("drops the snapshot and the pointer when the pointer names the discarded session", async () => {
    await writeSnapshot(store, IDENTITY, "session-1", session("session-1"));
    await writeActiveSessionPointer(store, IDENTITY, "session-1");

    await discardTerminalSession(store, IDENTITY, "session-1");

    expect(await readSnapshot(store, IDENTITY, "session-1")).toBeUndefined();
    expect(await readActiveSessionPointer(store, IDENTITY)).toBeUndefined();
  });

  it("leaves a NEWER session's pointer alone while dropping the old snapshot", async () => {
    await writeSnapshot(store, IDENTITY, "session-1", session("session-1"));
    await writeActiveSessionPointer(store, IDENTITY, "session-2");

    await discardTerminalSession(store, IDENTITY, "session-1");

    expect(await readSnapshot(store, IDENTITY, "session-1")).toBeUndefined();
    expect(await readActiveSessionPointer(store, IDENTITY)).toBe("session-2");
  });

  it("is a safe no-op when there is nothing left to discard", async () => {
    await expect(discardTerminalSession(store, IDENTITY, "session-1")).resolves.toBeUndefined();
    expect(await readActiveSessionPointer(store, IDENTITY)).toBeUndefined();
  });
});
