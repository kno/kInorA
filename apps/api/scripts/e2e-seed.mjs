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
 * Flag a freshly-registered tenant + user as SYNTHETIC (#353).
 *
 * The registration endpoint cannot do this itself — it is the same endpoint a
 * real person uses, and it has no way to tell who is calling it. So the marking
 * happens here, at the only place that knows the account was created by a test.
 * Every e2e run registers a real tenant against the real schema, and without
 * this call those accounts are indistinguishable from customers in the
 * retention funnel, which is exactly the problem #353 exists to fix.
 *
 * Both rows are updated in one statement pair so a partially-marked pair (a
 * flagged tenant with an unflagged user, or the reverse) cannot leak half of a
 * synthetic account into the numbers.
 *
 * @param {{ tenantId: string, userId: string }} input
 */
export async function markAccountAsTest(input) {
  const client = await db().connect();
  try {
    await client.query("BEGIN");
    await client.query(`UPDATE tenants SET is_test = true WHERE id = $1`, [input.tenantId]);
    await client.query(`UPDATE users SET is_test = true WHERE id = $1`, [input.userId]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Flag a synthetic account by EMAIL, plus every tenant it belongs to (#353).
 *
 * The id-based variant above cannot be used when the account was created by
 * driving the sign-up UI: the browser gets a cookie, not a JSON body, so the
 * spec never learns the ids. The email is the only handle it has. Resolving the
 * tenants through `memberships` rather than assuming one keeps this correct for
 * a fixture that later joins a second organisation.
 *
 * Silently tolerates an unknown email so a spec that marks defensively (before
 * confirming the registration landed) does not fail for it.
 *
 * @param {string} email
 */
export async function markAccountAsTestByEmail(email) {
  const client = await db().connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE tenants SET is_test = true
       WHERE id IN (
         SELECT m.tenant_id FROM memberships m
         JOIN users u ON u.id = m.user_id
         WHERE u.email = $1
       )`,
      [email],
    );
    await client.query(`UPDATE users SET is_test = true WHERE email = $1`, [email]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
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

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A minimal-but-VALID confirmed plan spec. Shape mirrors the real
 * `PlanSpec` and must pass `assertPlanSpecShape` (apps/api/src/plan/boundary.ts)
 * so the `/plan-specs/:id/adapt` route's `assertGeneratable` +
 * `loadValidatedSpec` accept it and the flow can reach the 202. `daysPerWeek`
 * is stored top-level (the adapt route rewrites it via `jsonb_set`).
 * @param {number} daysPerWeek
 */
function sampleSpecJson(daysPerWeek) {
  return {
    goal: "strength",
    location: "gym",
    daysPerWeek,
    sessionDurationMinutes: 60,
    equipment: ["barbell"],
    limitations: [],
    preferenceScores: {
      strength: 0.9,
      hypertrophy: 0.6,
      endurance: 0.2,
      mobility: 0.3,
    },
    confirmed: true,
  };
}

/**
 * A minimal ready-plan program body. The adherence derivation only reads
 * `programJson.weeklySessions.length` (→ `plannedSessionsPerWeek`), so the
 * array length is what matters; `program_json` is read as loose JSONB (no
 * schema validation on the read path).
 * @param {number} daysPerWeek
 */
function sampleProgramJson(daysPerWeek) {
  return {
    weeklySessions: Array.from({ length: daysPerWeek }, (_, i) => ({
      day: i + 1,
      title: `Session ${i + 1}`,
      exercises: [{ name: "Squat", sets: 4, reps: "8-12", restSeconds: 90 }],
    })),
    limitationWarnings: [],
  };
}

/**
 * Seed a confirmed plan_spec + a READY workout_plan + N completed
 * workout_sessions so the dashboard adherence→adaptation derivation
 * (`computeAdherenceAdaptation`) resolves to a concrete level for the tenant.
 *
 * The derivation is: `adherence = completedInWindow / (plannedSessionsPerWeek * periodWeeks)`
 * over a rolling 4-week window, where `plannedSessionsPerWeek =
 * program_json.weeklySessions.length` and `completedInWindow` = completed
 * sessions whose `completed_at` falls in `[now-28d, now]`. `< 0.70` → level
 * `"low"` + a `reduce_frequency` suggestion (`fromDays = daysPerWeek`,
 * `toDays = daysPerWeek - 1`). The plan's `created_at` is set 35 days in the
 * past so the domain does NOT suppress the signal as `insufficient_data`
 * (which it does when the plan is younger than the window).
 *
 * Example: `daysPerWeek: 4` ⇒ plannedInWindow = 4 × 4 = 16; seed 3 completed
 * → 3/16 = 18.75% < 70% → `"low"`; seed 15 completed → 15/16 = 93.75% → `"ok"`.
 *
 * @param {{ tenantId: string, userId: string, daysPerWeek: number, completedSessions: number }} input
 * @returns {Promise<{ planSpecId: string, workoutPlanId: string }>}
 */
export async function seedAdherencePlan(input) {
  const { tenantId, userId, daysPerWeek, completedSessions } = input;
  const now = Date.now();
  // Older than the 4-week window so the adaptation is not `insufficient_data`.
  const planCreatedAt = new Date(now - 35 * DAY_MS);

  const specRes = await db().query(
    `INSERT INTO plan_specs (tenant_id, user_id, spec_json, confirmed, created_at)
     VALUES ($1, $2, $3::jsonb, true, $4)
     RETURNING id`,
    [tenantId, userId, JSON.stringify(sampleSpecJson(daysPerWeek)), planCreatedAt],
  );
  const planSpecId = specRes.rows[0].id;

  const planRes = await db().query(
    `INSERT INTO workout_plans
       (tenant_id, user_id, plan_spec_id, status, name, program_json, created_at, updated_at)
     VALUES ($1, $2, $3, 'ready', $4, $5::jsonb, $6, $6)
     RETURNING id`,
    [
      tenantId,
      userId,
      planSpecId,
      "E2E Adherence Plan",
      JSON.stringify(sampleProgramJson(daysPerWeek)),
      planCreatedAt,
    ],
  );
  const workoutPlanId = planRes.rows[0].id;

  // Completed sessions spread evenly across the last 4 weeks — every
  // `completed_at` lands inside `[now-27d, now-1d]` (⊂ the [now-28d, now]
  // window). All are `status='completed'`, so the single-active-per-user
  // partial unique index (status='active') never trips.
  for (let i = 0; i < completedSessions; i += 1) {
    const spread =
      completedSessions <= 1
        ? 1
        : Math.round(1 + (i * 26) / (completedSessions - 1));
    const completedAt = new Date(now - spread * DAY_MS);
    await db().query(
      `INSERT INTO workout_sessions
         (tenant_id, user_id, workout_plan_id, status, day, started_at, completed_at)
       VALUES ($1, $2, $3, 'completed', $4, $5, $5)`,
      [tenantId, userId, workoutPlanId, (i % daysPerWeek) + 1, completedAt],
    );
  }

  return { planSpecId, workoutPlanId };
}
