# Proposal: 16d — Admin Tier Provisioning (superadmin grant of trainer/gym tier)

GitHub #307. Real implementation. Model A B2B onboarding + HARD PREREQUISITE for 16c seat-billing Slice B.

## Intent

The `trainer`/`gym` billing tiers exist in the enum but are unreachable: the Stripe webhook hardcodes `pro` and no code INSERTs into `tenant_billing_overrides`. B2B tenants cannot be onboarded. This ships a superadmin-gated write path that GRANTS a tier via a `tenant_billing_overrides` INSERT. Because `resolveEffectiveTier` gives an active override unconditional precedence, this needs NO webhook change and makes the override tier-authoritative for 16c.

## Scope

### In Scope
- Pure use-case `GrantTenantTierOverride` + port in `billing/`; transactional Drizzle adapter (override INSERT + audit INSERT), mirroring `writeMemberAllocation`.
- Superadmin admin route (mirror `admin-ai-config.ts`, no `db/*` import) + `app.ts` registration, gated by `buildRequireAdmin`.
- Revoke path: UPDATE `endsAt = now()` + `admin_override_expired` audit (never DELETE).
- Additive migration relaxing `billingAuditEvents.actorUserId` FK to `users.id` (see Approach).
- Application-level overlap guard (reject grant when an active override already exists for the tenant).
- Tests.

### Out of Scope
- Backoffice UI (#306); gym subdomain-slug write path; 16c seat billing itself; any webhook change; DB-level overlap exclusion constraint.

## Capabilities

### New Capabilities
- `16d-admin-tier-provisioning`: superadmin-gated grant/revoke of trainer/gym tier via billing overrides, with audit.

### Modified Capabilities
- None at spec level (audit-FK relaxation is additive schema infra).

## Approach & Pinned Decisions

**1. Audit-FK blocker → Approach B (RECOMMENDED).** Relax `billingAuditEvents.actorUserId` composite membership FK to a plain `users.id` FK (additive migration). Justification: matches `tenant_billing_overrides.createdByUserId` (already no membership req), models a true platform superadmin, uses the scaffolded `admin_override_*` enum values. Tradeoff: touches the SHARED `billingAuditEvents` table (blast radius: `writeMemberAllocation` + all future consumers), but additive/backward-compatible. Rejected: (A) requiring a membership row per tenant is awkward; (C) skipping audit diverges from the `member_allocation_set` convention.

**2. Grant lifecycle.** Open-ended grant = far-future sentinel `endsAt`. Revoke = UPDATE `endsAt = now()` + `admin_override_expired` audit. Overlap prevention IN SCOPE at application level (guard in use-case); DB exclusion constraint deferred.

**Mixed tier/status signal** (`billing-visibility.ts` shows Stripe status while tier reads override): ACCEPTED as-is; no display change in scope (UI is #306).

**16c CONTRACT (must not break):** the override is tier-authoritative; `seatCount` is orthogonal metadata. This change must not couple tier to price mapping.

## Risks

| Risk | Likelihood | Mitigation |
|------|-----------|-----------|
| Migration on shared audit table | Med | Additive-only, backward compatible; test existing writers |
| Overlapping active overrides | Low | App-level guard now; constraint deferred |
| Mixed tier/status display | Low | Documented/accepted; UI in #306 |

## Rollback Plan
Revert route registration + use-case/adapter (feature dead, no data). Audit-FK migration is additive; leave in place or roll back separately.

## Success Criteria
- [ ] Superadmin can grant `trainer`/`gym`; non-admin gets 403.
- [ ] `resolveEffectiveTier` returns granted tier (`source: admin_override`).
- [ ] Revoke sets `endsAt = now()` + emits `admin_override_expired`; overlap grant rejected.
- [ ] Existing `writeMemberAllocation` audit writes unaffected.

## Proposal question round
Two product decisions need user confirmation before design:
1. Audit-FK: confirm Approach B (relax to `users.id`) vs. C (skip `billingAuditEvents`, lower blast radius).
2. Overlap prevention: confirm app-level guard now vs. fully deferred.
