# Design: 14a — v1.1 Adaptation from Adherence

## Technical Approach

14a adds exactly ONE new capability — a deterministic "should we suggest a lighter plan?"
computation — bolted onto seams that already ship. The policy is a **pure domain function**
(`computeAdherenceAdaptation`) beside `computeAdherence` (`adherence.ts:24`); its output is carried
by a **shared, type-only contract** (`AdaptationRecommendation`) that 14b (RPE) will populate later
into the same banner slot. The recommendation is folded into the **already-fetched**
`getDashboardSummary` read (`workout-session.ts:677`) exposed by `GET /progress/dashboard`
(`progress.ts:51`) — no new read query, no quota. Confirmation reuses the **proven regenerate →
`startGeneration` pipeline** (`plan.ts:564`) and its `plan_regeneration` billing gate, behind a new
**server-authoritative** confirm route (`POST /plan-specs/:id/adapt`) that re-derives the reduced
`daysPerWeek` itself so the client can never forge an arbitrary frequency. Web reuses the existing
`regeneratePlan`-style client wiring; mobile needs a plan-status + regenerate/adapt client (Track C)
because `HomeScreen.tsx:1` documents the standing "no plan-generation or plan-list surface" gap.

Sliced A1 (contract + pure domain) → A2 (fold into the dashboard read) → B1/B2 (web banner + i18n)
→ C1..Cn (mobile plan-status/regenerate foundation — the long pole) → D1 (mobile banner + confirm).

## Clean Architecture Boundaries

| Layer | Responsibility in 14a | Rule enforced |
|-------|-----------------------|---------------|
| Domain (`packages/domain/src/progress/`) | `computeAdherenceAdaptation` — pure, no I/O, no LLM, no clock except injected `now` | never imports contracts-runtime, api, or web; unit-tested in isolation |
| Contracts (`packages/contracts`) | `AdaptationRecommendation` + `AdherenceSnapshot` + `SuggestedChange` — **type-only** | no new runtime export → the export guard array (`contracts.test.ts:51`) is untouched |
| API repo (`workout-session.ts`) | aggregate already-fetched history + latest ready plan → call the domain fn → attach `planSpecId`/`rationaleKey` | tenant+user scoped; consumes nothing on the read |
| API route (`plan.ts`) | orchestrate confirm: re-derive server-side, persist, gate quota, `startGeneration` | identity from `authContext`, never body; MUST-confirm structurally enforced |
| Web / Mobile | render the banner; POST accept; render reject/error/exhausted states | no domain math client-side; no LLM; send accept, not a target frequency |

The LLM stays confined to `apps/api/src/ai` (only via the existing `startGeneration`); the
recommendation path contains **zero** LLM calls.

## Architecture Decisions

### Decision: `AdaptationRecommendation` is a **type-only** contract (no Zod, no runtime export)
**Choice**: Add `AdaptationSignalSource`, `AdherenceSnapshot`, `AdaptationLevel`, `SuggestedChange`,
and `AdaptationRecommendation` to `packages/contracts/src/index.ts` as **pure TypeScript types**,
with a `source: "adherence" | "rpe"` discriminator so 14b feeds the same shape.
**Alternatives**: a Zod `AdaptationRecommendationSchema` runtime export — **rejected**: the shape is
never parsed from an untrusted boundary (it is server-produced and server-consumed on confirm), and
the public-surface guard at `contracts.test.ts:51-57` enumerates the exact runtime-export array
(`WorkoutProgramSchema`, `DEFAULT_VECTOR_MEMORY_EMBEDDING_CONFIG`, `BILLING_FEATURES`,
`MUSCLE_GROUPS`, `PlanSpecDraftSchema`). A new runtime export would force a guard edit for no
validation benefit.
**Rationale**: type-only keeps the guard green with no change; the only runtime validation needed
(the accept request body) lives in the route's Fastify JSON schema, matching `saveDraftSchema`
(`plan.ts:302`). **If a future slice adds any runtime export here, the guard array MUST be updated
in the same slice.**

### Decision: The pure policy owns window + threshold + frequency mapping
**Choice**: `computeAdherenceAdaptation(input, now?)` in `packages/domain/src/progress/adherence-adaptation.ts`.

```ts
export interface ComputeAdherenceAdaptationInput {
  /** ISO timestamps of completed sessions (any range — the 60-session window). */
  completedAtDates: string[];
  /** Planned sessions/week from the latest ready plan (= daysPerWeek = weeklySessions.length). */
  plannedSessionsPerWeek: number;
  /** Latest ready plan's createdAt (ISO). Guards new users from a false "low". */
  planCreatedAt?: string;
  /** Rolling window length in weeks. PINNED DEFAULT = 4. */
  periodWeeks?: number;
}

export interface AdherenceAdaptationResult {
  level: "ok" | "low" | "insufficient_data";
  /** Present for "ok" | "low". */
  adherence?: AdherenceSnapshot;                 // { adherence, periodWeeks, completedInWindow, plannedInWindow }
  /** Present ONLY for "low" AND when a real reduction exists (toDays < fromDays). */
  suggestedChange?: SuggestedChange;             // { kind: "reduce_frequency", fromDays, toDays }
}
```

Rolling window (reuses `startOfUtcDay`/`addUtcDays` from `utc-week.ts`):
- `periodWeeks` default **4**; `windowStart = addUtcDays(startOfUtcDay(now), -periodWeeks*7)`.
- Weekly-template model has **no per-date schedule**, so
  `plannedInWindow = plannedSessionsPerWeek * periodWeeks`.
- `completedInWindow = completedAtDates` whose instant ∈ `[windowStart, now]`.
- `adherence = completedInWindow / plannedInWindow` (0..1).

Threshold + mapping:
- `adherence < 0.70` → `level: "low"`; else `level: "ok"`. (`5/16 = 31.25% → low`; `31% → 4→3`.)
- `MIN_DAYS_PER_WEEK = 1`. `toDays = max(MIN_DAYS_PER_WEEK, fromDays - 1)` where `fromDays =
  plannedSessionsPerWeek`. `suggestedChange` is emitted **only when `toDays < fromDays`** — so at
  `daysPerWeek = 1` a "low" carries no actionable change (banner encourages, no regenerate CTA).

Insufficient-data (→ `level: "insufficient_data"`, no `adherence`, no `suggestedChange`):
- `plannedSessionsPerWeek <= 0` (no active ready plan), OR
- `planCreatedAt` missing, OR `now - planCreatedAt < periodWeeks` weeks (user hasn't had a full
  window to adhere — this is the deterministic guard that stops a brand-new plan reading 0%→low).

**Alternatives**: detecting "new user" by `completedInWindow === 0` — **rejected**: a genuinely
abandoning user also has 0 completions; only the plan age distinguishes new-vs-abandoned
deterministically. A calendar-week bucket like `computeAdherence` — **rejected**: the spec's
"configurable period / 5 of 16 in 4 weeks" needs a trailing multi-week window, not the current
calendar week.
**Rationale**: fully deterministic, pure, unit-testable; every edge case is a fixture, not a mock.

### Decision: Fold the recommendation into `DashboardSummaryDTO` (reuse the existing read), not a new endpoint
**Choice**: Add optional `adaptation?: AdaptationRecommendation` to `DashboardSummaryDTO`
(`index.ts:840`). `getDashboardSummary` (`workout-session.ts:677`) already fetches the last 60
completed sessions **and** the latest `status='ready'` plan row (which carries `planSpecId` and
`createdAt`) and derives `plannedSessionsPerWeek`. It calls `computeAdherenceAdaptation` from that
exact data and attaches `planSpecId` (from `planRows[0].planSpecId`) + `rationaleKey`.
**Alternatives**: a separate `GET /adaptation/adherence` — **rejected**: it would re-run the same
two expensive tenant-scoped queries the dashboard already performs, and both web and mobile
dashboards already read `/progress/dashboard`. Adding a field is additive and optional, so the 15
`DashboardSummaryDTO` consumers are unaffected.
**Rationale**: zero extra DB round-trip, one read both surfaces already make, and the "no quota on
read" property is automatic — the dashboard read consumes nothing today.
**Note (mobile)**: `HomeScreen.tsx` currently fetches no summary; Track D adds the
`GET /progress/dashboard` fetch to read `adaptation` (the endpoint already exists).

### Decision: Confirm via a NEW server-authoritative `POST /plan-specs/:id/adapt` that re-derives `toDays`
**Choice**: Accept posts `{}` to `POST /plan-specs/:id/adapt`. The route:
1. `authContext` → `tenantId/userId` (never body);
2. re-runs `computeAdherenceAdaptation` from the **authoritative** history + this spec's latest
   ready plan; if the result is not `low` with a `suggestedChange` → `409 { error: "no_adaptation" }`
   (rejects stale/forged accepts);
3. persists `spec_json.daysPerWeek = toDays` via a new tenant/user-scoped repo method
   `updateSpecDaysPerWeek(tenantId, userId, specId, toDays)`;
4. `billing.checkAndConsume({tenantId,userId}, "plan_regeneration", key)` — same gate as regenerate
   (`plan.ts:574`); `403 { error: reason }` when exhausted;
5. `generationService.startGeneration(tenantId, userId, id)` → `202 { planId, status }`.

**Alternatives**:
- *Extend `regenerate` with a `{ daysPerWeek }` override* — **rejected**: `regenerate` is
  server-authoritative today (it reads `spec_json` and never trusts the body); accepting a
  client-supplied frequency would let any caller regenerate at an arbitrary `daysPerWeek`, forking
  the plan-spec write surface and bypassing the recommendation.
- *Client saves an adjusted draft/spec first, then calls `regenerate`* — **rejected**: confirmed
  `plan_specs` rows have no client-facing update path (drafts are a separate write-once promote
  flow), and it would split one user action into two non-atomic requests with a quota race between
  them.
**Rationale**: the client sends only "accept the adherence adaptation for spec X" — the target
frequency is **derived and persisted server-side**, closing the forge hole and keeping a single
source of truth. It reuses the exact billing-consume + `startGeneration` internals; net-new is one
route + one narrow repo method. MUST-confirm is structural: `/adapt` only ever runs on an explicit
POST, and no auto path exists.

### Decision: Adherence is a separate banner field — `WeeklyDayStatus` stays untouched
**Choice**: The recommendation rides on `DashboardSummaryDTO.adaptation`; `WeeklyDayStatus`
(`index.ts:874`) keeps its exhaustive `"done" | "active" | "rest" | "soon"` with **no "missed"
state**, and `WeeklyOverviewDTO` / the week board are unchanged.
**Rationale**: honors the deliberate 09c "no missed state" decision; adherence is a percentage +
optional suggestion, never a day-grid status.

## Data Flow

Read (no quota, both platforms):

    client ── GET /progress/dashboard (Bearer) ──▶ progress route
      │ requireAuth → authContext (tenant/user)
      │ repo.getDashboardSummary(tenant,user,now)
      │   ├ fetch last 60 completed sessions (existing query)
      │   ├ fetch latest ready plan → planSpecId, createdAt, plannedSessionsPerWeek (existing)
      │   └ computeAdherenceAdaptation({completedAtDates, plannedSessionsPerWeek,
      │        planCreatedAt, periodWeeks:4}, now)   [PURE domain]
      │        → attach planSpecId + rationaleKey
      └ 200 DashboardSummaryDTO { ...existing, adaptation? }   ← consumes NOTHING

Confirm (accept → quota consumed exactly once):

    client ── POST /plan-specs/:id/adapt {} (Bearer) ──▶ plan route
      │ requireAuth → authContext (tenant/user; NEVER body)
      │ re-derive computeAdherenceAdaptation from authoritative data
      │   └ not low+suggestedChange? ──▶ 409 no_adaptation   (stale/forged)
      │ repo.updateSpecDaysPerWeek(tenant,user,id,toDays)     (persist reduced frequency)
      │ billing.checkAndConsume(plan_regeneration) ──exhausted──▶ 403 { reason }
      │ startGeneration(tenant,user,id)                        (existing pipeline)
      └ 202 { planId, status: "generating" }

Reject → pure no-op, no request, nothing consumed.

## File Changes

| File | Action | Slice | Description |
|------|--------|-------|-------------|
| `packages/contracts/src/index.ts` | Modify | A1 | type-only `AdaptationRecommendation` + `AdherenceSnapshot` + `SuggestedChange` + `AdaptationSignalSource`/`AdaptationLevel`; add optional `adaptation?` to `DashboardSummaryDTO` |
| `packages/domain/src/progress/adherence-adaptation.ts` | Create | A1 | pure `computeAdherenceAdaptation` (window=4, `<70%`, `max(1,fromDays-1)`, insufficient-data) |
| `packages/domain/src/progress/index.ts` | Modify | A1 | re-export the new fn (mirrors `computeAdherence`) |
| `apps/api/src/db/repositories/workout-session.ts` | Modify | A2 | call the domain fn in `getDashboardSummary`; attach `planSpecId`/`rationaleKey` to `adaptation` |
| `apps/api/src/db/repositories/*plan-spec*` | Modify | B1 | `updateSpecDaysPerWeek(tenant,user,specId,toDays)` (tenant/user-scoped spec_json write) |
| `apps/api/src/routes/plan.ts` | Modify | B1 | `POST /plan-specs/:id/adapt` (re-derive, persist, gate, `startGeneration`) + body schema |
| `apps/web/src/app/(app)/dashboard/DashboardCoachCard.tsx` | Modify | B1 | replace the static mock card with a real adherence banner (accept/reject/exhausted) |
| `apps/web/src/app/(app)/dashboard/*client/action` | Modify | B1 | wire the accept POST (reuse the `regeneratePlan` client pattern) |
| `packages/i18n/src/messages/{en,es}.json` | Modify | B2 | new `adaptation` namespace (EN/ES parity): suggestion, insufficient/empty, error, exhausted, coaching tone |
| `apps/mobile/src/api/plan-status-client.ts` | Create | C | `fetchPlanStatus` + `regenerate/adapt` client (mirrors mobile `plan-draft-client.ts`, SecureStore Bearer) |
| `apps/mobile/src/screens/plan/*` | Create | C | plan-status view (generating/ready/failed) + regenerate action, reusing item-13 patterns |
| `apps/mobile/src/screens/HomeScreen.tsx` + nav | Modify | C/D | plan-list/entry replacing the manual `workoutPlanId` input; fetch `/progress/dashboard` |
| `apps/mobile/src/screens/**/AdherenceBanner*` | Create | D | mobile banner; confirm via the Track C client; reuse `adaptation` i18n |

## Interfaces / Contracts

```ts
// packages/contracts — TYPE-ONLY (no runtime export → export guard unchanged)
export type AdaptationSignalSource = "adherence" | "rpe";   // "rpe" reserved for 14b
export type AdaptationLevel = "ok" | "low" | "insufficient_data";

export interface AdherenceSnapshot {
  adherence: number;          // 0..1 completed/planned over the window
  periodWeeks: number;        // default 4
  completedInWindow: number;
  plannedInWindow: number;    // plannedSessionsPerWeek * periodWeeks
}
export type SuggestedChange = { kind: "reduce_frequency"; fromDays: number; toDays: number };

export interface AdaptationRecommendation {
  source: AdaptationSignalSource;
  level: AdaptationLevel;
  suggestedChange?: SuggestedChange;   // only level==="low" AND toDays<fromDays
  rationaleKey?: string;               // i18n key, never raw prose (API-attached)
  planSpecId?: string;                 // spec to /adapt on confirm (API-attached)
  adherence?: AdherenceSnapshot;       // signal context (14a); 14b adds its own
}
```

Domain produces `{ level, suggestedChange?, adherence }`; the API layer attaches `source:
"adherence"`, `planSpecId`, and `rationaleKey`. Banner renders only when `level === "low" &&
suggestedChange` (accept CTA); `ok` / `insufficient_data` render nothing.

## Testing Strategy

| Layer | What to test | Approach |
|-------|--------------|----------|
| Unit (domain) | `5/16 in 4 weeks → low`; `31% → reduce 4→3`; `>=70% → ok`; `daysPerWeek=1 → low, no suggestedChange`; `plannedSessionsPerWeek=0 → insufficient`; `planCreatedAt < 4w → insufficient`; 60-session truncation still counts only in-window; window boundary (exactly at `now-4w`) | pure fn + fixtures, injected `now`, no mocks |
| Unit (contracts) | `adaptation?` optional on `DashboardSummaryDTO`; export-guard array still exactly the 5 runtime keys | `expectTypeOf` + `contracts.test.ts` |
| API (read) | `/progress/dashboard` includes `adaptation` when low; omits/`insufficient` otherwise; consumes NO quota; tenant/user from authContext | `buildTestApp` + seeded sessions/plan |
| API (confirm) | `/adapt` low+change → persists `toDays`, consumes exactly one `plan_regeneration`, `202`; exhausted → `403`; not-low → `409 no_adaptation`; body-injected tenant/days ignored | `buildTestApp` + fake billing ledger + real Postgres |
| Web | banner renders on low; accept → adapt POST → generating; reject → no request, plan unchanged; `403` → exhausted state; `insufficient`/`ok` → no banner; EN/ES copy | component tests, mocked action/fetch |
| Mobile | plan-status client maps `200/401/403`; regenerate/adapt flow; banner render + confirm; `sessionExpired` on 401 (mirrors `plan-draft-client` tests) | vitest + injected `fetchImpl`/`getToken` |

## Threat Matrix

Applicable — a new authenticated confirm route that consumes billing quota and mutates a plan spec.

| Row | Applicable | Safe/failure behavior | RED test |
|-----|-----------|-----------------------|----------|
| Silent quota burn / auto-regenerate | Yes | quota consumed ONLY inside `/adapt` on explicit POST; read consumes nothing; no scheduler/auto path in code | read asserts zero consume; grep: no auto-call of `/adapt` |
| Client forges an arbitrary reduced `daysPerWeek` | Yes | `/adapt` re-derives `toDays` server-side; body `daysPerWeek` ignored; not-low → `409` | body-injected `daysPerWeek:1` on a healthy plan → 409, spec unchanged |
| Tenant/user spoof via body | Yes | identity from `authContext`; repo writes are tenant+user scoped | body `tenantId` ignored; cross-tenant `:id` → 404 |
| Stale accept (adherence recovered before confirm) | Yes | re-derivation returns not-low → `409 no_adaptation`, no consume, no regenerate | seed recovery between read and adapt → 409 |
| Quota race (double accept) | Yes | `checkAndConsume` idempotency key + single consume path (same as regenerate) | concurrent double POST consumes one unit |
| "Missed" state leaks into week board | Yes (N/A) | adherence lives only in `adaptation`; `WeeklyDayStatus` unchanged | `WeeklyDayStatus` type assertion unchanged |
| LLM in recommendation path | Yes (N/A) | recommendation is pure domain; LLM only via existing `startGeneration` | deps-guard: no ai import in domain/web |

## Migration / Rollout

**No migration.** Purely additive: a type-only contract field, one pure domain fn, one attached
read field, one new route, and one narrow spec-write method. `spec_json.daysPerWeek` is written
in-place on the existing `plan_specs` row (the confirmed spec is already the durable carrier) —
**no schema change, no new table, no destructive migration**. The write-once `workout_plans` model
is untouched (adapt produces a fresh plan via `startGeneration`, exactly like regenerate).

Rollback per slice: D remove the mobile banner (Track C plan surface still works); C remove the RN
plan-status/regenerate port (mobile returns to its pre-14a paste-a-planId Home; web unaffected); B
remove the web banner + `adaptation` i18n + `/adapt` route + `updateSpecDaysPerWeek` (dashboard and
regenerate unchanged); A the contract field and domain fn become unused — drop them; the dashboard
summary keeps its prior shape. Existing adherence stats, dashboard, plan/regenerate, and the billing
gate keep working at every rollback point.

## Slice Boundaries

- **A1** — contract (type-only) + pure `computeAdherenceAdaptation`. No HTTP, no UI, no billing.
- **A2** — fold `adaptation` into `getDashboardSummary`/`DashboardSummaryDTO`. Read-only, no quota.
- **B1** — web banner on `DashboardCoachCard` + `POST /plan-specs/:id/adapt` + `updateSpecDaysPerWeek`.
  Confirm-only quota; MUST-confirm structural.
- **B2** — `adaptation` i18n (EN/ES) + insufficient/empty/error/exhausted/coaching copy.
- **C1..Cn** — mobile plan-status client + regenerate/adapt client + plan view/list + generating/ready
  states. **The long pole.** *Smaller than a from-scratch port*: item 13 already shipped mobile
  `plan-draft-client.ts` (draft/promote/confirm), `AssistantScreen`, SecureStore Bearer auth, and
  `workout-session.ts`; C reuses those patterns and adds only the **plan-status + regenerate/adapt**
  surface the create-plan chat never needed. Still likely 2–3 slices (fetch/list + status view, then
  the adapt action + states).
- **D1** — mobile adherence banner + confirm via the Track C client; reuse `adaptation` i18n.

Relative effort: A (small) < B (small–med, two thin slices) ≪ **C (med–large, multi-slice — dominates
mobile)** < D (small, once C exists). A + B deliver full web behavior independently of C/D.

## Open Questions

- [ ] Confirm the confirmed-spec repo exposes (or can add) a tenant/user-scoped `updateSpecDaysPerWeek`
      without disturbing the promote/write-once draft path (expected: a narrow `UPDATE plan_specs SET
      spec_json = ... WHERE tenant/user/id` — verify at B1 implementation).
- [ ] `periodWeeks` is pinned to 4 in code (satisfies "configurable period" as a parameter). Confirm no
      per-user configurability is required for v1 (proposal says no).
