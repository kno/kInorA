import { Pool } from "pg";
import { expect, type Page } from "@playwright/test";

/**
 * Billing e2e seeding helpers (issue #200).
 *
 * A fresh registration is ALWAYS provisioned a Pro / `trialing` 30-day trial
 * (see `buildTrialBillingState` in apps/api/src/db/repositories/billing-backfill.ts),
 * so the interesting billing states — a Free tenant, a lapsed trial, an ended
 * paid subscription, and a non-owner member — cannot be produced through the
 * public sign-up/API surface. There is no admin API to shape them either (the
 * quota-admin routes are owner-gated and only set allocations, not tier/status).
 *
 * These helpers therefore reshape a freshly-registered tenant DIRECTLY in
 * Postgres, exactly as the manual QA checklist (docs/billing/QA-CHECKLIST.md)
 * documents doing by hand with `psql`. This is legitimate for e2e: the stack
 * orchestrator (scripts/e2e-with-stack.mjs) injects `DATABASE_URL` into the
 * Playwright process pointing at the same ephemeral Postgres the api writes to,
 * so a worker can seed the precise state a scenario needs, then drive the real
 * two-server browser session against it.
 *
 * All writes are keyed by the `tenantId` returned from the real registration
 * API — never by a value guessed client-side — so a scenario only ever mutates
 * its OWN freshly-created tenant and cannot collide with a parallel worker.
 */

const API_BASE = process.env.API_BASE_URL ?? "http://localhost:4000";

/** Web origin the Playwright browser targets (matches playwright.config.ts baseURL). */
export const WEB_ORIGIN = "http://127.0.0.1:3000";

export interface RegisteredTenant {
  token: string;
  tenantId: string;
  userId: string;
  email: string;
}

/**
 * A single shared connection pool per Playwright worker. `DATABASE_URL` is
 * injected by scripts/e2e-with-stack.mjs; a spec that needs seeding fails fast
 * with a clear message when it is absent (e.g. run outside the stack harness).
 */
let pool: Pool | null = null;

function db(): Pool {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "[billing-seed] DATABASE_URL is not set. These seeding helpers require the " +
        "e2e stack (run via `pnpm test:e2e`, which boots Postgres and injects DATABASE_URL).",
    );
  }
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  }
  return pool;
}

/** Close the shared pool. Call from an `afterAll` so the worker exits cleanly. */
export async function closeSeedPool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/**
 * Register a fresh user through the real API and return its opaque session
 * token PLUS the identifiers needed to seed its tenant. The registering user is
 * the tenant OWNER (see AuthService.register → provisionTenantForUser), so the
 * returned tenant renders the owner-only invoice/portal surfaces until demoted.
 */
export async function registerTenant(page: Page): Promise<RegisteredTenant> {
  const unique = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const email = `e2e+billing-200-${unique}@kinora.test`;
  const res = await page.request.post(`${API_BASE}/auth/register`, {
    data: { email, password: "Sup3rSecret!pw" },
  });
  expect(res.ok(), "registration should succeed").toBeTruthy();
  const body = (await res.json()) as {
    token: string;
    user: { id: string };
    tenant: { id: string };
  };
  expect(body.token, "register should return a session token").toBeTruthy();
  expect(body.tenant?.id, "register should return the tenant id").toBeTruthy();
  expect(body.user?.id, "register should return the user id").toBeTruthy();
  return { token: body.token, tenantId: body.tenant.id, userId: body.user.id, email };
}

/** Set the browser's session cookie to a given tenant's token. */
export async function useSession(page: Page, token: string): Promise<void> {
  await page.context().addCookies([
    { name: "kinora_session", value: token, url: WEB_ORIGIN },
  ]);
}

/**
 * Upsert the tenant's billing state. Keyed on the `tenant_id` primary key, so it
 * works whether or not the register flow already inserted a row (no ordering
 * race). Only the columns a scenario cares about are set explicitly; the rest
 * fall back to safe values.
 */
async function upsertBillingState(input: {
  tenantId: string;
  tier: "free" | "pro";
  status: "active" | "trialing" | "expired";
  source: "system" | "backfill" | "stripe";
  trialStartedAt: Date | null;
  trialEndsAt: Date | null;
}): Promise<void> {
  await db().query(
    `
    INSERT INTO tenant_billing_states
      (tenant_id, tier, status, source, trial_started_at, trial_ends_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, now())
    ON CONFLICT (tenant_id) DO UPDATE SET
      tier = EXCLUDED.tier,
      status = EXCLUDED.status,
      source = EXCLUDED.source,
      trial_started_at = EXCLUDED.trial_started_at,
      trial_ends_at = EXCLUDED.trial_ends_at,
      updated_at = now()
    `,
    [input.tenantId, input.tier, input.status, input.source, input.trialStartedAt, input.trialEndsAt],
  );
}

/** Make the tenant a plain Free / active tenant (no trial, no lapse). */
export async function seedFreeTenant(tenantId: string): Promise<void> {
  await upsertBillingState({
    tenantId,
    tier: "free",
    status: "active",
    source: "backfill",
    trialStartedAt: null,
    trialEndsAt: null,
  });
}

/**
 * Make the tenant's trial LAPSED: `trialing` status with the trial window moved
 * into the past. `resolveEffectiveTier` (entitlement.ts) then resolves the
 * effective tier to Free with `lapsedReason: "trial_expired"`, driving the
 * "Your Pro trial has ended" banner.
 */
export async function seedExpiredTrial(tenantId: string): Promise<void> {
  const now = Date.now();
  await upsertBillingState({
    tenantId,
    tier: "pro",
    status: "trialing",
    source: "system",
    trialStartedAt: new Date(now - 31 * 24 * 60 * 60 * 1000),
    trialEndsAt: new Date(now - 1 * 24 * 60 * 60 * 1000),
  });
}

/**
 * Make the tenant an ENDED paid subscription: `expired` status with a `stripe`
 * source. `resolveEffectiveTier` resolves to Free with
 * `lapsedReason: "subscription_ended"` (source === "stripe"), driving the "Your
 * Pro subscription has ended" banner — distinct copy from a lapsed trial (#196).
 */
export async function seedEndedSubscription(tenantId: string): Promise<void> {
  await upsertBillingState({
    tenantId,
    tier: "pro",
    status: "expired",
    source: "stripe",
    trialStartedAt: null,
    trialEndsAt: null,
  });
}

/**
 * The current billing period key (`YYYY-MM`), computed IDENTICALLY to the api's
 * `currentBillingPeriod` (apps/api/src/billing/plan-limits.ts) — UTC-based — so
 * a seeded usage counter lands in the same period the visibility read queries.
 */
export function currentPeriod(now: Date = new Date()): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

/**
 * Seed a tenant-level usage counter for the current period so the Usage Meters
 * section renders a real meter (instead of the empty-usage card). The
 * `used <= limit` DB check is respected. Upserts on the (tenant, feature,
 * period) unique scope.
 */
export async function seedTenantUsage(input: {
  tenantId: string;
  feature: "plan_generation" | "plan_regeneration" | "memory_write" | "memory_retrieval";
  used: number;
  limit: number;
  period?: string;
}): Promise<void> {
  const period = input.period ?? currentPeriod();
  await db().query(
    `
    INSERT INTO tenant_quota_counters (tenant_id, feature, period, used, "limit", updated_at)
    VALUES ($1, $2, $3, $4, $5, now())
    ON CONFLICT (tenant_id, feature, period) DO UPDATE SET
      used = EXCLUDED.used,
      "limit" = EXCLUDED."limit",
      updated_at = now()
    `,
    [input.tenantId, input.feature, period, input.used, input.limit],
  );
}

/**
 * Demote the tenant's owner membership to a plain `member`. `isActiveOwner`
 * (apps/api/src/billing/quota-admin.ts) then denies the owner-only invoice and
 * portal endpoints with 403 → the web maps that to `forbidden` and hides the
 * InvoiceHistory + PaymentCard. The member can still read GET /billing/visibility
 * (any active member), so the rest of the billing screen still renders.
 */
export async function demoteToMember(tenantId: string, userId: string): Promise<void> {
  const result = await db().query(
    `UPDATE memberships SET role = 'member' WHERE tenant_id = $1 AND user_id = $2`,
    [tenantId, userId],
  );
  expect(result.rowCount, "demote should update exactly the owner membership").toBe(1);
}
