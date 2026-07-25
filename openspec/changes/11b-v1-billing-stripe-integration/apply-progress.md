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
