import { describe, expectTypeOf, it } from "vitest";
import type { ClientDashboardDTO, RpeTrendPoint } from "../index";

/**
 * Trainer dashboard read contract (15b-v2, Phase S1). Additive/dark: no
 * existing DTO changes shape. Proves `ClientDashboardDTO`/`RpeTrendPoint`
 * are shaped exactly per design.md's "Interfaces / Contracts" section.
 */
describe("client dashboard contracts (15b-v2 Phase S1)", () => {
  it("defines RpeTrendPoint with a nullable meanRpe gap", () => {
    expectTypeOf<RpeTrendPoint>().toEqualTypeOf<{
      weekStart: string;
      meanRpe: number | null;
      sessionsWithRpe: number;
    }>();
  });

  it("defines ClientDashboardDTO per design's Interfaces/Contracts shape", () => {
    expectTypeOf<ClientDashboardDTO>().toEqualTypeOf<{
      rpeTrend: RpeTrendPoint[];
      completionRate: { periodDays: 28; planned: number; completed: number; percent: number };
      recentSessions: Array<{ date: string; volumeKg: number; meanRpe: number | null }>;
    }>();
  });
});
