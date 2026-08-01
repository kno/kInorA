## Exploration: 15b-v2-trainer-dashboard-branding

### Current State

**Authorization primitive (15a, on main).** `resolveAuthorizedOwner(ctx, deps, requestedOwnerUserId?)` (`apps/api/src/trainer/owner-access.ts:75`) is the single deny-by-default choke point: self path returns `ctx.actorUserId` unchanged; the widening path requires `ctx.role === "trainer"` AND the actor's resolved billing tier is `"trainer"` (`assertTrainerEntitled`, line 113) AND an ACTIVE row in `trainer_client_assignments` (`TrainerAssignmentRepository.findActiveAssignment`). Any failure throws `ForbiddenOwnerAccess` (line 27), mapped to a flat 403 everywhere it's used — no leakage of which check failed.

This is ALREADY proven for a per-client write route: `POST /clients/:clientUserId/plan-specs` (`apps/api/src/routes/plan.ts:790-849`) resolves `ownerUserId` via `resolveAuthorizedOwner(ctx, trainerAccess, clientUserId as UserId)`, then calls the exact same repo methods (`repo.promoteDraftToSpec(tenantId, ownerUserId, ...)`, `generationService.startGeneration(tenantId, ownerUserId, ...)`) unmodified — only WHO computes `ownerUserId` differs. A trainer-dashboard read route (`GET /trainer/clients/:clientUserId/dashboard`) would follow this identical shape.

`apps/api/src/routes/trainer.ts` has invite (`POST /trainer/clients/invite`), accept (`POST /trainer/clients/accept`), and list (`GET /trainer/clients`) — none resolve a specific client's data ownership; list is scoped to `listByTrainer(tenantId, actorUserId)`.

**Dashboard/progress read paths already parameterized by userId, not session.** `WorkoutSessionRepository.getDashboardSummary(tenantId, userId, now)` (`apps/api/src/db/repositories/workout-session.ts:696`) takes `userId` as an explicit argument — it is NOT derived internally from a session context. It already computes: `streak`, `recentDailyCompletion`, `weeklyCompleted`/`weeklyPlanned` (current calendar week only), `weeklyRollup` (per-day load), and a single `adaptation` slot folding `computeAdherenceAdaptation` (packages/domain/src/progress/adherence-adaptation.ts:58 — 4-week rolling adherence %, `AdherenceSnapshot`) and `computeRpeAdaptation` (packages/domain/src/progress/rpe-adaptation.ts:70 — 3-session mean-RPE window, `RpeSnapshot`), with adherence-wins precedence. `DashboardSummaryDTO` (packages/contracts/src/index.ts:966-989) does NOT expose: a completion-rate percentage over an arbitrary period, a recent-sessions list, or a multi-point RPE trend — only the single-window snapshots folded into `adaptation`. The route `apps/api/src/routes/progress.ts:51` (`/progress/dashboard`) calls this for the SELF actor only (no owner-param routing yet).

**Plan rendering / branding seam.** `PlanSpec` (packages/contracts/src/index.ts:332-360) has no branding field; `PlanWeekView` (apps/web/src/app/(app)/plan/PlanWeekView.tsx:54) and `PlanStatusView` (apps/web/src/app/(app)/plan/[id]/PlanStatusView.tsx:36) render the plan name/topbar from hardcoded `t("plan.hero...")` i18n keys and CSS module classes (`plan-week-view.module.css`) — no per-plan color/theming injection point exists on web. Mobile has a static design-token file `apps/mobile/src/theme/tokens.ts:15` (`colors` const, no per-entity override mechanism). Adding branding would mean: (a) a new `branding?: { trainerName?: string; title?: string; colors?: {...} }` field on `PlanSpec` (mirrors how `intensityBias`/`name` already ride on `PlanSpec`, line 341-359), (b) plumbing it through `WorkoutPlanDetail`/`WorkoutProgram` DTOs, (c) new conditional rendering in `PlanWeekView`/`PlanStatusView` (web) and mobile plan screens using inline styles or CSS custom properties (no existing token-override seam — this is new).

**THE BLOCKING DEPENDENCY — client-facing view.** `selectActiveTenant` (`apps/api/src/auth/tenant-selection.ts:25`) is a pure, already-unit-tested function that picks which of a user's active memberships (`activeMemberships`, given a `preferredTenantId`) a session should be scoped to — built in 15a specifically as "the minimal enabler," but its own doc comment (lines 13-24) states it is DELIBERATELY NOT wired into `AuthService.login` (`apps/api/src/auth/service.ts:118-174`) or `SocialAuthService.login`/`callback` (`apps/api/src/auth/social.ts:113-184`). Both login paths still call `findActiveByUserId`/`findMembershipByUserId`, which return a SINGLE membership (first match), not a list — a client who has accepted a trainer invite now has TWO active memberships (their personal tenant + the trainer's tenant) and today's login always lands them in whichever one that repo method returns first, with no way to choose. Requirement (2) "branded plan appears to client" needs the client to be able to view a plan that lives in the TRAINER's tenant — i.e., needs a way to either (a) wire `selectActiveTenant` into login with a tenant-switch UI/param, or (b) let the client read cross-tenant plan data scoped by assignment (mirrors the `resolveAuthorizedOwner` pattern but in reverse — a client reading INTO the trainer's tenant, which the current resolver was not designed for: it only widens a TRAINER acting on a CLIENT's owner id within the trainer's OWN tenant, never a client crossing into another tenant). This is unresolved architecture, not just a missing route — it was explicitly deferred in 15a (issue #283, referenced in the tenant-selection.ts comment).

Requirement (1) — the trainer dashboard — has NO such dependency: it is a trainer, already resolved to their own tenant via existing login, reading a client's data through the SAME tenant using `resolveAuthorizedOwner` (widening within one tenant). It can ship independently.

### Affected Areas
- `apps/api/src/trainer/owner-access.ts` — reused as-is for dashboard-read authorization; no changes needed to the resolver itself.
- `apps/api/src/routes/trainer.ts` — new route(s), e.g. `GET /trainer/clients/:clientUserId/dashboard`, following the `plan.ts:790-849` pattern (resolve owner → call read path with resolved `ownerUserId`).
- `apps/api/src/db/repositories/workout-session.ts` (`getDashboardSummary`) — either reused directly (owner-parameterized already) or extended with a new method for period-based completion rate / recent-sessions list / RPE-trend series (currently only single-window snapshots exist).
- `packages/contracts/src/index.ts` (`DashboardSummaryDTO`, `PlanSpec`, `WorkoutPlanDetail`, `WorkoutProgram`) — contract additions: possibly a new `ClientDashboardDTO` (completion rate over period, recent sessions list, RPE trend series) and a `branding` field on `PlanSpec`/`WorkoutPlanDetail`.
- `apps/web/src/app/(app)/plan/PlanWeekView.tsx`, `apps/web/src/app/(app)/plan/[id]/PlanStatusView.tsx` — rendering hook for branding (trainer name/title/colors) if req 2 proceeds.
- `apps/api/src/auth/tenant-selection.ts`, `apps/api/src/auth/service.ts`, `apps/api/src/auth/social.ts` — the deferred active-tenant/client-view dependency; must be resolved (or explicitly re-deferred) before req 2 can ship.
- `apps/mobile/src/theme/tokens.ts` — no override seam exists for per-plan branding on mobile; would need a new mechanism if req 2 includes mobile.

### Approaches

**A. Authorizing dashboard reads of a client's data:**
1. **Reuse `resolveAuthorizedOwner` directly, new dashboard route** — `GET /trainer/clients/:clientUserId/dashboard` calls `resolveAuthorizedOwner` then `getDashboardSummary(tenantId, ownerUserId)` (already owner-parameterized).
   - Pros: zero changes to the resolver; identical proven pattern as `plan.ts`; naturally tenant-safe (req 3) because both trainer and client share the SAME tenantId in this call.
   - Cons: `getDashboardSummary` still needs extending for completion-rate/recent-sessions/RPE-trend fields the requirement asks for.
   - Effort: Low (route) + Medium (repo/DTO extension).
2. **New dedicated `ClientProgressRepository`/method separate from self-dashboard** — avoids risk of mutating shared `getDashboardSummary` semantics for self users.
   - Pros: isolates blast radius from the well-tested self dashboard path.
   - Cons: duplicates query logic; two read paths to keep in sync.
   - Effort: Medium.
   - Recommendation leans toward (1) with a targeted extension, not (2).

**B. Where branding lives:**
1. **On `PlanSpec`** (mirrors `intensityBias`/`name`) — `branding?: { trainerName?: string; title?: string; primaryColor?: string; accentColor?: string }`.
   - Pros: rides the exact same generation/promote/confirm pipeline already proven for `name`/`intensityBias`; no new table.
   - Cons: couples branding to spec regeneration lifecycle (a branding edit alone would look like a spec write).
   - Effort: Low.
2. **Separate `trainer_plan_branding` table keyed by `workout_plan_id`** — decoupled from spec churn.
   - Pros: branding edits don't touch `plan_specs`; cleaner separation of concerns.
   - Cons: new table/migration, new repo, extra join on every plan read.
   - Effort: Medium.

**C. Resolving vs. deferring the active-tenant/client-view dependency:**
1. **Split 15b: ship req 1 (trainer dashboard) + req 3 (tenant safety) now; defer req 2 (branded plan visible to client) to a follow-up that resolves #283** — the trainer dashboard has no dependency on `selectActiveTenant`; the branded-plan-to-client requirement is the ONLY one blocked.
   - Pros: unblocks the highest-value/lowest-risk requirement immediately; keeps the unresolved architecture question (login tenant-switch UX, cross-tenant client read) as its own reviewable slice.
   - Cons: roadmap item 15b ships "incomplete" relative to its 3 stated requirements; branding work (data model) might still land now even if the client CANNOT see it yet, risking rework.
   - Effort: Low added coordination cost.
2. **Resolve #283 inside 15b** — wire `selectActiveTenant` into login (e.g. a `tenantId` query param / a post-login tenant switcher), add a cross-tenant-safe client read path for a trainer's branded plan.
   - Pros: delivers the full stated requirement in one pass.
   - Cons: touches core login/session flow (`auth/service.ts`, `auth/social.ts`) — a bigger, higher-risk surface than the rest of 15b combined; the exact UX is a real product decision, not just engineering.
   - Effort: High.
3. **Land branding data model + trainer-side authoring now, punt ONLY the client-visible rendering** — trainer creates/edits branding (req 2's authoring half) but the client never sees it until #283 resolves.
   - Pros: unblocks trainer-side UI/contract work without touching login.
   - Cons: ships a feature with no observable client-side effect — arguably not "done" per the scenario; may confuse acceptance.
   - Effort: Medium.

### Recommendation

Split 15b per Approach C.1: ship trainer dashboard (req 1) + tenant-safety (req 3) as the primary slice — it has no unresolved dependency, reuses `resolveAuthorizedOwner` exactly as `plan.ts` already does, and only needs a contract/repo extension for completion-rate/recent-sessions/RPE-trend fields. Treat branded plans (req 2) as a SEPARATE follow-up change that first resolves the active-tenant/client-view question (#283) as its own explicit decision (login-time switcher vs. per-request tenant override) before building branding rendering on top of it.

### Risks
- `DashboardSummaryDTO` has no completion-rate-over-period or recent-sessions-list field today — req 1's stated scenario needs new fields/DTO, not pure reuse.
- `computeRpeAdaptation`'s `RpeSnapshot` is a single 3-session window, not a trend series — "RPE trends" (plural, req 1) implies more than one data point; scope must be clarified.
- The #283 active-tenant/client-view gap is a genuine architecture decision (which tenant a dual-membership user's session is in, and when it switches) — resolving it inside 15b risks scope creep into core auth; deferring it risks 15b never truly satisfying req 2's scenario.
- No existing per-plan theming/color-override seam on web or mobile — branding colors need a new rendering mechanism on both platforms if req 2 proceeds, not just a contract field.
- `resolveAuthorizedOwner` was designed for trainer-widens-into-client-owned-data WITHIN one tenant; it is NOT designed for a client crossing INTO a trainer's tenant — do not assume it can be reused symmetrically for req 2's read path.

### Ready for Proposal

Partially — needs product/scope decisions before proposing:
1. Split 15b (trainer dashboard + tenant-safety now; branded-plan-to-client deferred to a follow-up resolving #283), or attempt the full 3-requirement scope now (resolving #283 inside 15b)?
2. Branding scope: which fields (trainer name/title/one accent color vs. fuller palette), web-only or also mobile?
3. Dashboard metric scope: completion-rate period definition; RPE-trend as single snapshot vs. multi-point series; recent-sessions count/fields?
