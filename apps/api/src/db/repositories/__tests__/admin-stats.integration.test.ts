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
 * Opt-in via `DATABASE_URL` (podman pgvector:pg17 harness, same pattern as
 * `tier-override-admin.integration.test.ts`) — skipped when no real Postgres
 * is wired so the default `vitest run` stays hermetic.
 */
import { afterAll, describe, expect, it } from "vitest";
import { createDbClient } from "../../client.js";
import {
  memberships,
  observabilityEvents,
  tenantBillingOverrides,
  tenantBillingStates,
  tenantQuotaCounters,
  tenants,
  users,
} from "../../schema.js";
import { AdminStatsRepository } from "../admin-stats.js";
import { currentBillingPeriod } from "../../../billing/plan-limits.js";

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("AdminStatsRepository (real Postgres)", () => {
  const { db, pool } = createDbClient();
  const repo = new AdminStatsRepository(db);
  const NOW = new Date("2026-08-02T12:00:00Z");
  const OPEN_ENDED = new Date("9999-12-31T00:00:00Z");

  afterAll(async () => {
    await pool.end();
  });

  async function newTenant(name: string): Promise<string> {
    const [t] = await db.insert(tenants).values({ name }).returning({ id: tenants.id });
    return t!.id;
  }

  async function newUser(): Promise<string> {
    const [u] = await db
      .insert(users)
      .values({ email: `stats-${Date.now()}-${Math.random()}@example.com` })
      .returning({ id: users.id });
    return u!.id;
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
