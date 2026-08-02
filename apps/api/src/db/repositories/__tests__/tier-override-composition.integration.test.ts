/**
 * 16c composition contract (16d-admin-tier-provisioning, Phase 4).
 *
 * Verification-only: an active admin tier override MUST resolve tier
 * independently of any coexisting `tenant_billing_states` row, and MUST NOT
 * disturb that row's orthogonal metadata.
 *
 * DEVIATION from design.md/spec.md wording: the spec names `seatCount` as the
 * orthogonal 16c metadata field, but 16c (seat-scaled billing) has not shipped
 * yet — `tenant_billing_states` has no `seatCount` column. This test uses the
 * existing `stripeSubscriptionId` metadata column as the orthogonal stand-in;
 * the contract proven is identical (tier resolution via `resolveEffectiveTier`
 * is independent of ANY `tenant_billing_states` metadata column when an
 * active override is present, and that metadata is left untouched). When 16c
 * lands its `seatCount` column, this test's stand-in field should be swapped.
 *
 * Opt-in via `DATABASE_URL` — skipped when no real Postgres is wired.
 */
import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDbClient } from "../../client.js";
import { tenantBillingStates, tenants, users } from "../../schema.js";
import { BillingStateReaderRepository } from "../billing-quota.js";
import { TierOverrideAdminRepository } from "../tier-override-admin.js";
import { resolveEffectiveTier } from "../../../billing/entitlement.js";

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("16c composition contract — override tier vs. tenant_billing_states metadata", () => {
  const { db, pool } = createDbClient();
  const reader = new BillingStateReaderRepository(db);
  const overrideRepo = new TierOverrideAdminRepository(db);
  // `BillingStateReaderRepository.loadContext` resolves its active-override
  // window against the REAL wall-clock time (`new Date()` internally), not an
  // injected instant — so `startsAt` must be safely in the past relative to
  // whenever this test actually runs.
  const STARTS_AT = new Date(Date.now() - 60_000);
  const OPEN_ENDED = new Date("9999-12-31T00:00:00Z");
  const SEAT_STAND_IN = "sub_seat_scaled_stand_in";

  afterAll(async () => {
    await pool.end();
  });

  it("resolves the override's tier while leaving orthogonal billing-state metadata intact", async () => {
    const [tenant] = await db.insert(tenants).values({ name: "composition-tenant" }).returning({ id: tenants.id });
    const [superadmin] = await db
      .insert(users)
      .values({ email: `superadmin-${Date.now()}-${Math.random()}@example.com`, isAdmin: true })
      .returning({ id: users.id });
    const [member] = await db
      .insert(users)
      .values({ email: `member-${Date.now()}-${Math.random()}@example.com` })
      .returning({ id: users.id });

    // Orthogonal billing-state row (would carry `seatCount` once 16c ships).
    await db.insert(tenantBillingStates).values({
      tenantId: tenant!.id,
      tier: "pro",
      status: "active",
      source: "stripe",
      stripeSubscriptionId: SEAT_STAND_IN,
    });

    await overrideRepo.grantTierOverride({
      tenantId: tenant!.id,
      actorUserId: superadmin!.id,
      tier: "trainer",
      reason: "16c composition contract test",
      startsAt: STARTS_AT,
      endsAt: OPEN_ENDED,
    });

    const ctx = await reader.loadContext({ tenantId: tenant!.id, userId: member!.id });
    const effective = resolveEffectiveTier(ctx, new Date());

    expect(effective).toMatchObject({ tier: "trainer", source: "admin_override" });

    const [stateRow] = await db
      .select({ stripeSubscriptionId: tenantBillingStates.stripeSubscriptionId, tier: tenantBillingStates.tier })
      .from(tenantBillingStates)
      .where(eq(tenantBillingStates.tenantId, tenant!.id));

    // The billing-state row's own tier and metadata are untouched — the
    // override wins at RESOLUTION time without mutating the underlying row.
    expect(stateRow?.tier).toBe("pro");
    expect(stateRow?.stripeSubscriptionId).toBe(SEAT_STAND_IN);
  });
});

describe.skipIf(hasDb)("16c composition contract — skipped", () => {
  it("requires DATABASE_URL (podman pgvector:pg17 harness) to run", () => {
    expect(hasDb).toBe(false);
  });
});
