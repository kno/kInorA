# Exploration — 16d-admin-tier-provisioning (superadmin grant of trainer/gym tier)

GitHub issue: #307. Real implementation change (not a spike). Model A B2B onboarding + HARD
PREREQUISITE for 16c seat-billing.

## Goal

A superadmin-gated write path that GRANTS the `trainer`/`gym` tier to a tenant by inserting a
`tenant_billing_overrides` row. Today these tiers are unreachable (webhook hardcodes `pro`; the
overrides table has NO INSERT in `apps/api/src`).

## Current State (file:line confirmed)

- **`tenant_billing_overrides`** (`schema.ts:263-290`): `id, tenantId (FK tenants, cascade),
  tier (billingTierEnum), startsAt, endsAt (both timestamptz NOT NULL), createdByUserId (FK users.id
  NOT NULL), reason (text NOT NULL), createdAt`. Check `endsAt > startsAt`. **`createdByUserId` FKs
  directly to `users.id`, NOT a membership composite** — a global superadmin with no membership in the
  target tenant CAN already be the override creator.
- **`billingTierEnum`** (`schema.ts:113`) already `["free","pro","trainer","gym"]` — tiers exist; only
  the write path is missing.
- **`billingAuditActionEnum`** (`schema.ts:152-156`) already contains `"admin_override_created"` and
  `"admin_override_expired"` — scaffolded for this feature; referenced ONLY in schema tests, zero app
  INSERT code uses them.
- **`resolveEffectiveTier`** (`entitlement.ts:68-107`), lines 69-71:
  `if (ctx.activeOverrideTier) return { tier: ctx.activeOverrideTier, source: "admin_override", ... }`
  — an **unconditional early return**. An active override wins over the `tenant_billing_states` row
  regardless of that row's tier/status/source. **This is the crux: an override grants the tier with
  zero webhook changes.**
- Three read adapters duplicate the same active-override query (`tenantId = ? AND startsAt <= now AND
  endsAt > now`, `.orderBy(endsAt)` asc, **no `.limit(1)`**): `billing-quota.ts:59-69`,
  `billing-visibility.ts:54-64`, `billing-admin.ts:65-108`. With no `.limit(1)`, overlapping active
  rows resolve to the soonest-expiring one; no unique/exclusion constraint prevents overlap.
- **Stripe webhook** (`process-webhook.ts:197-214`) hardcodes `tier: "pro"` (line 204).
  `grep seatCount|seat_count apps/api/src` → zero matches: 16c has not landed.
- **`billing-visibility.ts` DTO** (118-139): `status: ctx.billing?.status ?? "overridden"`. When a real
  `tenant_billing_states` row AND an active override coexist, surfaced `status` reports the underlying
  Stripe status (e.g. `"active"`), not `"overridden"` — tier reads `trainer` while status reads
  `active` from an unrelated Pro sub. Mixed-signal risk.
- **`billingAuditEvents`** (`schema.ts:443-465`): `actorUserId` has a COMPOSITE FK
  `(tenantId, actorUserId) → memberships(tenantId, userId)` (457-461). `users.isAdmin` (`schema.ts:174`)
  is a single GLOBAL boolean, no tenant scope. **CENTRAL BLOCKER**: a global superadmin acting on a
  tenant they are NOT a member of cannot satisfy this FK if the write path reuses `billingAuditEvents`
  the way `writeMemberAllocation` does.
- **`require-admin.ts`** — `buildRequireAdmin(userRepo)`: 403 if no `authContext`, 403 if `!user.isAdmin`
  (read fresh from DB). The only admin gate; "superadmin" = the single `users.is_admin` flag.
- **Admin route precedent**: `routes/admin-ai-config.ts` (registered `app.ts:485-495`). Route defines a
  narrow port; `app.ts` (sole composition root) builds the Drizzle object and injects via
  `fastify.register(routes, { repo })`. Zero `db/*` import in the route → satisfies dep-cruiser
  `routes-no-db-layer` (`.dependency-cruiser.cjs:160-166`).
- **Closest write use-case**: `BillingAdminRepository.writeMemberAllocation` (`billing-admin.ts:110-153`)
  — one `db.transaction` doing upsert + `billingAuditEvents` insert atomically. Template to mirror for
  `admin_override_created`.
- **`tenant_branding`** (`schema.ts:1038-1084`, 16a): keyed by `tenantId` PK, own unique
  `subdomainSlug`, NO FK to `tenant_billing_overrides`; its own write route hasn't shipped either. Tier
  grant and slug set are fully independent operations.

## Key questions resolved

1. **Tier source for B2B = admin override alone.** Because `resolveEffectiveTier` gives an active
   override unconditional precedence, granting trainer/gym needs ONLY an override INSERT — no webhook
   price→tier mapping. This **simplifies 16c Slice B**: the webhook stays tier-agnostic (keeps writing
   `pro`) and only adds `seatCount`; the override (this change) is tier-authoritative. Valid only if
   16c commits to treating the override as tier source and `seatCount` as orthogonal — a downstream
   commitment (now recorded in 16c design).
2. **Write-path shape**: new pure use-case (`GrantTenantTierOverride`) + port in `billing/`, Drizzle
   adapter doing a transactional override INSERT + audit insert, admin route mirroring
   `admin-ai-config.ts`, `app.ts` registration. Satisfies the architecture guard.
3. **Overlap with a real subscription**: tier from override wins; status still surfaces the billing
   row's status → mixed signal (documented risk, decide display in design).
4. **Grant lifecycle**: `endsAt` is NOT NULL with `endsAt > startsAt`, so no schema "forever". Recommend
   revoke = UPDATE `endsAt = now()` + `admin_override_expired` audit (never DELETE); open-ended grant =
   far-future sentinel date, decided in design.
5. **UI dependency**: this change ships the superadmin API/domain write path (+ tests); the backoffice
   UI is deferred to #306. Clean split.
6. **Gym slug coupling**: independent — tier grant and slug set can ship separately.

## Two decisions to pin in propose/design (before apply)

- **Audit FK blocker**: how the superadmin satisfies/bypasses `billingAuditEvents.actorUserId`'s
  composite membership FK. Recommended (Approach 2): relax it to a plain FK on `users.id` (additive
  migration) — matches `tenant_billing_overrides.createdByUserId` which already has no membership
  requirement, and uses the scaffolded audit actions as intended.
- **Grant/renewal/revoke convention** for `endsAt` (open-ended sentinel vs mandatory renewal; revoke via
  `endsAt=now`).

## Approaches for the audit FK
1. Mirror `writeMemberAllocation`, require actor membership in target tenant (awkward: superadmin needs a
   membership row per tenant). Medium.
2. **Relax `billingAuditEvents.actorUserId` to a plain FK on `users.id`** (additive migration). Models a
   true platform superadmin; matches the overrides table precedent. **Recommended.** Medium.
3. Skip `billingAuditEvents`; audit only via the override row's own `createdByUserId`/`reason`/`createdAt`.
   Zero migration but ignores the scaffolded enum values and diverges from convention. Low.

## Risks
- Audit FK blocker must be resolved before apply.
- No constraint prevents overlapping active override rows (soonest-expiring wins; undefined tie-break).
- Mixed tier/status signal when a Stripe sub and an override coexist.
- The 16c simplification holds only if 16c treats the override as tier-authoritative (now recorded).
- Open-ended-grant/revoke convention undefined in code today.

## Ready for proposal: Yes
Two decisions (audit FK, grant lifecycle) to pin in propose/design before apply.
