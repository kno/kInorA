## Exploration: 11a-billing-plans-tiers

### Current State

kInorA has the auth, tenant, user, AI generation, tracking, progress, and memory foundations needed to introduce billing entitlements, but it does not yet have billing-state persistence or runtime feature gates. Registration creates a personal tenant, user, owner membership, default profile, credentials, and session in one transaction. Authenticated API routes resolve `request.authContext` with `tenantId`, `userId`, and `sessionId`; tenant-owned data such as plan drafts, plan specs, workout plans, workout sessions, and user memory vectors is scoped by both tenant and user. Some structured user-profile tables are user-scoped only, so 11a must be careful not to weaken tenant isolation when adding account-level billing state.

Existing product source of truth already names 11a as Free/Pro, a 30-day no-card Pro trial, feature gating, and upgrade prompts. Existing 11b is explicitly Stripe checkout, webhooks, and coupons; therefore 11a should create provider-independent billing and entitlement primitives, not Stripe objects. The landing page already markets Free, Pro, and Teams copy, but Teams is future-facing and there is no backend entitlement model behind the pricing UI. `/auth/profile` still documents that the plan badge defaults to Free until billing is implemented.

AI provider selection is a singleton admin configuration (`ai_provider_config`) and generation can consume paid external providers. Plan generation currently auto-runs when a confirmed `PlanSpec` is created and can be regenerated into additional `workout_plans` rows. Vector memory can add additional embedding cost and is intentionally fail-open when disabled or unavailable. These are the likely first paid/limited surfaces: number of active/generated plans, regenerate access or cadence, vector memory, advanced progress surfaces, and future chat/voice features.

### Affected Areas

- `openspec/specs/11a-v1-billing-plans-tiers/spec.md` — Current source spec is intentionally thin; proposal/spec should expand exact tier capabilities, trial lifecycle, entitlement decisions, and downgrade behavior.
- `openspec/specs/11b-v1-billing-stripe-integration/spec.md` — 11a must define a payment-provider-independent core so 11b can map Stripe webhooks to internal state without leaking Stripe into product gates.
- `apps/api/src/db/schema.ts` — Add billing/entitlement tables and enums near tenant/user ownership: likely account or tenant subscription state, trial timestamps, plan tier, status, cancellation/grace metadata, and optional entitlement overrides. Avoid Stripe IDs in 11a.
- `apps/api/src/tenant/provisioning.ts` and `apps/api/src/auth/service.ts` — Registration is the correct provisioning point for the default Free + 30-day Pro trial state; it already owns the tenant/user/membership/profile transaction.
- `apps/api/src/auth/plugin.ts` and route pre-handlers — Existing `requireAuth()` gives tenant/user scope; 11a likely needs a separate entitlement guard/port used by premium endpoints, not embedded directly in auth.
- `apps/api/src/routes/plan.ts` and `apps/api/src/plan-route-repo.ts` — Confirm/generate/regenerate flows are the first place to enforce plan-generation limits, active-plan limits, and premium regenerate behavior.
- `apps/api/src/ai/generation-service.ts` and vector-memory services — Paid surfaces that create provider cost should check entitlements before starting expensive work; vector memory should preserve its fail-open safety semantics for technical failures but not bypass explicit product gates.
- `apps/api/src/routes/user-memories.ts` — Memory management and creation may be gated by Pro/trial while reads/deletes/settings should remain available for privacy/control even after downgrade.
- `apps/api/src/routes/admin-ai-config.ts` — Admin-only provider config should stay operationally separate from user billing; billing must not expose or persist API keys.
- `packages/contracts/src/index.ts` — Add shared DTOs for billing state, tier, trial, entitlement decisions, upgrade prompt payloads, and API request/response shapes.
- `apps/web/src/components/landing/LandingPricing.tsx` and `packages/i18n/src/messages/{en,es}.json` — Existing static pricing copy should align with actual entitlements and trial messaging.
- `apps/web` authenticated shell/account/sidebar surfaces — Need a real tier/trial badge and upgrade prompt state instead of hardcoded/default Free assumptions.
- `openspec/specs/05b-v1-security-tenant-validation/spec.md` — Billing reads/writes must preserve fail-closed authorization and cross-tenant rejection.

### Approaches

1. **Tenant-owned entitlement core, provider-independent billing state** — Persist billing plan/status/trial at tenant scope, expose an entitlement-read API, and gate premium features through route/use-case guards. Keep payment-provider details out until 11b.
   - Pros: Matches current data ownership model, supports future Trainer/B2B tenants, cleanly separates 11a from Stripe, gives every paid feature one decision source.
   - Cons: Requires decisions for personal users in multi-tenant futures, and trial provisioning must be backfilled for existing tenants.
   - Effort: Medium

2. **User-owned billing state only** — Persist tier/trial by `userId`, matching today’s mostly personal account usage and some existing user-scoped profile/preferences tables.
   - Pros: Simpler for v1 personal accounts; easier account-area display.
   - Cons: Conflicts with tenant-owned data and future trainer/B2B roadmap, ambiguous when a user belongs to multiple tenants, harder to enforce tenant-scoped feature usage safely.
   - Effort: Low initially, Medium/High later

3. **Feature flags only, no durable billing state** — Add static environment/config gates and UI prompts without persistent plans/trials.
   - Pros: Very small implementation, useful for demos.
   - Cons: Does not satisfy 30-day trials, upgrades/downgrades, cancellation, grace periods, or 11b webhook mapping; creates throwaway logic.
   - Effort: Low, but strategically wrong

### Recommendation

Use **tenant-owned entitlement core, provider-independent billing state** for 11a. Treat the personal workspace tenant as the billable account for v1; the owner receives Free plus a 30-day Pro trial at provisioning, while entitlement checks are evaluated against `(tenantId, actorUserId, feature)` from the authenticated session. This preserves Clean Architecture boundaries and future Trainer/B2B extensibility while keeping Stripe-specific checkout, webhook IDs, coupons, invoice semantics, and payment retries out of 11a.

11a should define an internal entitlement decision model such as `allowed | denied`, `tier`, `source` (`free`, `trial`, `pro`, `override`, `grace`), `reason`, `trialEndsAt`, and optional `upgradePrompt`. Feature gates should live at API/use-case boundaries before expensive operations start. Web gates can improve UX, but API gates must be authoritative.

Suggested 11a scope:

- Provision billing state for every new tenant during auth/tenant provisioning.
- Backfill existing tenants with deterministic Free/trial state or an explicit migration decision.
- Expose authenticated billing-state read endpoint for account/sidebar/UI.
- Gate the first cost-bearing/product-differentiating features, likely plan generation/regeneration count and vector-memory write/retrieval; preserve read/delete/privacy controls.
- Implement downgrade/cancellation/grace states as internal lifecycle fields, with manual/test-state mutation only if needed before Stripe.
- Emit safe audit/telemetry for entitlement denials without logging sensitive tenant or health data.

Keep out of 11a:

- Stripe checkout sessions, customer/subscription IDs, webhooks, coupon validation, invoice/payment failures, card management, and billing portal links.
- Trainer/Teams/B2B active behavior beyond schema/extensibility placeholders.
- Hard dependencies from domain/contracts to Stripe or API infrastructure.

### Risks

- Tenant-vs-user ownership is the core architecture fork. Choosing user-owned billing now would create migration pressure for Trainer/B2B and cross-tenant users.
- Existing tenants/users need migration/backfill semantics; otherwise old accounts may get no trial, a repeated trial, or inconsistent Free/Pro state.
- Trial expiration must be computed from server time and persisted timestamps, not client state, or premium access can be spoofed.
- API gates must be authoritative. UI-only upgrade prompts would not protect AI provider cost or tenant data.
- Downgrade/cancellation must not remove user data blindly. Privacy-sensitive memory reads/deletes/settings should remain available even when writes/retrieval are gated.
- Vector memory currently fails open for technical unavailability; entitlement denials must be explicit product decisions, not treated as technical fallback.
- Plan-generation limits need a precise metric: total generated plans, active ready plans, regenerations per period, or premium-only advanced generation. Ambiguity here will destabilize specs and tests.
- 11b needs idempotent Stripe webhook mapping; 11a must include stable internal statuses that can receive future provider events without schema churn.

### Product Decisions / Questions for Proposal

- What is the v1 billable unit: personal tenant/workspace, individual user, or account owner? Recommendation: tenant/workspace for v1.
- What exactly does Free include: one active plan, limited regenerations, basic tracking, basic stats, no vector memory, no voice/chat?
- What exactly does Pro/trial unlock: unlimited plans, regenerate, vector memory, advanced stats, future chat/voice, exercise library?
- Does the 30-day trial start on tenant creation, first login, first premium feature use, or first plan generation? Recommendation: tenant creation for deterministic enforcement.
- After trial expiry, should existing generated plans and completed workout history remain readable/tracked? Recommendation: yes; block new premium writes/expensive operations only.
- What grace behavior exists for failed payment/cancellation after 11b? Recommendation: model `grace_period` in 11a but activate payment-failure transitions in 11b.
- Can an admin manually grant Pro/extend trials before Stripe exists? If yes, define an auditable override mechanism.
- Should Free users be limited by absolute counts or rolling-period quotas? This affects schema and tests.
- What is the user-facing upgrade prompt copy and destination before Stripe checkout exists? Recommendation: internal pricing/account CTA placeholder, not Stripe.
- Should Teams remain marketing-only in v1, or should the schema include inactive future tier values? Recommendation: contracts may reserve future-compatible values only if gates still support Free/Pro explicitly.

### Ready for Proposal

Yes. The proposal should frame 11a as the provider-independent entitlement and billing-state foundation for Free/Pro/trial gates, explicitly deferring Stripe/payment/coupons to 11b. It should make tenant/workspace ownership, trial start, Free/Pro feature matrix, downgrade data-access rules, and rollout/backfill behavior explicit before spec/design.
