// @ts-check
/**
 * Billing e2e seeding utility (issue #200).
 *
 * Lives in `apps/api` — the ONLY workspace permitted to declare a database
 * driver (see scripts/deps-guard.mjs `DB_ALLOWED_WORKSPACES = ["apps/api"]`).
 * The Playwright helper (tests/e2e/helpers/billing-seed.ts) imports these
 * functions, so the `pg` dependency stays resolved through apps/api and is
 * NEVER declared at the repo root. It sits under `scripts/` (not `src/`) so it
 * is outside the dependency-cruiser cruise of `apps/api/src` — the
 * `api-no-db-outside-infra` rule confines direct `pg` imports to
 * `apps/api/src/db`, which does not apply to this out-of-src test utility.
 *
 * Plain Node ESM (`.mjs` forces ESM even though apps/api has no
 * `"type": "module"`), no build step — so the Playwright transform loads it
 * directly. `pg` is CommonJS; the default-import + destructure pattern is the
 * portable Node ESM interop for it.
 *
 * WHY DIRECT DB WRITES: a fresh registration is ALWAYS provisioned a Pro /
 * `trialing` 30-day trial owner (see apps/api/src/db/repositories/billing-backfill.ts),
 * and there is no public/admin API to shape a Free tenant, a lapsed trial, an
 * ended subscription, or a non-owner member. These helpers reshape a
 * freshly-registered tenant BY ITS ID directly in the same ephemeral Postgres
 * the api reads — exactly what docs/billing/QA-CHECKLIST.md documents doing by
 * hand with `psql`, now automated and asserted. `DATABASE_URL` is injected into
 * the Playwright process by scripts/e2e-with-stack.mjs.
 */

import pg from "pg";

const { Pool } = pg;

/** @type {import('pg').Pool | null} */
let pool = null;

/** @returns {import('pg').Pool} */
function db() {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "[e2e-seed] DATABASE_URL is not set. These seeding helpers require the " +
        "e2e stack (run via `pnpm test:e2e`, which boots Postgres and injects DATABASE_URL).",
    );
  }
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  }
  return pool;
}

/** Close the shared pool. Call from an `afterAll` so the worker exits cleanly. */
export async function closeSeedPool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/**
 * The current billing period key (`YYYY-MM`), computed IDENTICALLY to the api's
 * `currentBillingPeriod` (apps/api/src/billing/plan-limits.ts) — UTC-based — so
 * a seeded usage counter lands in the same period the visibility read queries.
 * @param {Date} [now]
 * @returns {string}
 */
export function currentPeriod(now = new Date()) {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

/**
 * Upsert the tenant's billing state. Keyed on the `tenant_id` primary key, so it
 * works whether or not the register flow already inserted a row (no ordering
 * race). Only the columns a scenario cares about are set explicitly.
 * @param {{
 *   tenantId: string,
 *   tier: "free" | "pro",
 *   status: "active" | "trialing" | "expired",
 *   source: "system" | "backfill" | "stripe",
 *   trialStartedAt: Date | null,
 *   trialEndsAt: Date | null,
 * }} input
 */
async function upsertBillingState(input) {
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

/**
 * Make the tenant a plain Free / active tenant (no trial, no lapse).
 * @param {string} tenantId
 */
export async function seedFreeTenant(tenantId) {
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
 * @param {string} tenantId
 */
export async function seedExpiredTrial(tenantId) {
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
 * @param {string} tenantId
 */
export async function seedEndedSubscription(tenantId) {
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
 * Seed a tenant-level usage counter for the current period so the Usage Meters
 * section renders a real meter (instead of the empty-usage card). The
 * `used <= limit` DB check is respected. Upserts on the (tenant, feature,
 * period) unique scope.
 * @param {{
 *   tenantId: string,
 *   feature: "plan_generation" | "plan_regeneration" | "memory_write" | "memory_retrieval",
 *   used: number,
 *   limit: number,
 *   period?: string,
 * }} input
 */
export async function seedTenantUsage(input) {
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
 * @param {string} tenantId
 * @param {string} userId
 */
export async function demoteToMember(tenantId, userId) {
  const result = await db().query(
    `UPDATE memberships SET role = 'member' WHERE tenant_id = $1 AND user_id = $2`,
    [tenantId, userId],
  );
  if (result.rowCount !== 1) {
    throw new Error(
      `[e2e-seed] demoteToMember expected to update exactly 1 owner membership, updated ${result.rowCount}`,
    );
  }
}
