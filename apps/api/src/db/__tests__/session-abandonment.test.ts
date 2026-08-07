import { describe, expect, it } from "vitest";
import { ABANDONED_SESSION_THRESHOLD_HOURS, abandonedSessionCutoff } from "../session-abandonment.js";

describe("session-abandonment", () => {
  it("ABANDONED_SESSION_THRESHOLD_HOURS is 24", () => {
    expect(ABANDONED_SESSION_THRESHOLD_HOURS).toBe(24);
  });

  it("abandonedSessionCutoff returns exactly 24 hours before now", () => {
    const now = new Date("2026-08-07T12:00:00Z");
    const cutoff = abandonedSessionCutoff(now);
    expect(cutoff.toISOString()).toBe("2026-08-06T12:00:00.000Z");
  });

  it("abandonedSessionCutoff does not mutate the input Date", () => {
    const now = new Date("2026-08-07T12:00:00Z");
    const before = now.getTime();
    abandonedSessionCutoff(now);
    expect(now.getTime()).toBe(before);
  });
});
