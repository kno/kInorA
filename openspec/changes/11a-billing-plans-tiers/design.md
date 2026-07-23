# Design: Billing Plans and Tiers

## Technical Approach

Add a provider-independent billing core owned by tenants, not users. Personal and trainer-managed tenants share one billing state; AI usage is metered by tenant aggregate period counters plus per-member `(tenantId,userId)` allocations. Plan generation/regeneration and premium vector-memory write/retrieval call billing use cases before `workout_plans` creation, provider generation, embedding, or vector search.

## Architecture Decisions

| Decision | Choice | Rejected | Rationale |
|---|---|---|---|
| Billable scope | `tenant_id` billing state with member allocations | User-global billing | Users may belong to many tenants; usage must not follow tenant switches. |
| Quota model | Hybrid tenant pool + member cap | Shared-pool-only | Trainers need total cost control and per-member fairness. |
| Consumption | One DB transaction: membership check, entitlement, tenant counter, member counter, ledger insert/update | Separate checks then consume | Prevents partial consumption and overuse under concurrency. |
| Privacy | Aggregate/member count DTOs only | Trainer-visible prompts/memories | Quota administration must not disclose health, prompt, memory, or generated private content. |
| 11b boundary | No Stripe/payment fields in 11a | Early Stripe IDs/webhooks | 11b maps provider events later without contaminating internal contracts. |

## Data Flow

```text
authContext(tenantId,userId)
  -> BillingUseCase.checkAndConsume(feature, operationKey)
     -> tx: active membership + billing/override + tenant bounds + member allocation
     -> tx: idempotency ledger + conditional tenant/member counter increments
  -> allowed: create generating plan / embed / retrieve
  -> denied: safe code + upgrade metadata; no expensive work
```

Technical vector retrieval failures still fail open only after entitlement is allowed. Product entitlement denial skips retrieval and cannot be used as fallback.

## File Changes

| File | Action | Description |
|---|---|---|
| `packages/contracts/src/index.ts` | Modify | Billing DTOs, denial codes, quota admin requests/responses, privacy-safe usage DTOs. |
| `apps/api/src/db/schema.ts`, `apps/api/drizzle/0011_billing_plans_tiers.sql` | Modify/Create | Tenant billing, overrides, member allocations, aggregate/member counters, idempotency ledger, indexes. |
| `apps/api/src/billing/*` | Create | Entitlement, quota consumption, quota management, override, audit ports/use cases. |
| `apps/api/src/tenant/provisioning.ts` | Modify | Create tenant-owned 30-day Pro trial for new personal/trainer tenants. |
| `apps/api/src/app.ts` | Modify | Compose billing repositories/use cases into plan, memory, billing routes. |
| `apps/api/src/routes/plan.ts`, `apps/api/src/ai/generation-service.ts` | Modify | Require operation keys; gate before `createGenerating` and provider calls. |
| `apps/api/src/routes/user-memories.ts`, `apps/api/src/ai/memory-retriever.ts` | Modify | Gate premium writes/retrieval before embedding/search; preserve list/delete/settings. |
| `apps/api/src/routes/billing.ts` | Create | Tenant billing read and owner/trainer quota-management endpoints. |

## Interfaces / Contracts

Tables: `tenant_billing_states(tenant_id pk, tier, status, source, trial_started_at, trial_ends_at)`, `tenant_billing_overrides(tenant_id, tier, starts_at, ends_at, created_by_user_id, reason)`, `tenant_quota_counters(tenant_id, feature, period, used, limit)`, `member_quota_allocations(tenant_id,user_id,feature,period,limit, updated_by_user_id)`, `member_quota_counters(tenant_id,user_id,feature,period,used,limit)`, `billing_usage_ledger(tenant_id,user_id,feature,period,operation_key,decision,reason, unique tenant/user/feature/period/operation_key)`, `billing_audit_events`.

Indexes/constraints: FK every tenant/user pair through memberships, unique allocation/counter keys, unique operation key, non-negative limits/usage, `used <= limit`, override `ends_at > starts_at`, and period indexes for reads/backfill. Transaction uses row locks or conditional `UPDATE ... WHERE used < limit`; any failed tenant/member condition rolls back all writes. Retried operation keys return the original decision without consuming again.

Use cases: `CheckEntitlement`, `CheckAndConsumeQuota`, `SetMemberAllocation`, `GetTenantUsage`, `CreateAdminOverride`. Owner/trainer operations authorize active owner/trainer membership, validate allocation totals against plan bounds, emit audit events, and return only tenant/member counts. Denials: `operation_key_required`, `inactive_membership`, `billing_state_unavailable`, `premium_required`, `trial_expired`, `tenant_quota_exhausted`, `member_allocation_exhausted`, `allocation_out_of_bounds`, `unauthorized_quota_admin`.

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | trial expiry, override precedence, plan bounds, denial mapping | Vitest with fake clock. |
| Integration | idempotent transaction, concurrent final-unit race, backfill, membership switch/suspend/revoke | Drizzle/Fastify tests. |
| AI/API | no plan row/provider/embed/search on denial; memory fail-open only after allow | Mock providers/retrievers. |
| Web | badges/prompts refresh on tenant switch; i18n parity | Existing web tests when UI slice follows. |

## Threat Matrix

| Boundary | Applicability | Design response | Planned RED tests |
|---|---|---|---|
| Documentation-like paths | N/A: no executable-file classification | None | None |
| Git repository selection | N/A: no VCS automation | None | None |
| Commit state | N/A: no commit automation | None | None |
| Push state | N/A: no push automation | None | None |
| PR commands | N/A: no PR automation | None | None |

## Migration / Rollout

Additive migration backfills existing tenants to Free/source `backfill` idempotently, with no retroactive trials or cross-tenant usage migration. New tenant creation writes Pro trial/source `system`. Admin overrides are tenant-scoped, audited, time-limited, and expire to underlying state. Roll out read endpoints, then gates; rollback disables gates and leaves inert rows for 11b recovery.

## Open Questions

- [ ] None blocking; Stripe checkout, webhooks, tax, invoices, coupons, payment methods, and provider IDs are explicitly 11b.
