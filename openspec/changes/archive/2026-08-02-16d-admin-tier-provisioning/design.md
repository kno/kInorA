# Design: 16d — Admin Tier Provisioning

## Technical Approach

Ship a superadmin-gated grant/revoke write path for `trainer`/`gym` tier via a
`tenant_billing_overrides` INSERT. Because `resolveEffectiveTier` (`entitlement.ts:69-71`)
returns an active override's tier with unconditional precedence (`source: "admin_override"`),
NO webhook change is needed. Two pure use-cases (`billing/tier-override-admin.ts`) depend on a
narrow port; one transactional Drizzle adapter (`db/repositories/tier-override-admin.ts`) mirrors
`writeMemberAllocation` (`billing-admin.ts:115-153`); one admin route
(`routes/admin-tier-override.ts`) mirrors `admin-ai-config.ts` (route declares its own port, zero
`db/*` import → satisfies dep-cruiser `routes-no-db-layer`); `app.ts` composes them near line 485.
Prereq: an additive migration relaxes the `billingAuditEvents.actorUserId` FK.

## Architecture Decisions

| Decision | Choice | Rejected | Rationale |
|----------|--------|----------|-----------|
| Audit FK | **B** — drop composite `(tenantId,actorUserId)→memberships` FK; add plain `actor_user_id→users.id` FK | A: require superadmin membership row per tenant; C: skip audit | Models a true platform superadmin; matches `tenant_billing_overrides.createdByUserId` (already plain `users.id`); uses scaffolded `admin_override_*` enum. Additive/backward-compatible. |
| Open-ended grant | `endsAt = 9999-12-31T00:00:00Z` sentinel | Nullable `endsAt` (schema forbids: NOT NULL + `endsAt>startsAt` check) | Satisfies existing constraints; sorts last in the `.orderBy(endsAt)` asc active-override query so resolution is stable; well within timestamptz range (max 294276 AD); UI-distinguishable. |
| Revoke | `UPDATE endsAt=now()` + `admin_override_expired` audit, never DELETE | Row DELETE | Preserves audit trail; window-based read (`endsAt>now`) naturally excludes it. |
| Overlap | **Reject with 409** when an active override exists (grant); one-active-per-tenant invariant | Silent supersede | Explicit superadmin action; supersede would hide a prior grant and mask mistakes. Revoke-then-grant is the explicit re-grant path. DB exclusion constraint deferred (noted). |
| Superadmin gate | `requireAuth() + buildRequireAdmin` (global `users.is_admin`) | Per-tenant owner check | The only admin gate; superadmin is a global, tenant-agnostic role. |
| Revoke verb | `POST .../revoke` | `DELETE` | State transition (sets `endsAt`, emits audit), not resource removal; no override id in path. |

## Data Flow

    POST /admin/tenants/:tenantId/tier-override
      → requireAuth → requireAdmin(is_admin)
      → GrantTenantTierOverride.execute(input)
          port.loadTenant           → 404 if null
          port.loadActiveOverride   → 409 if present (overlap)
          port.grantTierOverride    ┐ ONE tx:
             INSERT tenant_billing_overrides (tier, startsAt=now, endsAt=sentinel, createdByUserId, reason)
             INSERT billing_audit_events (action=admin_override_created, actorUserId, metadata:{tier,reason,overrideId})
          └→ 201 { id, tenantId, tier, startsAt, endsAt, reason }

    POST /admin/tenants/:tenantId/tier-override/revoke
      → gate → RevokeTenantTierOverride.execute
          port.loadActiveOverride   → 409 no_active_override if null
          port.revokeTierOverride   ┐ ONE tx: UPDATE endsAt=now WHERE id; INSERT audit admin_override_expired
          └→ 200 { id, tenantId, endsAt }

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `apps/api/src/billing/tier-override-admin.ts` | Create | `TierOverrideAdminPort`, `GrantTenantTierOverride`, `RevokeTenantTierOverride`, input/outcome types |
| `apps/api/src/db/repositories/tier-override-admin.ts` | Create | `TierOverrideAdminRepository` — transactional grant/revoke + audit, `loadTenant`, `loadActiveOverride` |
| `apps/api/src/routes/admin-tier-override.ts` | Create | Route + narrow `AdminTierOverrideRouteRepo` port + zod validation; no `db/*` import |
| `apps/api/src/db/schema.ts` | Modify | `billingAuditEvents`: remove `actorMembershipFk`; add `.references(()=>users.id)` on `actorUserId` |
| `apps/api/drizzle/0012_*.sql` (+ snapshot/meta) | Create | Drop composite FK; add plain FK (drizzle-kit generated) |
| `apps/api/src/app.ts` | Modify | Build adapter + route port, `app.register(adminTierOverrideRoutes, { repo })` near line 495 |

## Interfaces / Contracts

```ts
interface TierOverrideAdminPort {
  findUserById(id: string): Promise<{ id: string; isAdmin: boolean } | null>; // feeds requireAdmin
  loadTenant(tenantId: string): Promise<{ id: string } | null>;
  loadActiveOverride(tenantId: string, now: Date): Promise<{ id: string } | null>;
  grantTierOverride(input: GrantInput): Promise<{ id: string; startsAt: Date; endsAt: Date }>;
  revokeTierOverride(input: { tenantId: string; overrideId: string; actorUserId: string; now: Date })
    : Promise<{ id: string; endsAt: Date }>;
}
// GrantInput: { tenantId; actorUserId; tier: "trainer"|"gym"; reason: string; startsAt: Date; endsAt: Date }
// Body zod: tier ∈ {trainer,gym}, reason non-empty; startsAt/endsAt optional (default now / sentinel), endsAt>startsAt
```

Status codes: 201 grant / 200 revoke; 403 non-admin; 404 unknown tenant; 409 overlap (grant) or no-active-override (revoke); 422 zod failure.

### Migration (additive, reversible)

```sql
ALTER TABLE "billing_audit_events" DROP CONSTRAINT "billing_audit_events_tenant_actor_memberships_fk";--> statement-breakpoint
ALTER TABLE "billing_audit_events" ADD CONSTRAINT "billing_audit_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
```

Workflow: edit `schema.ts` → `pnpm --filter @kinora/api exec drizzle-kit generate` → commit generated `0012_*.sql` + `drizzle/meta` snapshot. Down = drop plain FK, re-add composite.

**Blast-radius check (confirmed safe):** `writeMemberAllocation` inserts `actorUserId` = an active owner, who is always a valid `users.id`, so the relaxed FK still holds. No query JOINs on this FK (the adapter reads `memberships` directly by column predicate; FKs are constraints, not joins). `billing-schema.test.ts:176` asserts the *0011* immutable migration text → unaffected. Only a live-schema/snapshot assertion of the composite FK (if any) needs updating in TDD.

## Testing Strategy

| Layer | What | Approach |
|-------|------|----------|
| Unit | Grant: happy path (sentinel `endsAt`, `admin_override_created`); 404 unknown tenant; 409 overlap; 422 bad tier / empty reason. Revoke: happy (`endsAt=now`, `admin_override_expired`); 409 no active override | Fake `TierOverrideAdminPort`, assert outcomes + port calls |
| Integration | Non-member superadmin grants → real-Postgres tx writes override + audit `admin_override_created` (relaxed FK accepts a non-membership actor); revoke updates + audits | Real-Postgres suite (mirror `billing-admin.integration.test.ts`) |
| Integration | **16c composition** — with an active override (`tier=gym`) AND a `tenant_billing_states` row, `loadContext`→`resolveEffectiveTier` returns `gym`/`admin_override` while the billing-state metadata (future `seatCount`) read path is untouched (tier orthogonal to seats) | Real-Postgres via billing-quota `loadContext` |
| Route | 403 non-admin (`is_admin=false`); 201 admin grant; 409 overlap; 422 validation | Fastify inject, mirror admin-ai-config route test |

## Threat Matrix

N/A — no routing-shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary. HTTP admin route only, gated by existing `requireAuth`+`requireAdmin`.

## Migration / Rollout

Single additive migration (audit FK relaxation) is backward-compatible; deploy before/with the feature. Rollback: revert route registration + use-case/adapter (feature dead, no data). Migration may stay or roll back separately.

## Task Slice Estimate

**One PR.** Rough authored lines: use-cases ~120, adapter ~90, route ~90, schema+migration ~10, app.ts ~12 = ~320 non-test; tests ~300+. Total ~600–650. `400-line budget risk: Medium`. `Chained PRs recommended: No` (cohesive vertical slice; splitting the migration from its only consumer adds coordination cost). Fallback if it exceeds 800 in review: Slice A = migration + adapter + integration test; Slice B = use-cases + route + unit/route tests.

## Open Questions

- [ ] Confirm no live-schema snapshot test asserts the composite audit FK (grep clean so far; verify during RED).
