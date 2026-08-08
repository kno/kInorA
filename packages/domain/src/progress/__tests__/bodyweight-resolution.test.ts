import { describe, expect, it } from "vitest";
import { resolveBodyweightForSession, type BodyweightEntry } from "../bodyweight-resolution.js";

/**
 * `resolveBodyweightForSession` (17c-profile-body-metrics, PR 4) — the full
 * behavior table from design.md "The weight resolution rule": nearest
 * reading at-or-before the session, falling back to the earliest reading
 * when the session predates every entry. Pure — no I/O.
 */
describe("resolveBodyweightForSession", () => {
  it("returns undefined when the user has zero weight entries", () => {
    expect(resolveBodyweightForSession([], "2026-06-01T00:00:00.000Z")).toBeUndefined();
  });

  it("resolves the latest reading at or before the session when one exists", () => {
    const entries: BodyweightEntry[] = [
      { weightKg: 80, recordedAt: "2026-04-01T00:00:00.000Z" },
      { weightKg: 78, recordedAt: "2026-05-01T00:00:00.000Z" },
      { weightKg: 90, recordedAt: "2026-07-01T00:00:00.000Z" },
    ];

    expect(resolveBodyweightForSession(entries, "2026-06-01T00:00:00.000Z")).toBe(78);
  });

  it("falls back to the earliest reading when the session predates every entry", () => {
    const entries: BodyweightEntry[] = [
      { weightKg: 80, recordedAt: "2026-07-01T00:00:00.000Z" },
      { weightKg: 82, recordedAt: "2026-08-01T00:00:00.000Z" },
    ];

    expect(resolveBodyweightForSession(entries, "2026-01-01T00:00:00.000Z")).toBe(80);
  });

  it("is inclusive when the session lands exactly on a reading's instant", () => {
    const entries: BodyweightEntry[] = [
      { weightKg: 79, recordedAt: "2026-05-01T00:00:00.000Z" },
    ];

    expect(resolveBodyweightForSession(entries, "2026-05-01T00:00:00.000Z")).toBe(79);
  });

  it("picks the later-inserted entry among two readings at the same instant", () => {
    const entries: BodyweightEntry[] = [
      { weightKg: 80, recordedAt: "2026-05-01T00:00:00.000Z" },
      { weightKg: 81, recordedAt: "2026-05-01T00:00:00.000Z" },
    ];

    expect(resolveBodyweightForSession(entries, "2026-05-01T00:00:00.000Z")).toBe(81);
  });

  it("does not let a later weigh-in rewrite an already-resolved older session", () => {
    // A session on 2026-05-01 already resolved against the 2026-04-01 entry.
    // Adding a 2026-06-01 entry afterward must not change that resolution —
    // only sessions AFTER 2026-06-01 are affected by the new reading.
    const beforeNewEntry: BodyweightEntry[] = [
      { weightKg: 80, recordedAt: "2026-04-01T00:00:00.000Z" },
    ];
    const afterNewEntry: BodyweightEntry[] = [
      ...beforeNewEntry,
      { weightKg: 76, recordedAt: "2026-06-01T00:00:00.000Z" },
    ];

    const mayResolution = resolveBodyweightForSession(beforeNewEntry, "2026-05-01T00:00:00.000Z");
    expect(mayResolution).toBe(80);
    expect(resolveBodyweightForSession(afterNewEntry, "2026-05-01T00:00:00.000Z")).toBe(mayResolution);
  });
});
