import { describe, expect, it } from "vitest";
import { createInMemoryStore } from "../__test-utils__/in-memory-store";
import {
  clearActiveSessionPointer,
  readActiveSessionPointer,
  writeActiveSessionPointer,
} from "../snapshot";

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
