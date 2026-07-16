import { describe, it, expect, beforeEach } from "vitest";
import { createInMemoryOfflineStore } from "../__test-utils__/in-memory-store";
import {
  writeActiveSessionPointer,
  readActiveSessionPointer,
  clearActiveSessionPointer,
} from "../snapshot";

/**
 * The "active session pointer" tells offline hydration WHICH cached
 * snapshot to read on mount, since the tracker only learns a `sessionId`
 * after a session is started/resumed — there is exactly one active session
 * per identity at a time (the existing 409 active_session_conflict rule).
 */

const IDENTITY = "identity-a";

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
