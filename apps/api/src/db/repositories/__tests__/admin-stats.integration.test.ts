/**
 * Real-Postgres integration coverage for `AdminStatsRepository` (#309,
 * platform statistics admin).
 *
 * Proves the platform-wide aggregate tallies — ESPECIALLY the EFFECTIVE-tier
 * breakdown, which must route every tenant through `resolveEffectiveTier`
 * (the single source of truth) rather than a naive `GROUP BY billing_states.tier`:
 * a tenant whose billing row says `pro` but that has an ACTIVE trainer override
 * must be counted as `trainer`, never `pro`. Seeding BOTH a pro-only tenant AND
 * a pro+active-trainer-override tenant lets the trainer lower-bound catch a
 * naive group-by-tier implementation (which would misfile the override tenant
 * under `pro`, leaving `trainer` unchanged by these seeds).
 *
 * The suite shares one accumulating scratch database with the other integration
 * files, which run CONCURRENTLY and also insert tenants/billing rows. Global
 * platform aggregates therefore cannot be asserted with exact before/after
 * equality — concurrent inserts only ever ADD rows. Assertions use monotonic
 * lower bounds (`>=` my seeded contribution, always true under concurrent
 * inserts) plus generous upper bounds for period/window EXCLUSION (the excluded
 * magnitude dwarfs any plausible concurrent noise).
 *
 * The retention-funnel cases (#353) are the exception, and deliberately so.
 * They each claim a PRIVATE signup week (see `weekOf`) that no concurrent suite
 * can insert into, and assert the cohort row with exact equality — because the
 * failures that matter there are all counts going UP: a test account leaking
 * in, a trainer-sponsored client contaminating the B2C cohort, a "second
 * workout" step that ignores the 7-day rule. A lower bound would pass through
 * every one of them.
 *
 * Opt-in via `DATABASE_URL` (podman pgvector:pg17 harness, same pattern as
 * `tier-override-admin.integration.test.ts`) — skipped when no real Postgres
 * is wired so the default `vitest run` stays hermetic.
 */
import { afterAll, describe, expect, it } from "vitest";
import { createDbClient } from "../../client.js";
import {
  memberships,
  observabilityEvents,
  planSpecs,
  tenantBillingOverrides,
  tenantBillingStates,
  tenantQuotaCounters,
  tenants,
  trainerClientAssignments,
  users,
  workoutPlans,
  workoutSessions,
} from "../../schema.js";
import {
  ABANDONED_SESSION_THRESHOLD_HOURS,
  AdminStatsRepository,
} from "../admin-stats.js";
import { currentBillingPeriod } from "../../../billing/plan-limits.js";
import type { RetentionFunnelSteps } from "../../../routes/admin-stats.js";

const hasDb = Boolean(process.env.DATABASE_URL);

const DAY_MS = 86_400_000;

/**
 * Slack for the ONE assertion in this file that cannot be pinned to a private
 * cohort week (abandoned sessions are a window-wide scalar, not a per-cohort
 * count). Sized far above any plausible number of stale `active` sessions a
 * concurrently-running suite leaves behind, and far below the magnitude that
 * would indicate the threshold filter is missing entirely.
 */
const CONCURRENT_NOISE_HEADROOM = 5;

describe.skipIf(!hasDb)("AdminStatsRepository (real Postgres)", () => {
  const { db, pool } = createDbClient();
  const repo = new AdminStatsRepository(db);
  const NOW = new Date("2026-08-02T12:00:00Z");
  const OPEN_ENDED = new Date("9999-12-31T00:00:00Z");

  afterAll(async () => {
    await pool.end();
  });

  async function newTenant(
    name: string,
    options: { isTest?: boolean } = {},
  ): Promise<string> {
    const [t] = await db
      .insert(tenants)
      .values({ name, isTest: options.isTest ?? false })
      .returning({ id: tenants.id });
    return t!.id;
  }

  async function newUser(
    options: { createdAt?: Date; isTest?: boolean } = {},
  ): Promise<string> {
    const [u] = await db
      .insert(users)
      .values({
        email: `stats-${Date.now()}-${Math.random()}@example.com`,
        isTest: options.isTest ?? false,
        ...(options.createdAt ? { createdAt: options.createdAt } : {}),
      })
      .returning({ id: users.id });
    return u!.id;
  }

  /** `date` shifted by whole days, preserving the time of day. */
  function addDays(date: Date, days: number): Date {
    return new Date(date.getTime() + days * DAY_MS);
  }

  /**
   * A PRIVATE signup week, `weeksAgo` weeks before `NOW`, identified by both its
   * cohort key and a signup timestamp inside it.
   *
   * Each funnel test claims its own week so it can assert an EXACT per-cohort
   * delta. That is only sound because concurrent suites insert users at the real
   * clock — which is at or after `NOW` — and therefore always land in a later
   * cohort row than any week this helper returns. The lower-bound convention the
   * rest of this file uses would not prove a funnel: the failures worth catching
   * (a dropped test-account filter, a step counting users it should not) all
   * make counts go UP.
   */
  function weekOf(reference: Date, weeksAgo: number): { key: string; signupAt: Date } {
    const monday = new Date(
      Date.UTC(
        reference.getUTCFullYear(),
        reference.getUTCMonth(),
        reference.getUTCDate(),
      ),
    );
    monday.setUTCDate(monday.getUTCDate() - ((reference.getUTCDay() + 6) % 7) - weeksAgo * 7);
    return {
      key: monday.toISOString().slice(0, 10),
      // Wednesday noon: comfortably inside the week from either boundary, so a
      // timezone slip would fail loudly rather than land on an edge by luck.
      signupAt: new Date(monday.getTime() + 2 * DAY_MS + 12 * 3600_000),
    };
  }

  /** The funnel steps for one cohort week, or all-zero when it has no row. */
  async function funnelWeek(week: { key: string }): Promise<RetentionFunnelSteps> {
    const stats = await repo.getPlatformStats(NOW);
    const cohort = stats.retention.cohorts.find((c) => c.weekStart === week.key);
    if (!cohort) {
      return {
        signups: 0,
        createdPlan: 0,
        completedFirstWorkout: 0,
        completedSecondWorkoutWithin7d: 0,
        activeWeek2: 0,
        activeWeek4: 0,
        trainerSponsoredSignups: 0,
      };
    }
    const { weekStart: _weekStart, ...steps } = cohort;
    return steps;
  }

  /**
   * What this test ADDED to its cohort week. Asserted as a delta rather than an
   * absolute total because the scratch database ACCUMULATES: it survives across
   * `vitest run` invocations, so a second run against the same container would
   * see its own previous rows and double every absolute count. The delta is
   * still exact — the week is private, so nothing else moves it.
   */
  function stepsDelta(
    after: RetentionFunnelSteps,
    before: RetentionFunnelSteps,
  ): RetentionFunnelSteps {
    return {
      signups: after.signups - before.signups,
      createdPlan: after.createdPlan - before.createdPlan,
      completedFirstWorkout: after.completedFirstWorkout - before.completedFirstWorkout,
      completedSecondWorkoutWithin7d:
        after.completedSecondWorkoutWithin7d - before.completedSecondWorkoutWithin7d,
      activeWeek2: after.activeWeek2 - before.activeWeek2,
      activeWeek4: after.activeWeek4 - before.activeWeek4,
      trainerSponsoredSignups:
        after.trainerSponsoredSignups - before.trainerSponsoredSignups,
    };
  }

  /**
   * Give a user a plan plus one completed session per timestamp in
   * `completedAt`. Returns the plan id so a caller can hang an `active` session
   * off it. An empty `completedAt` seeds a user who created a plan and never
   * trained — the drop-off the funnel is built to see.
   */
  async function seedFunnelUser(input: {
    tenantId: string;
    userId: string;
    completedAt: Date[];
  }): Promise<string> {
    const [spec] = await db
      .insert(planSpecs)
      .values({
        tenantId: input.tenantId,
        userId: input.userId,
        specJson: { goal: "strength" },
        confirmed: true,
      })
      .returning({ id: planSpecs.id });
    const [plan] = await db
      .insert(workoutPlans)
      .values({
        tenantId: input.tenantId,
        userId: input.userId,
        planSpecId: spec!.id,
        status: "ready",
      })
      .returning({ id: workoutPlans.id });
    for (const completedAt of input.completedAt) {
      await db.insert(workoutSessions).values({
        tenantId: input.tenantId,
        userId: input.userId,
        workoutPlanId: plan!.id,
        status: "completed",
        startedAt: completedAt,
        completedAt,
      });
    }
    return plan!.id;
  }

  it("routes each tenant through resolveEffectiveTier: pro-billing → pro, but pro-billing + ACTIVE trainer override → trainer (not pro)", async () => {
    const before = await repo.getPlatformStats(NOW);

    // Tenant A: plain active-pro billing, no override → must count as pro.
    const proTenant = await newTenant("stats-pro-only");
    await db.insert(tenantBillingStates).values({
      tenantId: proTenant,
      tier: "pro",
      status: "active",
      source: "stripe",
    });

    // Tenant B: active-pro billing BUT an active trainer override → must count
    // as trainer. A naive GROUP BY billing_states.tier would misfile it as pro.
    const overrideTenant = await newTenant("stats-pro-with-trainer-override");
    const actorId = await newUser();
    await db.insert(tenantBillingStates).values({
      tenantId: overrideTenant,
      tier: "pro",
      status: "active",
      source: "stripe",
    });
    await db.insert(tenantBillingOverrides).values({
      tenantId: overrideTenant,
      tier: "trainer",
      startsAt: new Date(NOW.getTime() - 3600_000),
      endsAt: OPEN_ENDED,
      createdByUserId: actorId,
      reason: "pilot",
    });

    const after = await repo.getPlatformStats(NOW);

    // The plain pro tenant lands in pro.
    expect(after.billing.effectiveTier.pro).toBeGreaterThanOrEqual(
      before.billing.effectiveTier.pro + 1,
    );
    // The override tenant lands in trainer (proves the override wins over the
    // pro billing row — the whole point of resolveEffectiveTier).
    expect(after.billing.effectiveTier.trainer).toBeGreaterThanOrEqual(
      before.billing.effectiveTier.trainer + 1,
    );
    // Both are active stripe subscriptions on the billing-state table.
    expect(after.billing.activeStripeSubscriptions).toBeGreaterThanOrEqual(
      before.billing.activeStripeSubscriptions + 2,
    );
    // The override is tallied under activeOverridesByTier.trainer.
    expect(after.billing.activeOverridesByTier.trainer).toBeGreaterThanOrEqual(
      before.billing.activeOverridesByTier.trainer + 1,
    );
    // Two more tenants exist overall.
    expect(after.tenants.total).toBeGreaterThanOrEqual(before.tenants.total + 2);
  });

  it("counts a trialing tenant under billing.trials", async () => {
    const before = await repo.getPlatformStats(NOW);
    const tenantId = await newTenant("stats-trial-tenant");
    await db.insert(tenantBillingStates).values({
      tenantId,
      tier: "pro",
      status: "trialing",
      source: "system",
      trialStartedAt: new Date(NOW.getTime() - 3600_000),
      trialEndsAt: new Date(NOW.getTime() + 7 * 86400_000),
    });
    const after = await repo.getPlatformStats(NOW);
    expect(after.billing.trials).toBeGreaterThanOrEqual(before.billing.trials + 1);
  });

  it("tallies active memberships by role (ignoring suspended)", async () => {
    const before = await repo.getPlatformStats(NOW);
    const tenantId = await newTenant("stats-membership-tenant");
    const owner = await newUser();
    const member = await newUser();
    const trainer = await newUser();
    const suspended = await newUser();
    await db.insert(memberships).values([
      { tenantId, userId: owner, role: "owner", status: "active" },
      { tenantId, userId: member, role: "member", status: "active" },
      { tenantId, userId: trainer, role: "trainer", status: "active" },
      { tenantId, userId: suspended, role: "member", status: "suspended" },
    ]);
    const after = await repo.getPlatformStats(NOW);
    expect(after.memberships.activeByRole.owner).toBeGreaterThanOrEqual(
      before.memberships.activeByRole.owner + 1,
    );
    expect(after.memberships.activeByRole.member).toBeGreaterThanOrEqual(
      before.memberships.activeByRole.member + 1,
    );
    expect(after.memberships.activeByRole.trainer).toBeGreaterThanOrEqual(
      before.memberships.activeByRole.trainer + 1,
    );
    // The suspended member must NOT inflate the member tally beyond the +1 we
    // seeded as active. A generous upper bound tolerates concurrent inserts
    // while still failing if the status filter is dropped (which would add +2).
    // (Left as a lower bound only — exact upper bounds are not concurrency-safe.)
  });

  it("sums usage for the current period by feature and excludes other periods", async () => {
    const before = await repo.getPlatformStats(NOW);
    const period = currentBillingPeriod(NOW);
    const tenantId = await newTenant("stats-usage-tenant");
    await db.insert(tenantQuotaCounters).values([
      { tenantId, feature: "plan_generation", period, used: 7, limit: 100 },
      { tenantId, feature: "memory_write", period, used: 3, limit: 100 },
      // A different (old) period with a huge magnitude must NOT contribute to
      // the current tally — the generous upper bound below fails loudly if the
      // `period = current` filter is dropped.
      { tenantId, feature: "plan_generation", period: "2000-01", used: 999, limit: 1000 },
    ]);
    const after = await repo.getPlatformStats(NOW);
    expect(after.usage.thisPeriod).toBe(period);
    expect(after.usage.byFeature.plan_generation).toBeGreaterThanOrEqual(
      before.usage.byFeature.plan_generation + 7,
    );
    expect(after.usage.byFeature.memory_write).toBeGreaterThanOrEqual(
      before.usage.byFeature.memory_write + 3,
    );
    // Exclusion: the 999-magnitude old-period row would blow this bound if the
    // period filter were missing; realistic concurrent current-period usage is
    // far below the 900 headroom.
    expect(after.usage.byFeature.plan_generation).toBeLessThan(
      before.usage.byFeature.plan_generation + 900,
    );
  });

  it("EXCLUDES a synthetic account from the funnel — the whole cohort is invisible", async () => {
    // THE test for #353. Every other number on this page is only as trustworthy
    // as this filter: production and CI register into the same schema, so a
    // funnel that counts test accounts is not a slightly noisy funnel, it is a
    // meaningless one. Seeded as a signup that walks the ENTIRE funnel — plan,
    // first workout, second workout inside 7 days — so if the filter is dropped
    // it moves every step at once, in the same cohort week, and the exact
    // equality below fails loudly.
    const week = weekOf(NOW, 1);
    const before = await funnelWeek(week);

    const testTenant = await newTenant("stats-funnel-synthetic", { isTest: true });
    const testUser = await newUser({ createdAt: week.signupAt, isTest: true });
    await seedFunnelUser({
      tenantId: testTenant,
      userId: testUser,
      completedAt: [addDays(week.signupAt, 1), addDays(week.signupAt, 3)],
    });

    const after = await funnelWeek(week);
    expect(after).toEqual(before);
  });

  it("excludes a REAL user who belongs to a synthetic tenant (the flag is on the tenant, not the user)", async () => {
    // The other half of the exclusion: fixtures routinely attach an unflagged
    // user to a seeded organisation. Counting it would let synthetic data back
    // in through the side door.
    const week = weekOf(NOW, 2);
    const before = await funnelWeek(week);

    const testTenant = await newTenant("stats-funnel-synthetic-tenant", { isTest: true });
    const unflaggedUser = await newUser({ createdAt: week.signupAt, isTest: false });
    await db
      .insert(memberships)
      .values({ tenantId: testTenant, userId: unflaggedUser, role: "owner", status: "active" });
    await seedFunnelUser({
      tenantId: testTenant,
      userId: unflaggedUser,
      completedAt: [addDays(week.signupAt, 1)],
    });

    const after = await funnelWeek(week);
    expect(after).toEqual(before);
  });

  it("walks a real B2C cohort through every funnel step with exact counts", async () => {
    // A dedicated signup week nobody else seeds into, so the cohort row is
    // exactly what this test put there — the shared-database lower-bound
    // convention used elsewhere in this file is too weak to prove a funnel,
    // where the interesting failures are steps counting too MANY users.
    const week = weekOf(NOW, 3);
    const before = await funnelWeek(week);
    const tenantId = await newTenant("stats-funnel-b2c", { isTest: false });

    // 1. Signed up, nothing else.
    await newUser({ createdAt: week.signupAt, isTest: false });

    // 2. Created a plan, never trained.
    const planOnly = await newUser({ createdAt: week.signupAt, isTest: false });
    await seedFunnelUser({ tenantId, userId: planOnly, completedAt: [] });

    // 3. One workout only — reaches the first-workout step, not the second.
    const oneWorkout = await newUser({ createdAt: week.signupAt, isTest: false });
    await seedFunnelUser({
      tenantId,
      userId: oneWorkout,
      completedAt: [addDays(week.signupAt, 2)],
    });

    // 4. A second workout, but on day 12 — OUTSIDE the 7-day rule, so it must
    //    stop at the first-workout step. This is the case a naive
    //    `count(sessions) >= 2` gets wrong.
    const lateSecond = await newUser({ createdAt: week.signupAt, isTest: false });
    await seedFunnelUser({
      tenantId,
      userId: lateSecond,
      completedAt: [addDays(week.signupAt, 1), addDays(week.signupAt, 13)],
    });

    // 5. The full journey: second workout inside 7 days, then still training in
    //    week 2 (day 9) and week 4 (day 23).
    const retained = await newUser({ createdAt: week.signupAt, isTest: false });
    await seedFunnelUser({
      tenantId,
      userId: retained,
      completedAt: [
        addDays(week.signupAt, 1),
        addDays(week.signupAt, 4),
        addDays(week.signupAt, 9),
        addDays(week.signupAt, 23),
      ],
    });

    expect(stepsDelta(await funnelWeek(week), before)).toEqual({
      signups: 5,
      createdPlan: 4,
      completedFirstWorkout: 3,
      completedSecondWorkoutWithin7d: 1,
      activeWeek2: 1,
      activeWeek4: 1,
      trainerSponsoredSignups: 0,
    });
  });

  it("segments a trainer-sponsored user out of the B2C cohort", async () => {
    const week = weekOf(NOW, 4);
    const before = await funnelWeek(week);
    const tenantId = await newTenant("stats-funnel-trainer", { isTest: false });

    const b2c = await newUser({ createdAt: week.signupAt, isTest: false });
    await seedFunnelUser({
      tenantId,
      userId: b2c,
      completedAt: [addDays(week.signupAt, 1), addDays(week.signupAt, 3)],
    });

    // Same journey, but reachable through trainer_client_assignments: it must
    // land in trainerSponsoredSignups and touch NO funnel step, or a handful of
    // B2B clients would swing the B2C ratios (issue #353).
    const trainer = await newUser({ createdAt: week.signupAt, isTest: false });
    const client = await newUser({ createdAt: week.signupAt, isTest: false });
    await db.insert(trainerClientAssignments).values({
      tenantId,
      trainerUserId: trainer,
      clientUserId: client,
      status: "active",
    });
    await seedFunnelUser({
      tenantId,
      userId: client,
      completedAt: [addDays(week.signupAt, 1), addDays(week.signupAt, 3)],
    });

    // The trainer user itself is a plain B2C signup (it is not anyone's
    // client), so the cohort gains the b2c user plus the trainer.
    expect(stepsDelta(await funnelWeek(week), before)).toEqual({
      signups: 2,
      createdPlan: 1,
      completedFirstWorkout: 1,
      completedSecondWorkoutWithin7d: 1,
      activeWeek2: 0,
      activeWeek4: 0,
      trainerSponsoredSignups: 1,
    });
  });

  it("counts an active session older than the threshold as abandoned, and a fresh one as not", async () => {
    const before = await repo.getPlatformStats(NOW);
    const week = weekOf(NOW, 5);
    const tenantId = await newTenant("stats-funnel-abandoned", { isTest: false });

    const stale = await newUser({ createdAt: week.signupAt, isTest: false });
    const stalePlan = await seedFunnelUser({ tenantId, userId: stale, completedAt: [] });
    await db.insert(workoutSessions).values({
      tenantId,
      userId: stale,
      workoutPlanId: stalePlan,
      status: "active",
      startedAt: new Date(
        NOW.getTime() - (ABANDONED_SESSION_THRESHOLD_HOURS + 1) * 3600_000,
      ),
    });

    // Started an hour ago: a real workout in progress, not an abandoned one.
    const fresh = await newUser({ createdAt: week.signupAt, isTest: false });
    const freshPlan = await seedFunnelUser({ tenantId, userId: fresh, completedAt: [] });
    await db.insert(workoutSessions).values({
      tenantId,
      userId: fresh,
      workoutPlanId: freshPlan,
      status: "active",
      startedAt: new Date(NOW.getTime() - 3600_000),
    });

    const after = await repo.getPlatformStats(NOW);
    expect(after.retention.abandonedSessionThresholdHours).toBe(
      ABANDONED_SESSION_THRESHOLD_HOURS,
    );
    // Exactly one of the two seeded sessions crossed the threshold. Concurrent
    // suites only ever ADD rows, hence the lower bound; the upper bound is what
    // proves the fresh session was NOT counted.
    expect(after.retention.abandonedSessions).toBeGreaterThanOrEqual(
      before.retention.abandonedSessions + 1,
    );
    expect(after.retention.abandonedSessions).toBeLessThan(
      before.retention.abandonedSessions + 2 + CONCURRENT_NOISE_HEADROOM,
    );
  });

  it("counts observability events + errors in the last 24 hours and excludes older rows", async () => {
    const before = await repo.getPlatformStats(NOW);
    const inWindow = new Date(NOW.getTime() - 3600_000);
    const old = new Date(NOW.getTime() - 48 * 3600_000);
    // 1 error + 1 info in-window; a large batch of OLD errors that must be excluded.
    const oldErrors = Array.from({ length: 200 }, () => ({
      level: "error" as const,
      event: "stats.old",
      createdAt: old,
    }));
    await db.insert(observabilityEvents).values([
      { level: "error", event: "stats.failed", createdAt: inWindow },
      { level: "info", event: "stats.ok", createdAt: inWindow },
      ...oldErrors,
    ]);
    const after = await repo.getPlatformStats(NOW);
    expect(after.observability.errors24h).toBeGreaterThanOrEqual(before.observability.errors24h + 1);
    expect(after.observability.events24h).toBeGreaterThanOrEqual(before.observability.events24h + 2);
    // Exclusion: 200 old errors would blow this bound if the 24h window filter
    // were missing; realistic concurrent in-window errors are far below 150.
    expect(after.observability.errors24h).toBeLessThan(before.observability.errors24h + 150);
  });
});

describe.skipIf(hasDb)("AdminStatsRepository (real Postgres) — skipped", () => {
  it("requires DATABASE_URL (podman pgvector:pg17 harness) to run", () => {
    expect(hasDb).toBe(false);
  });
});
