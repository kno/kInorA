import { describe, it, expect, vi } from "vitest";
import { AdminStatsRepository } from "../admin-stats.js";

/**
 * Hermetic unit coverage for `AdminStatsRepository` over a fake drizzle
 * `Database`, driven entirely through the two public/route-facing entry
 * points (`getPlatformStats`, which internally calls the private
 * `getRetentionFunnel`). `startOfIsoWeekUtc`, `emptyRetentionSteps`,
 * `emptyTierTally`, and `emptyFeatureTally` are module-private helpers with
 * no other seam — this suite exercises them through that public surface.
 *
 * `getPlatformStats` issues 8 aggregate queries, then the retention funnel
 * issues 3 more (a subquery definition + 2 further reads) — 11 `db.select()`
 * calls total, always in the same fixed order. `makeChain` below is a
 * generic, spy-able drizzle-chain fake: every fluent method (`from`, `where`,
 * `leftJoin`, `innerJoin`, `groupBy`, `orderBy`, `as`) returns the same
 * chainable object, and the chain is thenable so `await` resolves at
 * whichever point the source code stops chaining — mirroring how drizzle's
 * real query builder is thenable at every step.
 */

interface ChainConfig {
  /** Rows this select ultimately resolves to when awaited. */
  resolves?: unknown[];
  /** Properties exposed by `.as(...)`, used when this chain backs a subquery. */
  asProps?: Record<string, unknown>;
}

function makeChain(config: ChainConfig) {
  const rows = config.resolves ?? [];
  const whereSpy = vi.fn();
  const chain: Record<string, unknown> = {
    from: vi.fn().mockImplementation(() => chain),
    where: vi.fn().mockImplementation((...args: unknown[]) => {
      whereSpy(...args);
      return chain;
    }),
    leftJoin: vi.fn().mockImplementation(() => chain),
    innerJoin: vi.fn().mockImplementation(() => chain),
    groupBy: vi.fn().mockImplementation(() => chain),
    orderBy: vi.fn().mockImplementation(() => chain),
    as: vi.fn().mockImplementation(() => config.asProps ?? {}),
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject),
    catch: (reject: (e: unknown) => unknown) => Promise.resolve(rows).catch(reject),
  };
  return { chain, whereSpy };
}

/**
 * Builds a fake `Database` whose `select()` calls hand back one configured
 * chain per call, in call order. `chains[i].whereSpy` lets a test inspect the
 * exact condition object passed to the i-th query's `.where(...)`.
 */
function makeDb(configs: ChainConfig[]) {
  const built = configs.map(makeChain);
  let i = 0;
  const select = vi.fn().mockImplementation(() => {
    const entry = built[i] ?? built[built.length - 1];
    i++;
    return entry.chain;
  });
  return { select, chains: built };
}

/** The fixed, empty-result configs for all 11 selects `getPlatformStats` issues. */
function emptyConfigs(): ChainConfig[] {
  return [
    { resolves: [] }, // 1: tenantCounts
    { resolves: [] }, // 2: userCounts
    { resolves: [] }, // 3: roleRows
    { resolves: [] }, // 4: billingScalars
    { resolves: [] }, // 5: activeOverrideRows
    { resolves: [] }, // 6: tenantBillingRows
    { resolves: [] }, // 7: usageRows
    { resolves: [] }, // 8: obsCounts
    { asProps: perUserAsProps() }, // 9: perUser subquery definition
    { resolves: [] }, // 10: cohortRows
    { resolves: [] }, // 11: abandoned
  ];
}

/** Dummy properties for the `perUser` subquery alias — values are never evaluated by the fake. */
function perUserAsProps(): Record<string, unknown> {
  return {
    cohortWeek: "cohort_week_col",
    trainerSponsored: "trainer_sponsored_col",
    hasPlan: "has_plan_col",
    firstCompletedAt: "first_completed_at_col",
    secondCompletedAt: "second_completed_at_col",
    trainedWeek2: "trained_week2_col",
    trainedWeek4: "trained_week4_col",
  };
}

/**
 * Extract the bound `Date` value out of a drizzle condition object (e.g. the
 * result of `gte(column, someDate)`). Against a REAL schema column drizzle
 * wraps the value in an internal `Param` node (`{ value: Date }`) rather than
 * embedding the `Date` directly in `queryChunks` — unlike the plain-object
 * column stand-ins used in lighter drizzle-chain tests elsewhere.
 */
function extractParamDate(condition: { queryChunks: unknown[] }): Date | undefined {
  for (const chunk of condition.queryChunks) {
    const value = (chunk as { value?: unknown } | undefined)?.value;
    if (value instanceof Date) return value;
  }
  return undefined;
}

describe("AdminStatsRepository.getPlatformStats", () => {
  it("returns fully zero-filled tallies (every tier/feature/retention-step key present at 0) on an empty database", async () => {
    const { select } = makeDb(emptyConfigs());
    const repo = new AdminStatsRepository({ select } as never);

    const stats = await repo.getPlatformStats(new Date("2026-07-15T12:00:00Z"));

    // emptyTierTally: all four billing tiers present, not an empty object.
    expect(stats.billing.effectiveTier).toEqual({ free: 0, pro: 0, trainer: 0, gym: 0 });
    expect(stats.billing.activeOverridesByTier).toEqual({ free: 0, pro: 0, trainer: 0, gym: 0 });
    // emptyFeatureTally: all four metered features present.
    expect(stats.usage.byFeature).toEqual({
      plan_generation: 0,
      plan_regeneration: 0,
      memory_write: 0,
      memory_retrieval: 0,
    });
    // emptyRetentionSteps, reached through the reduce seed with zero cohorts.
    expect(stats.retention.totals).toEqual({
      signups: 0,
      createdPlan: 0,
      completedFirstWorkout: 0,
      completedSecondWorkoutWithin7d: 0,
      activeWeek2: 0,
      activeWeek4: 0,
      trainerSponsoredSignups: 0,
    });
    expect(stats.retention.cohorts).toEqual([]);
    expect(stats.retention.abandonedSessions).toBe(0);
    expect(stats.tenants).toEqual({ total: 0, signups7d: 0, signups30d: 0 });
    expect(stats.memberships.activeByRole).toEqual({ owner: 0, member: 0, trainer: 0 });
  });

  it("tallies effectiveTier/activeOverridesByTier/byFeature/activeByRole from real rows (not just the zero seed)", async () => {
    const configs = emptyConfigs();
    configs[2] = { resolves: [{ role: "trainer", c: 3 }, { role: "owner", c: 5 }] }; // roleRows
    configs[4] = {
      resolves: [
        { tenantId: "tenant-override-1", tier: "gym" },
        { tenantId: "tenant-override-2", tier: "gym" },
        // duplicate tenant: defensively kept as the FIRST tier seen for the map,
        // but every row still counts once in the grouped tally.
        { tenantId: "tenant-override-1", tier: "pro" },
      ],
    }; // activeOverrideRows
    configs[6] = {
      resolves: [
        { feature: "plan_generation", total: 12 },
        { feature: "memory_write", total: 4 },
      ],
    }; // usageRows
    const { select } = makeDb(configs);
    const repo = new AdminStatsRepository({ select } as never);

    const stats = await repo.getPlatformStats(new Date("2026-07-15T12:00:00Z"));

    expect(stats.memberships.activeByRole).toEqual({ owner: 5, member: 0, trainer: 3 });
    // 3 rows total (2 x gym, 1 x pro for a duplicate tenant): the grouped
    // tally counts every ROW, independent of the per-tenant dedupe used
    // elsewhere for `overrideByTenant`.
    expect(stats.billing.activeOverridesByTier).toEqual({ free: 0, pro: 1, trainer: 0, gym: 2 });
    expect(stats.usage.byFeature).toEqual({
      plan_generation: 12,
      plan_regeneration: 0,
      memory_write: 4,
      memory_retrieval: 0,
    });
  });

  it("sums cohort rows into retention.totals and preserves the empty-step keys as the reduce seed", async () => {
    const configs = emptyConfigs();
    configs[9] = {
      resolves: [
        {
          weekStart: "2026-07-06",
          signups: 10,
          createdPlan: 8,
          completedFirstWorkout: 5,
          completedSecondWorkoutWithin7d: 3,
          activeWeek2: 2,
          activeWeek4: 1,
          trainerSponsoredSignups: 1,
        },
        {
          weekStart: "2026-06-29",
          signups: 4,
          createdPlan: 2,
          completedFirstWorkout: 1,
          completedSecondWorkoutWithin7d: 1,
          activeWeek2: 0,
          activeWeek4: 0,
          trainerSponsoredSignups: 0,
        },
      ],
    }; // cohortRows
    configs[10] = { resolves: [{ total: 7 }] }; // abandoned
    const { select } = makeDb(configs);
    const repo = new AdminStatsRepository({ select } as never);

    const stats = await repo.getPlatformStats(new Date("2026-07-15T12:00:00Z"));

    expect(stats.retention.totals).toEqual({
      signups: 14,
      createdPlan: 10,
      completedFirstWorkout: 6,
      completedSecondWorkoutWithin7d: 4,
      activeWeek2: 2,
      activeWeek4: 1,
      trainerSponsoredSignups: 1,
    });
    expect(stats.retention.cohorts).toHaveLength(2);
    expect(stats.retention.abandonedSessions).toBe(7);
  });

  it("startOfIsoWeekUtc: the retention window's lower bound is the Monday 00:00 UTC eleven ISO-weeks before `now`'s Monday (mid-week `now` does not shift it)", async () => {
    const { select, chains } = makeDb(emptyConfigs());
    const repo = new AdminStatsRepository({ select } as never);

    // Wednesday 2026-07-15T12:00:00Z. Its ISO week starts Monday 2026-07-13.
    const now = new Date("2026-07-15T12:00:00Z");
    await repo.getPlatformStats(now);

    // Query #9 (0-indexed 8) is the perUser subquery: `.where(gte(users.createdAt, windowStart))`.
    const perUserWhereSpy = chains[8].whereSpy;
    expect(perUserWhereSpy).toHaveBeenCalledTimes(1);
    const condition = perUserWhereSpy.mock.calls[0][0] as { queryChunks: unknown[] };
    const capturedDate = extractParamDate(condition);
    expect(capturedDate).toBeDefined();

    // windowStart = Monday(now) - 11 whole weeks = 2026-07-13 - 77 days = 2026-04-27.
    const expectedWindowStart = new Date("2026-04-27T00:00:00.000Z");
    expect(capturedDate!.toISOString()).toBe(expectedWindowStart.toISOString());
  });

  it("startOfIsoWeekUtc: a Sunday `now` belongs to the PREVIOUS Monday's ISO week (Sunday is day 7, not day 0, of that week)", async () => {
    const { select, chains } = makeDb(emptyConfigs());
    const repo = new AdminStatsRepository({ select } as never);

    // Sunday 2026-07-19T00:00:00Z belongs to the ISO week starting Monday 2026-07-13.
    const now = new Date("2026-07-19T00:00:00Z");
    await repo.getPlatformStats(now);

    const perUserWhereSpy = chains[8].whereSpy;
    const condition = perUserWhereSpy.mock.calls[0][0] as { queryChunks: unknown[] };
    const capturedDate = extractParamDate(condition);

    const expectedWindowStart = new Date("2026-04-27T00:00:00.000Z");
    expect(capturedDate!.toISOString()).toBe(expectedWindowStart.toISOString());
  });
});
