import { describe, expect, it } from "vitest";
import { computeAdherenceAdaptation } from "./adherence-adaptation.js";

// Reference "now": Wed 2026-07-29 12:00 UTC.
// Default 4-week window => windowStart = startOfUtcDay(now) - 28d = 2026-07-01T00:00:00.000Z.
const NOW = new Date("2026-07-29T12:00:00.000Z");
const WINDOW_START_ISO = "2026-07-01T00:00:00.000Z";
// An "old" plan created before the window so the insufficient-data age guard passes.
const OLD_PLAN_CREATED_AT = "2026-01-01T00:00:00.000Z";

/** Build N distinct in-window ISO timestamps (one per day starting 2026-07-02). */
function inWindowCompletions(count: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const day = String(2 + i).padStart(2, "0");
    out.push(`2026-07-${day}T09:00:00.000Z`);
  }
  return out;
}

describe("computeAdherenceAdaptation", () => {
  it("marks 5 of 16 planned in 4 weeks (~31%) as low and suggests reduce_frequency 4→3", () => {
    const result = computeAdherenceAdaptation(
      {
        completedAtDates: inWindowCompletions(5),
        plannedSessionsPerWeek: 4,
        planCreatedAt: OLD_PLAN_CREATED_AT,
      },
      NOW
    );

    expect(result.source).toBe("adherence");
    expect(result.level).toBe("low");
    expect(result.adherence).toEqual({
      adherence: 5 / 16,
      periodWeeks: 4,
      completedInWindow: 5,
      plannedInWindow: 16,
    });
    expect(result.suggestedChange).toEqual({
      kind: "reduce_frequency",
      fromDays: 4,
      toDays: 3,
    });
    expect(result.adherence!.adherence).toBeCloseTo(0.3125, 5);
  });

  it("marks adherence at exactly the 70% threshold as ok with no suggestedChange", () => {
    // plannedSessionsPerWeek=5, periodWeeks=4 => planned=20; 14/20 = 0.70 exactly.
    const result = computeAdherenceAdaptation(
      {
        completedAtDates: inWindowCompletions(14),
        plannedSessionsPerWeek: 5,
        planCreatedAt: OLD_PLAN_CREATED_AT,
      },
      NOW
    );

    expect(result.level).toBe("ok");
    expect(result.adherence!.adherence).toBe(0.7);
    expect(result.suggestedChange).toBeUndefined();
  });

  it("marks adherence above the threshold as ok with no suggestedChange", () => {
    // 15/20 = 0.75 >= 0.70.
    const result = computeAdherenceAdaptation(
      {
        completedAtDates: inWindowCompletions(15),
        plannedSessionsPerWeek: 5,
        planCreatedAt: OLD_PLAN_CREATED_AT,
      },
      NOW
    );

    expect(result.level).toBe("ok");
    expect(result.suggestedChange).toBeUndefined();
  });

  it("floors the reduction at 1: a low plan already at 1 day/week carries no suggestedChange", () => {
    // plannedSessionsPerWeek=1, periodWeeks=4 => planned=4; 0/4 = 0 => low, but toDays=max(1,0)=1 not < fromDays.
    const result = computeAdherenceAdaptation(
      {
        completedAtDates: [],
        plannedSessionsPerWeek: 1,
        planCreatedAt: OLD_PLAN_CREATED_AT,
      },
      NOW
    );

    expect(result.level).toBe("low");
    expect(result.suggestedChange).toBeUndefined();
    expect(result.adherence).toEqual({
      adherence: 0,
      periodWeeks: 4,
      completedInWindow: 0,
      plannedInWindow: 4,
    });
  });

  it("clamps adherence to 1 when more sessions were completed than planned", () => {
    // plannedSessionsPerWeek=2, periodWeeks=4 => planned=8; 10 completed in window => 10/8 clamps to 1.
    const result = computeAdherenceAdaptation(
      {
        completedAtDates: inWindowCompletions(10),
        plannedSessionsPerWeek: 2,
        planCreatedAt: OLD_PLAN_CREATED_AT,
      },
      NOW
    );

    expect(result.level).toBe("ok");
    expect(result.adherence).toEqual({
      adherence: 1,
      periodWeeks: 4,
      completedInWindow: 10,
      plannedInWindow: 8,
    });
    expect(result.suggestedChange).toBeUndefined();
  });

  it("counts a completion exactly at the window start (now - periodWeeks*7d) as in-window", () => {
    const result = computeAdherenceAdaptation(
      {
        // one exactly at the boundary, one 1ms before (excluded).
        completedAtDates: [WINDOW_START_ISO, "2026-06-30T23:59:59.999Z"],
        plannedSessionsPerWeek: 4,
        planCreatedAt: OLD_PLAN_CREATED_AT,
      },
      NOW
    );

    expect(result.adherence!.completedInWindow).toBe(1);
  });

  it("ignores completions after `now`", () => {
    const result = computeAdherenceAdaptation(
      {
        completedAtDates: ["2026-07-30T09:00:00.000Z"], // after NOW
        plannedSessionsPerWeek: 4,
        planCreatedAt: OLD_PLAN_CREATED_AT,
      },
      NOW
    );

    expect(result.adherence!.completedInWindow).toBe(0);
  });

  describe("insufficient_data guards", () => {
    it("returns insufficient_data when plannedSessionsPerWeek is 0 (no division by zero)", () => {
      const result = computeAdherenceAdaptation(
        {
          completedAtDates: inWindowCompletions(3),
          plannedSessionsPerWeek: 0,
          planCreatedAt: OLD_PLAN_CREATED_AT,
        },
        NOW
      );

      expect(result.level).toBe("insufficient_data");
      expect(result.adherence).toBeUndefined();
      expect(result.suggestedChange).toBeUndefined();
    });

    it("returns insufficient_data when plannedSessionsPerWeek is negative", () => {
      const result = computeAdherenceAdaptation(
        {
          completedAtDates: [],
          plannedSessionsPerWeek: -2,
          planCreatedAt: OLD_PLAN_CREATED_AT,
        },
        NOW
      );

      expect(result.level).toBe("insufficient_data");
    });

    it("returns insufficient_data when planCreatedAt is missing", () => {
      const result = computeAdherenceAdaptation(
        {
          completedAtDates: inWindowCompletions(1),
          plannedSessionsPerWeek: 4,
        },
        NOW
      );

      expect(result.level).toBe("insufficient_data");
      expect(result.adherence).toBeUndefined();
      expect(result.suggestedChange).toBeUndefined();
    });

    it("returns insufficient_data for a plan younger than the window (new user, 0% not treated as low)", () => {
      const result = computeAdherenceAdaptation(
        {
          completedAtDates: [],
          plannedSessionsPerWeek: 4,
          // created 2026-07-20, after the 2026-07-01 window start => younger than the window.
          planCreatedAt: "2026-07-20T00:00:00.000Z",
        },
        NOW
      );

      expect(result.level).toBe("insufficient_data");
      expect(result.suggestedChange).toBeUndefined();
    });

    it("does NOT treat a plan created exactly at the window start as too recent", () => {
      const result = computeAdherenceAdaptation(
        {
          completedAtDates: [],
          plannedSessionsPerWeek: 4,
          planCreatedAt: WINDOW_START_ISO,
        },
        NOW
      );

      // 0/16 => low, not insufficient (plan is exactly one full window old).
      expect(result.level).toBe("low");
    });
  });

  it("honors a custom periodWeeks window", () => {
    // periodWeeks=2 => windowStart = 2026-07-15; plannedInWindow = 4*2 = 8.
    const result = computeAdherenceAdaptation(
      {
        completedAtDates: [
          "2026-07-20T09:00:00.000Z", // in the 2-week window
          "2026-07-10T09:00:00.000Z", // before the 2-week window
        ],
        plannedSessionsPerWeek: 4,
        planCreatedAt: OLD_PLAN_CREATED_AT,
        periodWeeks: 2,
      },
      NOW
    );

    expect(result.adherence).toEqual({
      adherence: 1 / 8,
      periodWeeks: 2,
      completedInWindow: 1,
      plannedInWindow: 8,
    });
    expect(result.level).toBe("low");
  });
});
