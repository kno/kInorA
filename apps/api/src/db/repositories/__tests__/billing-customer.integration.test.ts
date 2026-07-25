/**
 * Real-Postgres integration coverage for the 11b Slice 4 DB-backed Stripe
 * customer resolution (`BillingCustomerRepository`).
 *
 * The portal and invoice endpoints resolve the tenant's Stripe customer id from
 * OUR OWN `tenant_billing_states.stripe_customer_id`, keyed by the `authContext`
 * tenant — NEVER from client input. The pure use-case + route suites prove the
 * tenant flows only from authContext; only a real Postgres can prove the read
 * itself is correctly tenant-scoped and null-safe:
 *
 *   1. Returns a tenant's OWN customer id when set.
 *   2. Returns null when the tenant has a billing row but no customer id yet
 *      (never subscribed) — so the portal fails closed (409) and invoices
 *      return [] rather than crashing.
 *   3. Is tenant-scoped: tenant B's lookup NEVER returns tenant A's customer id,
 *      and a tenant with no billing-state row resolves to null (no cross-tenant
 *      leakage on the payments hot path).
 *
 * Opt-in via `DATABASE_URL` (podman pgvector:pg17 harness, same pattern as the
 * other billing integration suites) — skipped when no real Postgres is wired so
 * the default `vitest run` stays hermetic.
 */
import { afterAll, describe, expect, it } from "vitest";
import { createDbClient } from "../../client.js";
import { tenantBillingStates, tenants } from "../../schema.js";
import { BillingCustomerRepository } from "../billing-customer.js";

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("BillingCustomerRepository.findStripeCustomerId (real Postgres)", () => {
  const { db, pool } = createDbClient();
  const repo = new BillingCustomerRepository(db);

  afterAll(async () => {
    await pool.end();
  });

  async function seedTenant(): Promise<string> {
    const [tenant] = await db
      .insert(tenants)
      .values({ name: `billing-customer-${Date.now()}-${Math.random()}` })
      .returning({ id: tenants.id });
    return tenant!.id;
  }

  it("returns the tenant's OWN stripe_customer_id when set", async () => {
    const tenantId = await seedTenant();
    const customerId = `cus_${Date.now()}`;
    await db.insert(tenantBillingStates).values({
      tenantId,
      tier: "pro",
      status: "active",
      source: "stripe",
      stripeCustomerId: customerId,
    });

    expect(await repo.findStripeCustomerId(tenantId)).toBe(customerId);
  });

  it("returns null when the tenant has a billing row but no customer id (never subscribed)", async () => {
    const tenantId = await seedTenant();
    await db.insert(tenantBillingStates).values({
      tenantId,
      tier: "free",
      status: "active",
      source: "backfill",
    });

    expect(await repo.findStripeCustomerId(tenantId)).toBeNull();
  });

  it("is tenant-scoped: tenant B's lookup never returns tenant A's customer, and an unknown tenant resolves to null", async () => {
    const tenantA = await seedTenant();
    const tenantB = await seedTenant();
    const customerA = `cus_A_${Date.now()}`;

    await db.insert(tenantBillingStates).values({
      tenantId: tenantA,
      tier: "pro",
      status: "active",
      source: "stripe",
      stripeCustomerId: customerA,
    });
    // Tenant B exists as a tenant but has NO billing-state row at all.

    expect(await repo.findStripeCustomerId(tenantA)).toBe(customerA);
    // Cross-tenant: B must never see A's customer.
    expect(await repo.findStripeCustomerId(tenantB)).toBeNull();
    // A tenant id that does not exist at all also resolves cleanly to null.
    expect(await repo.findStripeCustomerId("00000000-0000-4000-8000-0000000000ff")).toBeNull();
  });
});

describe.skipIf(hasDb)("BillingCustomerRepository (real Postgres) — skipped", () => {
  it("requires DATABASE_URL (podman pgvector:pg17 harness) to run", () => {
    expect(hasDb).toBe(false);
  });
});
