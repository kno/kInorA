# Tasks: Billing Plans and Tiers

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | ~1,100–1,400 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR1 schema/backfill → PR2 billing core → PR3 quota API → PR4 web/verify |
| Delivery strategy | chained |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|---|---|---|---|---|---|
| 1 | Billing schema/backfill + contract DTOs | PR1 | `pnpm --filter api test -- src/db/__tests__/billing-schema.test.ts src/db/repositories/__tests__/billing-backfill.test.ts` | N/A — migration-only; prove via DB tests | `apps/api/src/db/schema.ts`, `apps/api/drizzle/0011_billing_plans_tiers.sql`, `packages/contracts/src/index.ts` |
| 2 | Entitlement, atomic consume, plan/memory gates | PR2 | `pnpm --filter api test -- src/billing/__tests__/entitlement.test.ts src/routes/__tests__/plan-generation.test.ts src/routes/__tests__/user-memories.test.ts` | `pnpm --filter api dev` + confirm/regen and memory-write deny/allow smoke | `apps/api/src/billing/*.ts`, `apps/api/src/routes/plan.ts`, `apps/api/src/ai/generation-service.ts`, `apps/api/src/ai/memory-retriever.ts` |
| 3 | Trainer/owner quota API + privacy-safe DTOs | PR3 | `pnpm --filter api test -- src/routes/__tests__/billing.test.ts src/routes/__tests__/auth.test.ts` | `pnpm --filter api dev` + owner/suspended-member quota-admin smoke | `apps/api/src/routes/billing.ts`, `apps/api/src/app.ts`, `packages/contracts/src/index.ts` |
| 4 | Web billing UI + i18n + final proof | PR4 | `pnpm --filter web test -- src/app/(app)/billing/__tests__/page.test.tsx src/app/(app)/billing/__tests__/billing-client.test.ts packages/i18n` | `pnpm --filter api dev` + `pnpm --filter web dev` on `/billing` tenant-switch/loading/offline/a11y smoke | `apps/web/src/app/(app)/billing/*`, `packages/i18n/src/messages/en.json`, `packages/i18n/src/messages/es.json` |

## Phase 1: Foundation / Data Model

- [x] 1.1 RED: Add failing tests for `11a-v1` backfill/trial/override scenarios in `apps/api/src/db/__tests__/billing-schema.test.ts` and `apps/api/src/db/repositories/__tests__/billing-backfill.test.ts`.
- [x] 1.2 GREEN: Implement `tenant_billing_*`, `member_quota_*`, `billing_usage_ledger`, and `billing_audit_events` in `apps/api/src/db/schema.ts` + `apps/api/drizzle/0011_billing_plans_tiers.sql`, and wire tenant trial provisioning in `apps/api/src/tenant/provisioning.ts`.
- [x] 1.3 TRIANGLE: Cover uniqueness/FK/non-negative/idempotent backfill and tenant-scoped audit inserts; update `packages/contracts/src/index.ts` billing DTOs.

## Phase 2: Core Billing / Gating

- [x] 2.1 RED: Add failing tests for `Hybrid Tenant Quotas`, `Generation Metering`, `Idempotent quota consumption retry`, `Empty operation key rejected`, and `Denied entitlement skips retrieval`.
- [x] 2.2 GREEN: Implement `apps/api/src/billing/*.ts` use cases and wire checks into `apps/api/src/routes/plan.ts`, `apps/api/src/ai/generation-service.ts`, `apps/api/src/ai/memory-retriever.ts`, and `apps/api/src/app.ts`.
- [x] 2.3 TRIANGLE: Prove atomic tenant+member consume, concurrency race safety, retry idempotency, and fail-closed denial without provider/embed/search work.

## Phase 3: Quota Admin API

- [ ] 3.1 RED: Add failing tests for `Member Quota Administration`, `Quota Privacy Boundary`, `Membership suspension blocks consumption`, and `Cross-tenant billing denied` in `apps/api/src/routes/__tests__/billing.test.ts`.
- [ ] 3.2 GREEN: Implement `apps/api/src/routes/billing.ts` and privacy-safe request/response DTOs in `packages/contracts/src/index.ts`; authorize owner/trainer, tenant-switch, and suspended-member cases.
- [ ] 3.3 TRIANGLE: Verify audit events, aggregate-only usage totals, and no access to member memories/prompts/health/private content.

## Phase 4: Web UI / Verification / Rollout

- [ ] 4.1 RED: Add failing web/i18n tests for `Billing State Visibility`, loading/empty/error/offline states, a11y, and EN/ES parity in `packages/i18n/src/messages/en.json` + `es.json`.
- [ ] 4.2 GREEN: Build `apps/web/src/app/(app)/billing/page.tsx` + client/actions to render tier/trial/usage/upgrade prompts and refresh on tenant switch.
- [ ] 4.3 TRIANGLE: Run runtime smoke + integration/concurrency proof, then write rollout/rollback notes and final evidence in `openspec/changes/11a-billing-plans-tiers/verify-report.md`.
