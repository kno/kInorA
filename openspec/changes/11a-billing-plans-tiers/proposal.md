# Proposal: Billing Plans and Tiers

## Intent

Advance README roadmap `11a-v1-billing-plans-tiers` with provider-independent Free/Pro billing state for personal and trainer-managed tenants. Billing, usage, and quotas are tenant-scoped: users may belong to multiple tenants, but usage never follows them between tenants.

## Proposal Question Round

Confirmed correction: tenants may be personal or trainer-managed; subscriptions belong to tenants; AI quotas use tenant aggregate plus per-member limits consumed atomically; trainer quota administration must not expose member private memory, health details, prompts, or private content.

## Scope

### In Scope
- Tenant plan/status/trial lifecycle, entitlement decisions, and deterministic backfill.
- Hybrid quotas: tenant aggregate limits plus configurable per-member allocations.
- Atomic AI consumption denied when tenant quota, member quota, or membership status fails.
- Authorized/audited owner/trainer quota management and non-sensitive usage totals.
- Billing-state read contracts for tenant/account badges and upgrade prompts.

### Out of Scope
- Stripe IDs, checkout, webhooks, payment methods, coupons, invoices, tax; deferred to 11b.
- Moving usage/quotas between tenants when a user changes membership.
- Trainer access to member vector memories, health details, prompts, or private content.
- Full trainer dashboard workflows beyond quota administration primitives.

## User Stories
- As a personal-tenant owner, I see my tenant tier/trial and consume my own quota.
- As a trainer tenant owner, I allocate member quotas while controlling total AI cost.
- As a member, my AI operations stop when my allocation, tenant quota, or membership ends.
- As a multi-tenant user, each tenant has separate billing, usage, and limits.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `11a-v1-billing-plans-tiers`: Expand lifecycle, entitlements, backfill, overrides, downgrade behavior, and UI visibility.
- `05b-v1-security-tenant-validation`: Require tenant-scoped, fail-closed billing reads/writes and denial semantics.
- `08-v1-ai-plan-generation`: Gate cost-bearing generation/regeneration before expensive work starts.
- `10b-v1-user-memory-vector`: Gate premium memory write/retrieval while preserving list/delete/settings controls.

## Approach

Persist tenant-scoped billing, member quota allocation, usage ledger, and audit rows. Provision Free plus 30-day Pro trial at tenant creation; backfill existing tenants without user-level carryover. Add an entitlement service evaluating `(tenantId, actorUserId, feature)` before expensive work. AI consumption writes tenant and member usage in one transaction.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `apps/api/src/db/schema.ts` | New | Tenant billing, member quotas, usage ledger, audit fields. |
| `apps/api/src/tenant/provisioning.ts` | Modified | New-tenant trial provisioning. |
| `apps/api/src/routes/plan.ts` | Modified | Generation/regeneration limits. |
| `apps/api/src/routes/user-memories.ts` | Modified | Premium gates, privacy controls preserved. |
| `packages/contracts/src/index.ts` | Modified | Billing DTOs and entitlement contracts. |
| `apps/web` | Modified | Real tier/trial badge and upgrade prompt state. |

## Migration, Backfill, and Security

- Backfill one billing state per tenant, not per user; no quota or usage migration across tenants.
- Suspended/revoked memberships cannot consume quota in that tenant.
- Owner/trainer quota changes require authorization and audit records.
- Usage totals exposed to trainers must be non-sensitive aggregates only.

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| User-scoped billing leaks across tenants | Med | Persist and check all billing state by tenant. |
| Partial quota writes miscount AI usage | Med | Atomic tenant+member ledger transaction. |
| Trainer visibility leaks private data | Med | Aggregate-only contracts and authorization tests. |

## Rollback Plan

Revert entitlement guards and quota writes, preserve billing/audit tables inertly, and restore current Free UI defaults. Backfilled rows remain tenant-scoped for later correction.

## Dependencies

- Auth tenant context, membership status, tenant isolation, AI generation, and vector memory specs.

## Success Criteria

- [ ] Personal and trainer-managed tenants resolve one authoritative billing state.
- [ ] AI consumption decrements tenant and member quotas atomically or is denied.
- [ ] Suspended/revoked memberships cannot consume tenant quota.
- [ ] Owner/trainer quota changes are authorized, audited, and privacy-preserving.
- [ ] No Stripe/payment concepts appear in 11a contracts or persistence.
