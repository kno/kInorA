# Apply Progress: 11b — Billing Stripe Integration

## Slice 1 — Schema-First (Foundation) — COMPLETE

**Mode**: Strict TDD (RED → GREEN → TRIANGLE). Branch: `sdd/11b-billing-stripe-integration`.
**Boundary**: purely additive schema/contracts/config. ZERO Stripe SDK, ZERO routes,
ZERO behavior change. `resolveEffectiveTier` (`entitlement.ts`) and `plan-limits.ts`
(`PRO_FEATURE_LIMIT = 1_000_000`) are UNTOUCHED — verified by `git diff`.

### Completed Tasks

- [x] 1.1 RED schema test (`apps/api/src/db/__tests__/stripe-schema.test.ts`)
- [x] 1.2 RED contracts DTO test (`packages/contracts/src/__tests__/billing-dto.test.ts`)
- [x] 1.3 RED pricing-config test (`apps/api/src/billing/__tests__/pricing-config.test.ts`)
- [x] 1.4 GREEN schema + migration (`schema.ts`, `drizzle/0012_stripe_billing.sql`, `_journal.json`)
- [x] 1.5 GREEN contracts (`packages/contracts/src/index.ts`)
- [x] 1.6 GREEN pricing-config module (`apps/api/src/billing/pricing-config.ts`)
- [x] 1.7 TRIANGLE real-Postgres integration test (`stripe-schema.integration.test.ts`)
- [x] 1.8 TRIANGLE CI `billing-integration` job extended + false-green guard bumped 12→25
- [x] 1.9 TRIANGLE zero-behavior-change proof (11a suites green, unedited)

### Files Changed

| File | Action | What |
|------|--------|------|
| `apps/api/src/db/schema.ts` | Modified | +`stripe` on `billingSourceEnum`; new `billingCycleEnum`; 6 additive nullable/defaulted Stripe columns on `tenant_billing_states`; new `stripeProcessedEvents` table (event_id PK, type, stripe_event_ts, received_at) |
| `apps/api/drizzle/0012_stripe_billing.sql` | Created | Additive migration: CREATE TYPE billing_cycle; ALTER TYPE billing_source ADD VALUE 'stripe'; CREATE TABLE stripe_processed_events; 6× ADD COLUMN (metadata-only, no rewrite) |
| `apps/api/drizzle/meta/_journal.json` | Modified | Added idx 12 tag `0012_stripe_billing` (when 1784900000000, strictly increasing, non-future) |
| `packages/contracts/src/index.ts` | Modified | `BillingSource += 'stripe'`; `BillingCycle`; optional cycle/period fields on `TenantBillingStateDTO`; `CheckoutSessionRequest/Response`, `PortalSessionResponse`, `InvoiceDTO` (type-only — no runtime export) |
| `apps/api/src/billing/pricing-config.ts` | Created | `loadStripeConfig(env)` (4 env reads, throws naming missing key only), `PRO_TIER_LIMITS`, `annualSavePercent(monthly, annualPerMonth)` derived save% |
| `apps/api/src/db/__tests__/stripe-schema.test.ts` | Created | Schema-shape + migration-text unit test (7 tests) |
| `packages/contracts/src/__tests__/billing-dto.test.ts` | Created | DTO type + runtime-surface test (6 tests) |
| `apps/api/src/billing/__tests__/pricing-config.test.ts` | Created | Env/limits/save% unit test (8 tests) |
| `apps/api/src/db/repositories/__tests__/stripe-schema.integration.test.ts` | Created | Real-PG integration (4 real + 1 placeholder) |
| `apps/api/src/db/__tests__/billing-schema.test.ts` | Modified (11a) | Updated the `billingSourceEnum` exact-value assertion to include `'stripe'` — unavoidable additive-enum change; NOT a behavior change |
| `.github/workflows/ci-cd.yml` | Modified | Added integration file to `billing-integration` job; MIN 12→25 |

### TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1/1.4 | `db/__tests__/stripe-schema.test.ts` | Unit | 11a schema test 10/10 baseline | ✅ RED: ENOENT 0012 sql + missing exports | ✅ 17/17 (with 11a schema) | ✅ 2 enums + cols + table + migration + journal | ➖ structural |
| 1.2/1.5 | `contracts/__tests__/billing-dto.test.ts` | Unit(type) | contracts guard baseline green | ✅ RED: `tsc` TS2305/TS2724/TS2322 (missing types) | ✅ tsc clean + 19/19 runtime | ✅ stripe/admin sources, monthly/annual, DTO literals, empty invoice | ✅ made fields optional to keep 11a mapper unchanged |
| 1.3/1.6 | `billing/__tests__/pricing-config.test.ts` | Unit | N/A (new) | ✅ RED: Cannot find module `../pricing-config.js` | ✅ 8/8 | ✅ 2 env sets, missing-key throw, 4 save% cases, 32-bit bounds | ➖ clean |
| 1.7 | `db/repositories/__tests__/stripe-schema.integration.test.ts` | Integration (real PG) | N/A (new) | ✅ referenced not-yet-existing table/migration | ✅ 4 passed / 1 placeholder skipped (real PG) | ✅ additive-up, stripe source+cycle, insert-on-conflict, down-rollback | ➖ clean |
| 1.8 | `.github/workflows/ci-cd.yml` guard | CI | existing guard MIN=12 | ✅ DB-absent yields 4 passed < 25 → RED | ✅ DB-present 25 ≥ 25 → PASS | ✅ verified both DB-present (25) and DB-absent (4) empirically | ➖ n/a |
| 1.9 | `entitlement.test.ts` + `plan-limits.test.ts` + `billing-quota.integration.test.ts` | Unit + Integration | 21 passed/3 skipped baseline captured pre-change | approval (behavior preserved) | ✅ 14/14 unit + 21 PG unchanged | ➖ | ➖ untouched |

### Gate / Test Evidence (exact)

- **Focused RED→GREEN**: schema RED = ENOENT `0012_stripe_billing.sql`; contracts RED = `tsc` TS2305 (`BillingCycle`, `CheckoutSessionRequest`, `InvoiceDTO`, `PortalSessionResponse` missing); pricing-config RED = "Cannot find module `../pricing-config.js`". All GREEN after implementation.
- **Full api unit suite (hermetic)**: 954 passed / 0 failed / 25 skipped.
- **Billing integration (real Postgres, podman pgvector:pg17 on :5433)**: 25 passed / 4 skipped / 0 failed (baseline was 21/3 before adding the file → +4 real +1 placeholder). Migration applied cleanly via `drizzle-kit migrate` (ALTER TYPE ADD VALUE ok inside txn on PG17); schema verified via `psql`.
- **False-green guard**: DB-present 25 passed (≥25 PASS); DB-absent 4 placeholders (<25 FAIL correctly).
- **`pnpm type-check`**: PASS (contracts, api, web, mobile all Done).
- **`pnpm deps-guard`**: PASS (no prohibited deps).
- **`pnpm architecture`**: PASS (1606 modules, 0 violations; contracts rejects pg, domain rejects drizzle).
- **`pnpm build`**: PASS (all packages Done).
- **`pnpm -r --if-present test:coverage`**: EXIT 0 — i18n 5, contracts 7, domain 22, api 70, web 101 test files all passed. Contracts public-API-surface guard stayed green (no new runtime export).

### Zero-Behavior-Change Proof

- `git diff` confirms `entitlement.ts` and `plan-limits.ts` NOT modified.
- `PRO_FEATURE_LIMIT = 1_000_000` still governs live Pro caps; `pricing-config.ts` is export-only (not imported by `plan-limits.ts`).
- 11a `billing-visibility.ts` UNCHANGED — achieved by making the new DTO fields optional.

### Deviations from Design

1. **`billing-schema.test.ts` (11a) edited**: the exact `billingSourceEnum.enumValues` assertion had to gain `'stripe'`. Unavoidable side effect of the additive enum value; it is a schema-shape assertion, not an entitlement-behavior change. Task 1.9's named suites (`entitlement.test.ts`, `billing-quota.integration.test.ts`) remain unedited and green.
2. **`TenantBillingStateDTO` new fields are OPTIONAL, not required**: the design's Interfaces block implied plain fields, but Slice 1's File Changes list does NOT include `billing-visibility.ts`. Making them required would force editing that 11a mapper (a behavior/response change), breaking the zero-behavior-change boundary. Optional keeps the mapper untouched; the webhook/web slices tighten/populate them.
3. **Migration filename `0012_stripe_billing.sql`**: journal idx 12 (prior idx 11 = `0011_abnormal_squadron_sinister`, the known duplicate-0011-prefix quirk). Followed journal idx ordering per instructions; no meta snapshot authored (consistent with `0011_abnormal` which also has none — `drizzle-kit migrate` needs only `_journal.json` + the sql).

### Issues Found

None blocking. Test infra note: the temporary podman Postgres (`kinora-pg`, port 5433) was ephemeral; the podman machine stopped after the run so the container is already gone — no cleanup owed, no conflict with dev (:5432).

### Status

9/9 Slice-1 tasks complete. Ready for verify. NOT committed/pushed/reviewed per instructions.

---

## Slice 2 — Webhook + Subscription Lifecycle (hottest) — COMPLETE

**Mode**: Strict TDD (RED → GREEN → TRIANGLE). Branch: `sdd/11b-slice2-webhook` (stacked-to-main, off main with Slice 1 merged). PR boundary: PR2 of the auto-chain.
**Boundary**: adds the raw-body webhook route + signature verify + idempotent, out-of-order-safe, fail-closed subscription→billing-state mapping (both cycles) + grace payment-failure. `resolveEffectiveTier` (`entitlement.ts`) is UNTOUCHED — the webhook is the FIRST real writer to `tenant_billing_states` and writes only `status`/`tier` (+ additive Stripe metadata); the overrides table is never touched, so an active admin override still wins at read time (#172).
**Rollback**: drop the webhook plugin + `process-webhook.ts` + `stripe-events.ts` + real adapter + `0013` migration + the `stripe` dep + guard edits.

### Completed Tasks
- [x] 2.1 RED unit + route signature tests
- [x] 2.2 GREEN pure port + use case + drizzle store adapter
- [x] 2.3 GREEN encapsulated raw-body webhook plugin + `app.ts` wiring (injectable gateway seam)
- [x] 2.4 TRIANGLE real-PG integration test + CI wiring + guard bump (25→28)

### Files Changed
| File | Action | What |
|------|--------|------|
| `apps/api/src/billing/stripe-gateway.ts` | Created | Pure `StripeGateway` PORT + SDK-free domain types (`StripeWebhookEvent`, `StripeSubscriptionSnapshot`, `StripeSubscriptionStatus`) + `StripeSignatureError`. No `stripe` import. |
| `apps/api/src/billing/process-webhook.ts` | Created | Pure use case `ProcessStripeWebhook` + pure `resolveBillingStatus`/`mapSubscriptionToWrite`; `StripeEventStorePort`. Grace (`past_due`→keep Pro), cancel-at-period-end→expire-at-period-end, deletion/terminal/unknown→expired (fail-closed). |
| `apps/api/src/db/repositories/stripe-gateway.ts` | Created | The ONLY `stripe` SDK importer: `StripeApiGateway` (`constructEvent` verify + normalize), `createStripeGatewayFromEnv`, fail-closed `UnconfiguredStripeGateway`. Secret-free error surface. |
| `apps/api/src/db/repositories/stripe-events.ts` | Created | Drizzle store adapter: one `db.transaction` = idempotency insert-on-conflict → out-of-order guard (per-tenant `stripe_event_ts` high-water mark, `FOR UPDATE`) → billing-state upsert. Mirrors 11a `billing-quota.ts`. |
| `apps/api/src/routes/billing.ts` | Modified | Added encapsulated `stripeWebhookRoutes` plugin: scoped `addContentTypeParser('application/json',{parseAs:'buffer'})` (raw body in THIS scope only) + UNAUTHENTICATED `POST /billing/webhook` (signature is auth; invalid→400, error→500 fail-closed). |
| `apps/api/src/app.ts` | Modified | Wired the webhook: injectable `stripeGateway` seam (tests) → real env gateway → `UnconfiguredStripeGateway` fallback; `StripeEventStoreRepository` + `ProcessStripeWebhook`. |
| `apps/api/src/db/schema.ts` | Modified | Additive nullable `stripe_event_ts` column on `tenant_billing_states` (per-tenant out-of-order high-water mark). |
| `apps/api/drizzle/0013_stripe_event_ts.sql` + `_journal.json` | Created/Modified | Additive `ADD COLUMN stripe_event_ts`; journal idx 13. |
| `apps/api/package.json` + `pnpm-lock.yaml` | Modified | Added `stripe@22.3.2` (exact pin) — needed for `constructEvent`/`generateTestHeaderString`. |
| `scripts/deps-guard.mjs` | Modified | Moved `stripe` out of PROHIBITED_EVERYWHERE into apps/api-only `STRIPE_PATTERNS`/`STRIPE_ALLOWED_WORKSPACES`. |
| `.dependency-cruiser.cjs` | Modified | New `api-no-stripe-outside-infra` rule: `stripe` importable ONLY from `db/`+`tenant/` (tests exempt); pure use cases stay SDK-free (probe-verified). |
| `.github/workflows/ci-cd.yml` | Modified | `billing-integration` job runs `stripe-webhook.integration.test.ts`; false-green MIN 25→28 (5 placeholders skipped when DB absent). |
| `apps/api/src/billing/__tests__/process-webhook.test.ts` | Created | 19 hermetic unit tests (mapping + orchestration + Threat Matrix). |
| `apps/api/src/routes/__tests__/billing-webhook.test.ts` | Created | 5 hermetic route tests — REAL `StripeApiGateway` + `generateTestHeaderString` (signed/annual/tampered/no-sig/forged). |
| `apps/api/src/db/repositories/__tests__/stripe-webhook.integration.test.ts` | Created | 3 real-PG tests (exactly-once+out-of-order, subscription→state, #172 override-wins) + 1 skip placeholder. |

### TDD Cycle Evidence
| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 2.1/2.2 | `billing/__tests__/process-webhook.test.ts` | Unit | N/A (new) | ✅ `Cannot find module ../process-webhook.js` | ✅ 19/19 | ✅ 19 cases (both cycles, grace, cancel/period-end, deletion, dup, stale, fail-closed×2, no-tenant) | ✅ Clean |
| 2.1/2.3 | `routes/__tests__/billing-webhook.test.ts` | Route (hermetic, real gateway) | N/A (new) | ✅ `Cannot find module ../../db/repositories/stripe-gateway.js` | ✅ 5/5 | ✅ 5 cases (active/annual/tampered/no-sig/forged) | ✅ Clean |
| 2.4 | `db/repositories/__tests__/stripe-webhook.integration.test.ts` | Integration (real PG) | N/A (new) | ✅ module-not-found then DB-absent placeholder | ⏳ CI-validated (local podman down) | ✅ 3 cases | ✅ Clean |

### Work Unit Evidence
| Evidence | Value |
|---|---|
| Focused test command | `pnpm --filter api exec vitest run src/billing/__tests__/process-webhook.test.ts src/routes/__tests__/billing-webhook.test.ts` → 24 passed / 0 failed |
| Runtime harness | Real-PG `stripe-webhook.integration.test.ts` — NOT run locally (podman/krunkit crashing). Loads clean DB-absent: 1 placeholder passed / 3 real skipped. Will be validated by CI `billing-integration` job (real pgvector:pg17), exactly as Slice 1 was. NOT faked. |
| Rollback boundary | Drop webhook plugin + `process-webhook.ts` + `stripe-events.ts` + `db/repositories/stripe-gateway.ts` + `0013` migration + `stripe` dep + guard edits; `resolveEffectiveTier`/`plan-limits.ts` untouched. |

### Hermetic Gate Results (exact)
- `pnpm --filter api type-check` (tsc --noEmit): PASS
- `pnpm type-check` (all 6 packages): PASS
- `pnpm deps-guard`: PASS (all 6 workspaces clean; `stripe` allowed only in apps/api)
- `pnpm architecture` (depcruise + negative test): PASS — no violations (1806 modules); `stripe` probe from `billing/` correctly rejected by `api-no-stripe-outside-infra`
- `pnpm build` (deps-guard + ui-api-guard + architecture + all tsc + web build): PASS
- `pnpm -r --if-present test:coverage`: PASS — contracts 58, domain 255, i18n 30, web 881, api 979 passed / 0 failed (api 28 skipped = real-PG integration, DB-absent)

### Stripe SDK dependency
Added `stripe@22.3.2` (exact pin, matching repo style for `fastify`/`vitest`). Required for `webhooks.constructEvent` (verify) and `webhooks.generateTestHeaderString` (hermetic route signing). ALL SDK usage confined to `apps/api/src/db/repositories/stripe-gateway.ts`.

### Deviations / additions beyond the literal task file list
1. **New additive column `stripe_event_ts` on `tenant_billing_states` + migration `0013`.** The out-of-order guard needs a per-tenant high-water mark ("apply only when incoming ts >= the stored one", design decision). Slice 1 put `stripe_event_ts` only on `stripe_processed_events` (per-event, no tenant/subscription linkage), so it cannot serve as the per-tenant mark. Additive + nullable + never read by `resolveEffectiveTier`. Rollback = drop column.
2. **Guard edits (`deps-guard.mjs`, `.dependency-cruiser.cjs`).** `stripe` was in PROHIBITED_EVERYWHERE and had no api-layer rule. Rescoped to apps/api-only (like DB/AI) + a new infra-only depcruise rule so the SDK cannot leak into pure use cases. No existing guard weakened for other packages.
3. **`UnconfiguredStripeGateway` fallback** so the API boots cleanly without Stripe env (mirrors the optional AI stack); an unconfigured deploy fails closed (every webhook → 400), never granting Pro.

### Known limitation (noted for verify/4R)
A webhook for a non-existent `tenantId` (from signed metadata) would fail the FK insert → rollback → 5xx → Stripe retries. In practice `tenantId` comes from our own checkout metadata (an existing tenant), so this is fail-closed and acceptable for Slice 2.

### Status
4/4 Slice-2 tasks complete. Ready for verify. NOT committed/pushed/reviewed per instructions.

---

## Slice 2 — 4R Follow-Up Fixes (post-review) — COMPLETE

**Mode**: Strict TDD (RED → GREEN) for the behavioral fixes (1, 2, 3); direct refactor + safety-net rerun for the readability fixes (4, 5). Branch: `sdd/11b-slice2-webhook`. Same PR2 boundary — no new files/routes, corrections to the Slice 2 diff only.

The 4R review of Slice 2 passed `review-risk` clean; `review-resilience` + `review-reliability` corroborated two real defects in the out-of-order guard plus one operational fail-safe gap, and `review-readability` flagged two items. All five fixed.

### FIX 1 (WARNING, resilience+reliability — out-of-order guard bypass on first insert)
**File**: `apps/api/src/db/repositories/stripe-events.ts`
**Defect**: `SELECT ... FOR UPDATE` locks nothing when the tenant has no `tenant_billing_states` row yet. Two concurrent FIRST-time deliveries both read `current === undefined`, both skipped the stale check, and an older event committing last could win, regressing the stored `stripe_event_ts`.
**Fix**: moved the guard entirely into the `INSERT ... ON CONFLICT DO UPDATE` statement's `setWhere` clause (Postgres evaluates it atomically against the conflicting row's already-committed values; the second concurrent inserter blocks on Postgres's own conflict-resolution lock until the first commits). The initial insert branch (no pre-existing row) is never gated by `WHERE` and always applies. Removed the now-redundant `SELECT ... FOR UPDATE` (justified in-code: the conditional upsert fully subsumes its correctness and it added an extra round trip). Detect "guard rejected" via `.returning()` — Postgres excludes a row from `RETURNING` when a `DO UPDATE ... WHERE` evaluates false — and treat an empty result as `outcome: "stale"` (still 200).
**Exact SQL** (drizzle `setWhere`, evaluated against the conflicting row `tenant_billing_states` vs the proposed `excluded` row):
```sql
(
  tenant_billing_states.stripe_event_ts IS NULL
  OR tenant_billing_states.stripe_event_ts < excluded.stripe_event_ts
  OR (
    tenant_billing_states.stripe_event_ts = excluded.stripe_event_ts
    AND NOT (tenant_billing_states.status = 'expired' AND excluded.status = 'active')
  )
)
```

### FIX 2 (WARNING, reliability — same-second timestamp tie restores stale state)
**Files**: `apps/api/src/db/repositories/stripe-events.ts`, `apps/api/src/billing/process-webhook.ts`
**Defect**: Stripe's `created` is second-granularity; the OLD guard's `<=` semantics let a later-ARRIVING but same-second non-terminal write overwrite an existing terminal (`expired`) state.
**Fix**: same `setWhere` clause above encodes the tie-break in the third `OR` branch — at an EQUAL `stripe_event_ts`, reject ONLY a non-terminal (`active`) write over an existing terminal (`expired`) state; every other equal-timestamp pairing (same-status idempotent rewrite, or a terminal write over a non-terminal one) still applies. Added a pure, unit-tested predicate `shouldAcceptStoreWrite` in `process-webhook.ts` that mirrors this exact SQL semantics (kept in sync manually; the real-Postgres integration suite asserts the SQL reproduces it end-to-end) — this makes the decision rules independently testable without a live Postgres.

### FIX 3 (SUGGESTION→real fail-safe, resilience — unconfigured deploy drops events)
**Files**: `apps/api/src/billing/stripe-gateway.ts` (new `StripeGatewayUnconfiguredError`), `apps/api/src/db/repositories/stripe-gateway.ts` (`UnconfiguredStripeGateway` now throws it instead of `StripeSignatureError`)
**Defect**: a deploy missing `STRIPE_WEBHOOK_SECRET` threw `StripeSignatureError` → `process-webhook.ts` mapped it to `invalid_signature` → route returned 400 → Stripe stops retrying → real billing events silently dropped for the whole misconfiguration window.
**Fix**: `StripeGatewayUnconfiguredError` is a distinct class, deliberately NOT a subclass of `StripeSignatureError`. `ProcessStripeWebhook.process` only catches `StripeSignatureError`; the new error propagates uncaught, and since the webhook route installs no custom error handler, Fastify's default handler returns 500 for it — a RETRYABLE fail-closed response — while a genuinely invalid/forged signature still returns 400 (regression-tested).

### FIX 4 (WARNING, readability — status union/Set drift)
**File**: `apps/api/src/billing/stripe-gateway.ts` (new `STRIPE_SUBSCRIPTION_STATUSES` const tuple), `apps/api/src/db/repositories/stripe-gateway.ts` (`KNOWN_STATUSES` now derived from it)
**Fix**: `StripeSubscriptionStatus` is now `(typeof STRIPE_SUBSCRIPTION_STATUSES)[number]` derived from a single canonical `as const` tuple; the infra adapter's runtime `KNOWN_STATUSES` Set is built directly from that same tuple (`new Set<string>(STRIPE_SUBSCRIPTION_STATUSES)`), eliminating the previous hand-duplicated, compile-time-disconnected list.

### FIX 5 (SUGGESTION, readability)
**File**: `apps/api/src/billing/process-webhook.ts`
**Fix**: `BillingStateWrite.status` changed from the no-op `Extract<"active" | "expired", string>` to the plain union `"active" | "expired"`.

### TDD Cycle Evidence (behavioral fixes 1–3)
| Fix | Test File | Layer | RED | GREEN | TRIANGULATE |
|-----|-----------|-------|-----|-------|-------------|
| 1 (guard predicate) | `billing/__tests__/process-webhook.test.ts` (`shouldAcceptStoreWrite` suite) | Unit | ✅ `TypeError: shouldAcceptStoreWrite is not a function` | ✅ 8/8 | ✅ null-row, null-ts, older, newer, equal×4 cases |
| 1 (real guard, concurrent first-delivery) | `db/repositories/__tests__/stripe-webhook.integration.test.ts` | Integration (real PG) | N/A (new test; behavior is CI-validated — local PG down) | ⏳ CI-validated | ✅ single concurrent-race case, asserts newer always wins |
| 2 (tie-break unit) | `billing/__tests__/process-webhook.test.ts` (`shouldAcceptStoreWrite` equal-ts cases + orchestration "same-second tie-break" test) | Unit | ✅ same TypeError above (shared RED) | ✅ 30/30 (full file) | ✅ both arrival orders |
| 2 (tie-break real guard, both orders) | `db/repositories/__tests__/stripe-webhook.integration.test.ts` | Integration (real PG) | N/A (new; CI-validated) | ⏳ CI-validated | ✅ delete-then-update AND update-then-delete |
| 3 (error propagation) | `billing/__tests__/process-webhook.test.ts` + `routes/__tests__/billing-webhook.test.ts` | Unit + Route (hermetic) | ✅ `TypeError: StripeGatewayUnconfiguredError is not a constructor` | ✅ unit 30/30, route 7/7 | ✅ regression test proves invalid-signature path still 400 |
| 4/5 (readability) | Safety net: full existing suites rerun | N/A (structural refactor) | N/A | ✅ all pre-existing + new tests still pass | N/A |

### Exact gate results (post-fix)
- Focused: `pnpm --filter api exec vitest run src/billing/__tests__/process-webhook.test.ts src/routes/__tests__/billing-webhook.test.ts` → **37 passed / 0 failed** (30 unit incl. 8 `shouldAcceptStoreWrite` cases + 2 new fail-safe/tie-break orchestration tests; 7 route incl. 2 new FIX-3 tests)
- `pnpm --filter api exec vitest run` (full api suite): **992 passed / 0 failed / 30 skipped** (up from 979/28 — +13 new tests: 11 unit/route + 2 real-PG integration cases counted as skipped locally)
- `pnpm type-check` (all 6 packages): PASS
- `pnpm deps-guard`: PASS
- `pnpm architecture` (depcruise + negative test): PASS — no violations (1803 modules)
- `pnpm build`: PASS
- `pnpm -r --if-present test:coverage`: PASS — contracts 58, domain 255, i18n 30, web 881, api 992 passed / 0 failed
- Real-PG integration (`stripe-webhook.integration.test.ts`, now 5 real tests + 1 placeholder): **NOT run locally** (podman/krunkit still down) — loads clean (1 placeholder passed / 5 real skipped). CI `billing-integration` job will validate (MIN bumped 28→30 in `.github/workflows/ci-cd.yml`; placeholder count unchanged at 5). NOT faked.

### Files changed (this fix batch)
| File | Action | What |
|------|--------|------|
| `apps/api/src/billing/stripe-gateway.ts` | Modified | `STRIPE_SUBSCRIPTION_STATUSES` canonical tuple (FIX 4); `StripeGatewayUnconfiguredError` (FIX 3) |
| `apps/api/src/billing/process-webhook.ts` | Modified | `shouldAcceptStoreWrite` pure guard predicate (FIX 1/2); `BillingStateWrite.status` plain union (FIX 5); doc updates distinguishing signature vs unconfigured errors (FIX 3) |
| `apps/api/src/db/repositories/stripe-gateway.ts` | Modified | `UnconfiguredStripeGateway` throws `StripeGatewayUnconfiguredError` (FIX 3); `KNOWN_STATUSES` derived from the canonical tuple (FIX 4) |
| `apps/api/src/db/repositories/stripe-events.ts` | Modified | Atomic `setWhere` conditional upsert replaces the `SELECT ... FOR UPDATE` guard (FIX 1/2); `eq` import removed (unused), `sql` import added |
| `apps/api/src/billing/__tests__/process-webhook.test.ts` | Modified | +15 tests: `shouldAcceptStoreWrite` suite (8), unconfigured-error propagation (2), same-second tie-break orchestration (1); `fakeStore()` rewritten to use the real predicate |
| `apps/api/src/routes/__tests__/billing-webhook.test.ts` | Modified | +2 tests: unconfigured-gateway → 5xx, invalid-signature-still-400 regression guard; `buildWebhookAppWithGateway` helper added |
| `apps/api/src/db/repositories/__tests__/stripe-webhook.integration.test.ts` | Modified | +2 real-PG tests: FIX 1 concurrent first-delivery race, FIX 2 same-second tie-break (both orders) |
| `.github/workflows/ci-cd.yml` | Modified | false-green MIN bumped 28→30 (stripe-webhook file now has 5 real tests, was 3) |

### Residual risk
None blocking. The `setWhere` SQL and the pure `shouldAcceptStoreWrite` predicate are kept in sync MANUALLY (drizzle/Postgres cannot literally execute the TS function) — a future edit to one without the other would silently reintroduce drift; the real-Postgres integration suite is the authoritative cross-check and MUST be re-verified whenever either changes. The concurrent-first-delivery and same-second tie-break integration tests are unverified locally (podman/krunkit down) — CI `billing-integration` job is authoritative.

### Status
All 5 review-corroborated fixes complete. Ready for re-review / verify. NOT committed/pushed per instructions.

---

## Slice 2 — Flaky Test Fix (post re-confirmation review) — COMPLETE

**File**: `apps/api/src/db/repositories/__tests__/stripe-webhook.integration.test.ts` — FIX 1 concurrent first-delivery test.

**Problem**: `expect([olderResult.outcome, newerResult.outcome].sort()).toEqual(["processed", "stale"])` assumed the OLDER tx always loses the insert race. But `Promise.all` gives no commit-order guarantee: if the NEWER tx commits first, the older is rejected → `[processed, stale]` (assertion held); if the OLDER tx commits first, the newer's `setWhere` (`olderTs < newerTs`) evaluates true and it is ACCEPTED too → `[processed, processed]` (assertion threw). This made the test flaky (~50% red on correct code) and would intermittently red the payments-critical `billing-integration` CI job.

**Fix**: replaced the exact-multiset assertion with only what the guard deterministically guarantees, independent of which tx wins the race:
```ts
const outcomes = [olderResult.outcome, newerResult.outcome];
expect(outcomes).toContain("processed");
expect(outcomes.every((outcome) => outcome === "processed" || outcome === "stale")).toBe(true);
```
The meaningful, order-independent invariant — the final `tenant_billing_states` row always converges on the NEWER event (`status: "active"`, `stripeSubscriptionStatus: "active"`, `stripeEventTs === newerTs`) — was NOT weakened; it already held in both orderings and remains asserted unchanged.

Verified the sibling FIX 2 same-second tie-break test does NOT have the same issue: it calls `recordEventAndApply` sequentially (`await`, not `Promise.all`) in each explicit order and asserts only the final `status`, which is fully deterministic in both orderings — no change needed there.

**Gate results (post-fix)**:
- `stripe-webhook.integration.test.ts` loads clean locally (DB-absent): 1 placeholder passed / 5 real skipped — unchanged shape, confirms no load/compile regression. Real-PG concurrency assertion itself is CI-validated only (local podman/krunkit down).
- Focused hermetic (`process-webhook.test.ts` + `billing-webhook.test.ts`): **37 passed / 0 failed**
- `pnpm type-check` (all 6 packages): PASS
- `pnpm -r --if-present test:coverage`: PASS — contracts 58, domain 255, i18n 30, api 992 (30 skipped), web 881 — all passed / 0 failed

### Status
Flaky-test fix complete. NOT committed/pushed per instructions.

---

## Slice 3 — Checkout + Real Caps + Coupons — COMPLETE

Branch `sdd/11b-slice3-checkout` (off main, Slices 1+2 merged). Strict TDD. NOT committed/pushed/reviewed.

### Completed Tasks
- [x] 3.1 RED — `create-checkout.test.ts`, `coupon.test.ts`, `plan-limits.test.ts`
- [x] 3.2 GREEN — pure `create-checkout.ts` + coupon flow, SDK adapter extended, checkout route wired
- [x] 3.3 GREEN — metered-caps swap (drop `1_000_000` → `PRO_TIER_LIMITS`)
- [x] 3.4 TRIANGLE — cross-tenant prevention, secret-hygiene log-scrub, real-cap enforcement (unit + real-PG), no live Stripe key

### Files Changed
| File | Action | What |
|------|--------|------|
| `apps/api/src/billing/create-checkout.ts` | Create | Pure `CreateCheckout` use case (SDK-free); selects cycle Price, validates coupon server-side, forwards tenant; re-exports `InvalidPromotionCodeError` |
| `apps/api/src/billing/stripe-gateway.ts` | Modify | Added SEGREGATED `CheckoutGateway` port + `PromotionCodeValidation`/`CreateCheckoutSessionInput`/`CheckoutSession` + `InvalidPromotionCodeError` (webhook `StripeGateway` left intact so Slice 2 fakes stay valid) |
| `apps/api/src/db/repositories/stripe-gateway.ts` | Modify | `StripeApiGateway implements StripeGateway & CheckoutGateway`: `createCheckoutSession` (client_reference_id + subscription metadata `tenantId`) + `validatePromotionCode`; `UnconfiguredCheckoutGateway`; `+returnUrl` ctor; env factory returns concrete type. ONLY `stripe` importer. |
| `apps/api/src/billing/plan-limits.ts` | Modify | Dropped `PRO_FEATURE_LIMIT=1_000_000`; imports `PRO_TIER_LIMITS`; `resolveTenantFeatureLimit` per-feature. `resolveEffectiveTier` untouched. |
| `apps/api/src/billing/pricing-config.ts` | Modify | Doc-only header update (now wired) |
| `apps/api/src/routes/billing.ts` | Modify | `POST /billing/checkout` (requireAuth; tenant only from authContext; cycle validated; `InvalidPromotionCodeError`→422); `createCheckout` in options + guard |
| `apps/api/src/app.ts` | Modify | Build real gateway once (webhook + checkout reuse); `resolveCheckoutPricing()`; wire `CreateCheckout`; injectable checkout gateway/pricing |
| `apps/api/src/routes/__tests__/billing.test.ts` | Modify | +7 checkout triangle tests + harness `createCheckout` wiring |
| `apps/api/src/routes/__tests__/billing-visibility.test.ts` | Modify | Harness `createCheckout` stub (shared plugin now requires it) |
| `apps/api/src/db/repositories/__tests__/billing-quota.integration.test.ts` | Modify | +1 real-PG Pro-cap boundary test (seed used=cap-1 → allow-then-deny at real cap 500) |
| `.github/workflows/ci-cd.yml` | Modify | billing-integration assert-executed guard MIN 30→31 |

### TDD Cycle Evidence
| Task | Test File | Layer | RED | GREEN | TRIANGULATE |
|------|-----------|-------|-----|-------|-------------|
| 3.1/3.2 | `billing/__tests__/create-checkout.test.ts` | Unit | ✅ module-not-found (`create-checkout.js`) | ✅ 6/6 | ✅ monthly/annual price, tenant passthrough, no-promo, blank-promo |
| 3.1/3.2 | `billing/__tests__/coupon.test.ts` | Unit | ✅ module-not-found | ✅ 4/4 | ✅ valid attach / invalid / expired / valid-no-id → all no-session on reject |
| 3.1/3.3 | `billing/__tests__/plan-limits.test.ts` | Unit | ✅ 3 failed (Pro still 1_000_000) | ✅ 5/5 | ✅ real caps, Free unchanged, under/over-cap, paid-supersedes-trial |
| 3.4 | `routes/__tests__/billing.test.ts` (checkout describe) | Route (hermetic, fake gateway) | ✅ within RED file set | ✅ 32/32 (7 new) | ✅ spoofed-body-tenant ignored, unauth 401, invalid cycle 422, invalid coupon 422, log-scrub |
| 3.4 | `db/repositories/__tests__/billing-quota.integration.test.ts` | Integration (real PG) | N/A (extends passing suite) | ⏳ CI-validated (local podman down) | ✅ real Pro-cap boundary |

### Work Unit Evidence
| Evidence | Value |
|---|---|
| Focused test command | `pnpm --filter api exec vitest run src/billing/__tests__/{create-checkout,coupon,plan-limits}.test.ts src/routes/__tests__/billing.test.ts` → **47 passed / 0 failed** (4 files) |
| Runtime harness | Real-PG Pro-cap test in `billing-quota.integration.test.ts` — NOT run locally (podman down); loads clean DB-absent (unchanged placeholder shape). CI `billing-integration` job (real pgvector:pg17) validates it; guard MIN bumped 30→31 so a dropped DATABASE_URL fails RED. NOT faked. |
| Rollback boundary | Revert route + `app.ts` checkout wiring + `create-checkout.ts` + adapter/port checkout methods + the `plan-limits.ts` caps swap (restore `PRO_FEATURE_LIMIT`) + test/CI edits. Webhook (Slice 2) + `resolveEffectiveTier` untouched. |

### Hermetic Gate Results (exact)
- `pnpm type-check` (6 packages): PASS
- `pnpm build` (deps-guard + ui-api-guard + architecture/depcruise incl. `api-no-stripe-outside-infra` + all tsc + web build): PASS
- `pnpm -r --if-present test:coverage`: PASS — contracts 58, domain 255, i18n 30, api **1014 passed / 31 skipped**, web 881 — 0 failed

### Caps-swap blast radius
The swap required ZERO existing-assertion rewrites: no test asserted `resolveTenantFeatureLimit == 1_000_000` (entitlement.test checks only `limit > 0`; quota-consumption.test uses dynamic `input.tenantLimit` with small counts; integration/route `1_000_000` literals are test-authored explicit limits, not resolver output). The only existing-test churn was mechanical — 3 route-test registrations of the shared `billingRoutes` plugin now must pass the newly-required `createCheckout` option (`billing.test.ts` ×2, `billing-visibility.test.ts` ×2). The full `test:coverage` run (not the focused run) surfaced `billing-visibility.test.ts` (6 tests).

### Deviations from Design
- **Port shape (ISP)**: design says "one `StripeGateway` port with all methods". Extending the webhook `StripeGateway` interface with required checkout methods would have broken every merged Slice 2 fake (bare `{ verifyAndParseEvent }` objects typed as `StripeGateway`). Implemented as a SECOND segregated `CheckoutGateway` port in the same file; the single SDK adapter implements both. Satisfies "extend the port + adapter, single `stripe` importer" without touching Slice 2. No other deviation.
- Coupon-expiry read uses a defensive cast because the pinned Stripe `PromotionCode` type does not surface `.coupon` on the list-item shape.

### Issues Found
None blocking. Note for 4R: checkout returns `200 { url }` (matches `CheckoutSessionResponse` contract) rather than a server `303` — the web client performs the redirect.

### Status
4/4 Slice-3 tasks complete. Ready for verify → `review/start`. NOT committed/pushed/reviewed per instructions.

---

## Slice 3 — 4R Follow-Up Fixes (post-review) — COMPLETE

4R review of Slice 3 passed (risk/reliability clean); 3 cheap fixes applied before merge. NOT committed/pushed.

### FIX 1 (WARNING, resilience — Stripe brownout stalls checkout ~80s)
`apps/api/src/db/repositories/stripe-gateway.ts` (`StripeApiGateway` constructor): the SDK client was built with no explicit timeout and neither checkout nor coupon calls passed an `AbortSignal`, so a reachable-but-slow Stripe brownout would block `POST /billing/checkout` for the SDK default (~80s); Fastify has no default request timeout, so concurrent attempts would pile up. Fixed by constructing the client with `new Stripe(secretKey, { timeout: 10_000, maxNetworkRetries: 1 })` — 10s bounded timeout + 1 retry, so a degraded Stripe fails fast to a clean 5xx instead of stalling tens of seconds. Chosen values: `timeout: 10_000` ms (generous enough for a normal checkout-session create, short enough to bound worst-case latency), `maxNetworkRetries: 1` (one retry absorbs a single transient blip without compounding the worst case toward ~20s). Real-SDK construction path is not exercised hermetically (adapter tests use the fake gateway) — verified via type-check/build only, as instructed.

### FIX 2 (SUGGESTION, readability — spelling inconsistency that would bite Slice 5)
`apps/api/src/db/repositories/stripe-gateway.ts` (`createCheckoutSession`, `cancel_url`): changed the query-param value from British `checkout=cancelled` to American `checkout=canceled`, matching the rest of the module's vocabulary (`STRIPE_SUBSCRIPTION_STATUSES` uses `canceled`). The Slice-5 web client will string-match this param; a spelling mismatch would have left the cancelled-checkout UI state unreachable. `success_url` (`checkout=success`) was already consistent — left unchanged.

### FIX 3 (SUGGESTION, readability)
`apps/api/src/routes/billing.ts` (`POST /billing/checkout` handler): added a comment before the `200 { url }` response stating this is deliberate — the SPA web client performs the redirect itself (`window.location`) — so a future maintainer doesn't "fix" it into a server-side `303` and break the client's fetch-then-navigate contract.

### Gate results (post-fix, exact)
- Focused: `pnpm --filter api exec vitest run src/billing/__tests__/create-checkout.test.ts src/billing/__tests__/coupon.test.ts src/routes/__tests__/billing.test.ts` → **42 passed / 0 failed** (3 files)
- `pnpm type-check` (6 packages): PASS
- `pnpm build` (deps-guard + ui-api-guard + architecture/depcruise + all tsc + web build): PASS
- `pnpm -r --if-present test:coverage`: PASS — contracts 58, domain 255, i18n 30, api **1014 passed / 31 skipped**, web 881 — 0 failed (counts unchanged vs. pre-fix, confirming no regression)

### Status
3/3 Slice-3 4R fixes complete. Gates green. NOT committed/pushed per instructions.
