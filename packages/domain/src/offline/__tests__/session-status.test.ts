import { describe, it, expect } from "vitest";
import { isTerminalSessionStatus } from "../session-status.js";

/**
 * The predicate that decides whether a cached session may be hydrated as the
 * tracker's active session (#398). Getting this wrong strands the user on a
 * tracker with no navigation escape, so the bias is deliberate: only
 * `"active"` is resumable.
 */
describe("isTerminalSessionStatus", () => {
  it("treats an active session as NOT terminal, so offline resume keeps working", () => {
    expect(isTerminalSessionStatus("active")).toBe(false);
  });

  it("treats a completed session as terminal", () => {
    expect(isTerminalSessionStatus("completed")).toBe(true);
  });

  it("treats an abandoned session as terminal (explicit discard / 24h auto-close)", () => {
    expect(isTerminalSessionStatus("abandoned")).toBe(true);
  });

  it("treats an unrecognised status as terminal — an unknown status is never resumable", () => {
    expect(isTerminalSessionStatus("paused" as never)).toBe(true);
  });
});
