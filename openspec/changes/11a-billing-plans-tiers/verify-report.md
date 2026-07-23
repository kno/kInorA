# Verify Report: 11a-billing-plans-tiers — Slice 2 / PR2

**Phase**: 2 (Core Billing / Gating) — tasks 2.1 / 2.2 / 2.3
**Branch**: `feat/11a-billing-plans-tiers-slice2` (uncommitted working tree)
**Mode**: Strict TDD | Full artifacts (proposal + spec + design + tasks + apply-progress)
**Verdict**: **PASS-WITH-NOTES**

---

## Executive Summary

All five required Phase 2 spec scenarios have real, asserting tests that pass at
runtime. Tasks 2.1/2.2/2.3 are genuinely satisfied (RED→GREEN→TRIANGLE) with no
scope leak into Phase 3/4. All repo quality gates pass. The apply-phase
deferred-risk (real Drizzle `QuotaLedgerRepository` atomicity/idempotency proven
only with a FakeLedger) was **closed** in this verify run: a bounded runtime
smoke of `CheckAndConsumeQuota` against live Postgres (pgvector:pg17) passed all
12 checks including the concurrency race and all-or-nothing member-cap atomicity.

CRITICAL: 0 | WARNING: 1 | SUGGESTION: 2

---

## Spec Scenario Compliance Matrix

| Scenario (required) | Covering test | Real assert? | Result |
|---|---|---|---|
| Hybrid Tenant Quotas — member allocation exhausted while tenant remains | `billing/__tests__/quota-consumption.test.ts` "denies member_allocation_exhausted … leaving the tenant counter untouched" | Yes | PASS (unit + runtime C2/C3) |
| Hybrid Tenant Quotas — tenant pool exhausted while member remains | same file "denies the next Free generation with tenant_quota_exhausted" | Yes | PASS (unit + runtime A4) |
| Hybrid Tenant Quotas — concurrent members race final tenant unit | same file "is race-safe: two members contending for the final tenant unit" | Yes | PASS (unit + runtime B1/B2 on real Postgres) |
| Generation Metering | `routes/__tests__/plan-generation.test.ts` "Generation metering gate" (5 tests: allow/deny confirm+regenerate, op-key shape) | Yes | PASS |
| Idempotent quota consumption retry | `billing/__tests__/quota-consumption.test.ts` "returns the prior decision on idempotent retry without consuming again" | Yes | PASS (unit + runtime A2/A3) |
| Empty operation key rejected | same file "rejects an empty operation key without touching the ledger (operation_key_required)" | Yes | PASS |
| Denied entitlement skips retrieval | `ai/__tests__/generation-service.memory.test.ts` "skips retrieval entirely when the memory entitlement is denied (fail-closed, no fallback)" | Yes | PASS |

Supporting entitlement coverage (`billing/__tests__/entitlement.test.ts`):
active-trial→pro, expired-trial→free+`trial_expired`, exact-boundary expired,
override precedence (`admin_override`), `premium_required` on Free, fail-closed
`inactive_membership` and `billing_state_unavailable`. All asserting; all pass.

No placeholder/`.skip`/`.todo` tests found among the covering tests.

## Fail-Closed Verification

| Invariant | Evidence | Result |
|---|---|---|
| Denied entitlement skips retrieval (no embedding/search, never a fallback) | `generation-service.ts attachMemoryContext` gate before try/catch; unit test asserts `retrieve` not called | PASS |
| Inactive/suspended membership denies | `entitlement.ts` denies `inactive_membership` before tier resolution; runtime D1 (suspended member re-checked inside consume tx) → `inactive_membership` | PASS |
| Missing billing state denies | `entitlement.ts` `billing_state_unavailable` when no billing row and no override | PASS |
| Empty op key never touches ledger | `quota-consumption.ts` early return; unit asserts `consumeSpy` not called | PASS |
| Route denial → 403, no generation started | `plan-generation.test.ts` deny tests assert `startGeneration` not called | PASS |
| Production route gate always wired | `app.ts` injects `billing` + `memoryEntitlement`; route optionality is a test seam only | PASS |

## Task Completion (RED→GREEN→TRIANGLE)

- 2.1 RED — failing tests added first (apply recorded 6 failed / 850 passed initial run). Satisfied.
- 2.2 GREEN — `billing/{types,plan-limits,entitlement,quota-consumption}.ts` + `db/repositories/billing-quota.ts` + gate wiring in `plan.ts`, `generation-service.ts`, `memory-retriever.ts`, `app.ts`. Satisfied.
- 2.3 TRIANGLE — atomic consume, concurrency race, retry idempotency, empty-key, fail-closed denial. Satisfied (unit) and now corroborated on live Postgres.

Phase 3 (3.1–3.3) and Phase 4 (4.1–4.3) remain `[ ]` — intentionally out of PR2 scope, not a blocker for this slice.

## Scope Leak Check (into Phase 3/4)

- No `apps/api/src/routes/billing.ts` (quota admin API) — absent, correct.
- No `apps/web/src/app/(app)/billing/` UI — absent (web build shows no `/billing` route), correct.
- No Stripe/checkout/webhook/payment/invoice/coupon/embedding/provider code in `apps/api/src/billing/*` or `billing-quota.ts` — grep clean.
- No `packages/contracts` change in this slice (DTOs landed in Slice 1) — clean.

## Gate Results (exact)

| Gate | Command | Result |
|---|---|---|
| Focused (work unit 2) | `pnpm --filter api test -- src/billing/__tests__/entitlement.test.ts src/routes/__tests__/plan-generation.test.ts src/routes/__tests__/user-memories.test.ts` | PASS — `Test Files 62 passed (62)`, `Tests 875 passed (875)` |
| Full API suite | (same invocation; Vitest collects full suite for positional paths — known behaviour) | PASS — 62 files / 875 tests |
| Type-check | `pnpm type-check` | PASS — all 6 workspaces `Done` |
| Architecture | `pnpm architecture` | PASS — `no dependency violations found (1591 modules, 4593 dependencies)`; negative guard passed |
| Deps-guard | `pnpm deps-guard` | PASS — no prohibited dependencies (6 package.json) |
| Build | `pnpm build` | PASS — all workspaces built; web routes emitted, no `/billing` |

## Runtime Smoke (deferred-risk closure) — DONE

Harness: `podman run pgvector/pgvector:pg17` on port 55433 →
`DATABASE_URL=… pnpm --filter api db:migrate` (migrations applied) →
`tsx` script exercising the REAL `BillingStateReaderRepository` +
`QuotaLedgerRepository` through `CheckAndConsumeQuota`/`CheckEntitlement`.
Container removed after run; no artifacts left in the tree.

| Check | Result |
|---|---|
| A1 first `plan_generation` consume allowed | PASS |
| A2 idempotent replay (same op key) allowed | PASS |
| A3 tenant counter still 1 after replay (no double-consume) | PASS |
| A4 second op → `tenant_quota_exhausted` | PASS |
| A5 counter not over-consumed (=1) | PASS |
| B1 two concurrent members race final unit → exactly one success | PASS |
| B2 regen counter == 1 (no over-consume under `Promise.all`) | PASS |
| C1 first member write allowed (Pro tenant, member cap 1) | PASS |
| C2 second → `member_allocation_exhausted` | PASS |
| C3 all-or-nothing: tenant counter == 1 after member denial | PASS |
| C4 member counter == 1 | PASS |
| D1 suspended membership denied at consume (`inactive_membership`, in-tx re-check) | PASS |

**SMOKE RESULT: 12 passed, 0 failed.** The `SELECT … FOR UPDATE` +
conditional-increment transaction and idempotency ledger behave correctly
against real Postgres, including the concurrency serialization and the
transactional membership re-check. The FakeLedger model is faithful to the
production adapter.

## Deviations from Design

1. (Accepted) Drizzle adapters placed in `apps/api/src/db/repositories/billing-quota.ts` rather than `apps/api/src/billing/*` — required by `.dependency-cruiser.cjs` (`api-no-db-outside-infra`). Pure use cases remain port-only under `billing/`. Architecture gate passes. Layering intent preserved.
2. (Accepted) Route billing gate is optional DI (test seam); `app.ts` always injects it in production → production fails closed.
3. (Accepted) Pro aggregate cap is provisional `PRO_FEATURE_LIMIT = 1_000_000`; 11a is provider-independent. Free numeric limits match spec exactly (gen 1, regen 1, memory 0). Exact Pro limits deferred to 11b.

## Issues

- **WARNING** — Premium `memory_write` route gating is not wired in this slice. Retrieval gating (generation path) is complete and tested, but the design's File-Changes table also lists `apps/api/src/routes/user-memories.ts` for premium write gates; that route is unchanged here. None of the five required Phase 2 scenarios depend on it, so it is a documented deferral, but it should be tracked and delivered in a later slice (Phase 3/4) so the "0 premium memory writes on Free" contract is enforced at the write route, not only via the schema/entitlement primitives.
- **SUGGESTION** — Mid-period tier downgrade (trial→free within the same calendar month) retains the already-initialised tenant counter `limit` for that period. Outside Phase 2 required scenarios; note for a later slice.
- **SUGGESTION** — Focused Vitest command collects the full API suite for positional paths (same known behaviour as Slice 1). Cosmetic; not a defect.

## Verdict

**PASS-WITH-NOTES.** Phase 2 is spec-compliant and fully proven at unit and
(now) live-Postgres runtime level. No CRITICAL issues; the one WARNING is a
tracked deferral that does not affect any required Phase 2 scenario. Safe to
proceed to review/PR for PR2, then Phase 3 (quota admin API).
