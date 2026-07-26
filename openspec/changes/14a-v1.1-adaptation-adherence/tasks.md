# Tasks: 14a — v1.1 Adaptation from Adherence

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | ~950–1250 across 8 slices (~100–220 each) |
| 400-line budget risk | Low (per-slice); Track C (3 slices) aggregates above 400 across the mobile port |
| Chained PRs recommended | Yes |
| Suggested split | PR1 A1 contract+domain → PR2 A2 dashboard fold → PR3 B1 adapt route+banner → PR4 B2 web i18n/states → PR5 C1 mobile client → PR6 C2 mobile plan-status screen → PR7 C3 mobile nav/dashboard fetch → PR8 D1 mobile banner |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending — ask the user (stacked-to-main vs feature-branch-chain) |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: Low per-slice

B1 mutates a plan spec and consumes billing quota on a new authenticated route (`POST
/plan-specs/:id/adapt`) → treat as high-risk (full 4R) at review time regardless of line
count. C1 handles Bearer auth token wiring on mobile → medium risk (reliability/resilience
focus). A + B ship the complete web behavior independently of C/D; Track C is the long pole
and is split into three slices (C1 client, C2 plan-status screen, C3 nav/dashboard-fetch
entry point) before Track D (mobile banner) can exist.

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|---|---|---|---|---|---|
| A1 | Pure `computeAdherenceAdaptation` + shared type-only `AdaptationRecommendation`/`AdherenceSnapshot`/`SuggestedChange` contract. No HTTP, no UI, no billing | PR1 | `pnpm --filter domain test -- adherence-adaptation` + `pnpm --filter contracts test` | N/A — pure functions, no I/O to smoke | `packages/domain/src/progress/adherence-adaptation.ts`, `packages/contracts/src/index.ts` (type-only additions) — unused if A2+ revert |
| A2 | Fold `adaptation` into `getDashboardSummary`/`DashboardSummaryDTO`; read-only, no quota | PR2 | `pnpm --filter api test -- workout-session progress` | `pnpm --filter api dev` + curl `GET /progress/dashboard` smoke (low/ok/insufficient) | `apps/api/src/db/repositories/workout-session.ts` — drop the attach, dashboard keeps its prior shape |
| B1 | `POST /plan-specs/:id/adapt` (server-authoritative re-derivation, persist, quota-gate, `startGeneration`) + `updateSpecDaysPerWeek` + `DashboardCoachCard` banner | PR3 | `pnpm --filter api test -- plan-spec-repo plan-adapt` + `pnpm --filter web test -- DashboardCoachCard` | `pnpm --filter api dev` + curl smoke (low→202, not-low→409, exhausted→403, forged body ignored) | `apps/api/src/routes/plan.ts` (adapt route scope), plan-spec repo method, `DashboardCoachCard.tsx` — drop route + banner, regenerate/dashboard unaffected |
| B2 | `adaptation` i18n namespace (EN/ES parity) + loading/insufficient/error/exhausted/coaching-tone states | PR4 | `pnpm --filter web test -- DashboardCoachCard` + `pnpm --filter i18n test` | `pnpm --filter web dev` on dashboard (low/ok/insufficient/error, EN+ES) | `packages/i18n/src/messages/{en,es}.json` (adaptation namespace) + state wiring in `DashboardCoachCard.tsx` — drop, banner reverts to B1 baseline |
| C1 | Mobile `plan-status-client.ts` (`fetchPlanStatus` + `confirmAdapt`), SecureStore Bearer, mirrors `plan-draft-client.ts` | PR5 | `pnpm --filter mobile test -- plan-status-client` | N/A — injected `fetchImpl`/`getToken`, no device smoke needed | `apps/mobile/src/api/plan-status-client.ts` — unused if C2+ revert |
| C2 | Mobile plan-status screen (generating/ready/failed states + regenerate/adapt action) | PR6 | `pnpm --filter mobile test -- PlanStatusScreen` | Expo dev client smoke (generating→ready transition, adapt action) | `apps/mobile/src/screens/plan/*` — drop, C1 client still unused-but-intact |
| C3 | HomeScreen nav entry replacing the manual `workoutPlanId` paste + `GET /progress/dashboard` summary fetch | PR7 | `pnpm --filter mobile test -- HomeScreen` | Expo dev client smoke (nav to plan status, summary loads) | `apps/mobile/src/screens/HomeScreen.tsx` + nav — mobile returns to its pre-14a paste-a-planId Home |
| D1 | Mobile adherence banner + confirm via the Track C client; reuse `adaptation` i18n | PR8 | `pnpm --filter mobile test -- AdherenceBanner` | Expo dev client smoke (low/ok/insufficient/offline) | `apps/mobile/src/screens/**/AdherenceBanner*` — drop, Track C plan surface keeps working |

## Phase 1: Slice A1 — Domain Policy + Shared Contract (pure, no I/O) [Requirements: Adherence Tracking, Adherence-Based Recommendation, Frequency-Only Adjustment in Slice 1, Shared Adaptation Recommendation Contract]

- [x] 1.1 RED: Add failing `packages/domain/src/progress/__tests__/adherence-adaptation.test.ts`: `5/16` in 4 weeks → `~31%`, `level: "low"`; `31%` with `fromDays=4` → `suggestedChange { kind: "reduce_frequency", fromDays: 4, toDays: 3 }`; `>=70%` → `ok`, no `suggestedChange`; `fromDays=1` and `low` → `low` with no `suggestedChange` (floor); `plannedSessionsPerWeek=0` → `insufficient_data` (no division by zero); missing `planCreatedAt` or `now - planCreatedAt < periodWeeks` weeks → `insufficient_data`; 60-session-window truncation still counts only in-window completions; boundary case exactly at `now - periodWeeks*7 days`.
- [x] 1.2 GREEN: Create `packages/domain/src/progress/adherence-adaptation.ts` — pure `computeAdherenceAdaptation(input, now?)` reusing `startOfUtcDay`/`addUtcDays` from `utc-week.ts`; `periodWeeks` default 4; `plannedInWindow = plannedSessionsPerWeek * periodWeeks`; `completedInWindow` = count of `completedAtDates` in `[windowStart, now]`; `adherence < 0.70` → `low`; `MIN_DAYS_PER_WEEK = 1`, `toDays = max(1, fromDays - 1)`, `suggestedChange` emitted only when `toDays < fromDays`; insufficient-data guards (no ready plan / `plannedSessionsPerWeek <= 0` / no or too-recent `planCreatedAt`).
- [x] 1.3 GREEN: Re-export `computeAdherenceAdaptation` from `packages/domain/src/progress/index.ts` (mirrors the existing `computeAdherence` export).
- [x] 1.4 RED: Add failing assertions in `packages/contracts/src/__tests__/contracts.test.ts` (or a new file): `AdaptationSignalSource`/`AdaptationLevel`/`AdherenceSnapshot`/`SuggestedChange`/`AdaptationRecommendation` type-check as specified; `DashboardSummaryDTO.adaptation` is optional; the runtime export-guard array still enumerates exactly the 5 existing keys (`WorkoutProgramSchema`, `DEFAULT_VECTOR_MEMORY_EMBEDDING_CONFIG`, `BILLING_FEATURES`, `MUSCLE_GROUPS`, `PlanSpecDraftSchema`) — unchanged.
- [x] 1.5 GREEN: Add the type-only `AdaptationSignalSource`/`AdaptationLevel`/`AdherenceSnapshot`/`SuggestedChange`/`AdaptationRecommendation` types to `packages/contracts/src/index.ts` (no Zod, no runtime export) and an optional `adaptation?: AdaptationRecommendation` field on `DashboardSummaryDTO`.
- [x] 1.6 TRIANGLE: Run `pnpm --filter domain test -- adherence-adaptation` and `pnpm --filter contracts test` green; `pnpm -w typecheck`; confirm via diff that no HTTP/UI/billing file was touched and the domain function imports nothing from contracts-runtime, `apps/api`, or `apps/web`/`apps/mobile`.

## Phase 2: Slice A2 — Fold Recommendation into the Dashboard Read (no quota) [Requirements: On-Demand Read Surface, Preserve the No-Missed Day State]

- [x] 2.1 RED: Add failing `apps/api/src/db/repositories/__tests__/workout-session.test.ts` (or extend it) asserting `getDashboardSummary`: low-adherence fixture → `adaptation` attached with `source: "adherence"`, `planSpecId` (from the latest ready plan row), and a `rationaleKey`; ok/insufficient fixtures → `adaptation` reflects `level` with no `suggestedChange` where not applicable; assert the billing mock/ledger is never invoked by this read; assert `WeeklyDayStatus`/`WeeklyOverviewDTO` output is byte-for-byte unchanged (no "missed" state introduced).
- [x] 2.2 GREEN: Modify `apps/api/src/db/repositories/workout-session.ts` — inside `getDashboardSummary`, call `computeAdherenceAdaptation` using the already-fetched 60-session history and the latest `status='ready'` plan's `planSpecId`/`createdAt`/`plannedSessionsPerWeek`; attach `source: "adherence"`, `planSpecId`, and `rationaleKey` to the domain result before returning it as `DashboardSummaryDTO.adaptation`.
- [x] 2.3 RED: Add failing `apps/api/src/routes/__tests__/progress.test.ts` assertions: `GET /progress/dashboard` returns `adaptation` scoped strictly to `authContext`'s tenant/user; a body/query-injected tenant/user is ignored; response omits `suggestedChange` when `level !== "low"`.
- [x] 2.4 GREEN: Confirm/adjust `apps/api/src/routes/progress.ts` so the existing route passes the DTO through unchanged with identity resolved only from `authContext` (no route change expected beyond verifying/asserting this — add a narrow fix only if the route currently allows any non-authContext identity source).
- [x] 2.5 TRIANGLE: Run `pnpm --filter api test -- workout-session progress` green; `pnpm -w typecheck`; confirm no new DB round-trip was introduced (assert query-call count unchanged in the repo test) and zero billing calls occur anywhere in this slice's code path.

## Phase 3: Slice B1 — Web Confirm Route + Suggestion Banner [Requirements: User Confirmation, Web Adherence Suggestion Surface, Boundaries and Security]

- [x] 3.1 RED: Add failing repo test for `updateSpecDaysPerWeek(tenantId, userId, specId, toDays)`: updates `spec_json.daysPerWeek` in place for the owning tenant/user; a cross-tenant/cross-user id is a no-op (0 rows affected / 404 at the caller); the write-once `workout_plans` promote/draft path is untouched.
- [x] 3.2 GREEN: Implement `updateSpecDaysPerWeek` on the plan-spec repository (tenant/user-scoped `UPDATE plan_specs SET spec_json = ... WHERE tenant_id = ... AND user_id = ... AND id = ...`).
- [x] 3.3 RED: Add failing `apps/api/src/routes/__tests__/plan-adapt.test.ts` (Threat Matrix): low+`suggestedChange` fixture → `202 { planId, status }`, `spec_json.daysPerWeek` persisted as `toDays`, exactly one `plan_regeneration` consumed; not-low (recovered adherence) → `409 { error: "no_adaptation" }`, no persist, no consume; quota-exhausted tenant → `403 { error: reason }`, plan unchanged; body-injected `tenantId`/`daysPerWeek` ignored (identity and target frequency always server-derived); cross-tenant `:id` → `404`; concurrent double-POST consumes exactly one unit (idempotency key reused from the existing `checkAndConsume` gate).
- [x] 3.4 GREEN: Add `POST /plan-specs/:id/adapt` to `apps/api/src/routes/plan.ts` — `requireAuth` → `authContext` (never body) → re-run `computeAdherenceAdaptation` from authoritative history + this spec's latest ready plan → `409 no_adaptation` if not low+suggestedChange → `updateSpecDaysPerWeek(tenantId, userId, id, toDays)` → `billing.checkAndConsume({tenantId,userId}, "plan_regeneration", key)` (403 on exhausted) → `startGeneration(tenantId, userId, id)` → `202`. Add the Fastify JSON body schema (empty/no-op body, matching the `saveDraftSchema` pattern).
- [x] 3.5 RED: Add failing component test for `DashboardCoachCard`: `level: "low"` → banner renders with accept/reject actions; accept → POST to `/adapt` → transitions to a generating state; reject → no request is made and the plan is unchanged; a regenerate error (403/network) → a clear error message, plan unchanged, retry affordance offered.
- [x] 3.6 GREEN: Replace the static mock card in `apps/web/src/app/(app)/dashboard/DashboardCoachCard.tsx` with a real adherence banner wired to the `/adapt` accept action (reuse the existing `regeneratePlan`-style client/action wiring pattern; no new generation entry point).
- [x] 3.7 TRIANGLE: Run `pnpm --filter api test -- plan-adapt` (plus the updated plan-spec repo test) and `pnpm --filter web test -- DashboardCoachCard` green; `pnpm -w typecheck`; `pnpm --filter web build`; grep-confirm no code path calls `/adapt` without an explicit user-triggered POST (no auto-apply); confirm the confirm-only quota rule holds (read path from A2 still consumes nothing).
- [x] 3.8 REVIEW FIX (4R risk+reliability CRITICAL + WARNINGs, post-3.7): `/adapt`'s default idempotency key changed from a stable `plan_regeneration:adapt:${id}` to a fresh `${...}:${randomUUID()}` per request (matches `/regenerate`), so a repeated accept during the async generation window costs its own quota unit instead of replaying the ledger for a free extra regeneration; `Idempotency-Key` header override still honored for a genuine client retry. `DashboardCoachCard`'s accept/dismiss buttons now disable while a request is in flight, so a rapid double-click sends exactly one POST. Confirmed (regression test, no code change needed) a synchronous `startGeneration` failure already surfaces as a non-202 error, never a silent success, given consume-before-write.

## Phase 4: Slice B2 — Web i18n + Loading/Empty/Error States [Requirements: Coaching Tone and Internationalization, Web Adherence Suggestion Surface]

- [x] 4.1 RED: Add failing i18n parity test asserting the new `adaptation` namespace has identical key sets in `packages/i18n/src/messages/en.json` and `es.json`, covering suggestion, insufficient-data, empty/no-recommendation (`ok`), regenerate-error, quota-exhausted, and coaching-tone copy.
- [x] 4.2 GREEN: Add the `adaptation` namespace to `packages/i18n/src/messages/{en,es}.json` (e.g. "Want to try 3 days/week?" framed as an option, never a diagnosis). B2 rounds the B1 6-key namespace out to 9: adds `submitting` (in-flight pending copy), `quotaExhausted` (403 upgrade copy), `upToDate` (409 `no_adaptation`); EN/ES parity held via the scoped count test (6→9).
- [x] 4.3 RED: Extend `DashboardCoachCard` tests: a loading state while the read is in flight shows an affordance and no premature banner/action; `level: "ok"` or `"insufficient_data"` → no banner rendered; suggestion copy asserted as option-framed (not diagnostic) via the new i18n keys. (Read-in-flight loading lives at the page level — this banner is presentational; added tests for `insufficient_data` no-banner, submitting pending affordance, from→to interpolation, and the 403/409/generic result-code copy mapping.)
- [x] 4.4 GREEN: Wire the loading/insufficient/ok/error/exhausted states and the `adaptation` i18n keys into `DashboardCoachCard.tsx`. (Distinct submitting pending message + `errorCopyKey` mapping 403 `tenant_quota_exhausted`/`member_allocation_exhausted`→`quotaExhausted`, 409 `no_adaptation`→`upToDate`, else→`error`; `ok`/`insufficient_data` render the static coach card with no banner leak.)
- [x] 4.5 TRIANGLE: Run `pnpm --filter web test -- DashboardCoachCard` and `pnpm --filter i18n test` green; `scripts/deps-guard.mjs` clean; `pnpm --filter web build`; manual smoke on the dashboard for low/ok/insufficient/error in EN and ES.

## Phase 5: Slice C1 — Mobile Plan-Status + Adapt Client (port, no UI) [Requirements: Mobile Adherence Suggestion Surface (prerequisite infra)]

- [x] 5.1 RED: Add failing `apps/mobile/src/api/__tests__/plan-status-client.test.ts`: `fetchPlanStatus` maps `200`/`401`/`403` responses; `401` yields a `sessionExpired` result (mirrors the existing `plan-draft-client.ts` tests); uses injected `fetchImpl`/`getToken` (no real network/SecureStore in tests).
- [x] 5.2 GREEN: Create `apps/mobile/src/api/plan-status-client.ts` — `fetchPlanStatus` mirroring `plan-draft-client.ts`'s structure and SecureStore Bearer-auth pattern.
- [x] 5.3 RED: Extend the client test: `confirmAdapt(specId)` POSTs to `/plan-specs/:id/adapt`, maps `202`/`403`/`409` into a typed result (`generating` / `quotaExhausted` / `noAdaptation`). (Implemented as `adaptPlan` — mirrors the web `adaptPlan` client and the orchestrator's requested surface; the 403/409 branch is a `{ kind: "error", status, message }` result carrying the HTTP status so C2/D can map 403→quota, 409→no_adaptation without string-matching.)
- [x] 5.4 GREEN: Add `adaptPlan` (== `confirmAdapt`) to `plan-status-client.ts`, reusing the same fetch/auth wiring as `fetchPlanStatus`. Also added `regeneratePlan` and `fetchDashboardSummary` (dashboard `adaptation` read) + `fetchLatestPlanForSpec`, all via shared `fetchPlan`/`postGeneration` helpers.
- [x] 5.5 TRIANGLE: Ran `pnpm --filter mobile test -- plan-status-client` green (390 passed / 47 files, 29 new); `pnpm --filter mobile type-check` clean; `pnpm deps-guard` clean; `pnpm architecture` clean. Client reuses the existing SecureStore Bearer pattern (lazy `defaultGetToken` → `getSessionToken`, no duplicated auth logic) and calls only existing shared API endpoints (`GET /workout-plans/:id`, `GET /plan-specs/:id/workout-plan`, `POST /plan-specs/:id/regenerate`, `POST /plan-specs/:id/adapt`, `GET /progress/dashboard`) — no new API routes on the mobile side.

## Phase 6: Slice C2 — Mobile Plan-Status Screen (generating/ready/failed) [Requirements: Mobile Adherence Suggestion Surface (prerequisite infra)]

- [x] 6.1 RED: Added failing screen test `apps/mobile/src/screens/plan/__tests__/PlanStatusScreen.test.tsx`: renders `generating`/`ready`/`failed` states driven by injected `fetchPlanStatus`/`fetchLatestPlanForSpec`; a `sessionExpired` load routes to Login once; a network error degrades to a graceful error+retry state without crashing.
- [x] 6.2 GREEN: Created `apps/mobile/src/screens/plan/PlanStatusScreen.tsx` (+ `PlanStatusScreen.styles.ts`, `messages.ts`) consuming `plan-status-client.ts`'s `fetchPlanStatus`/`fetchLatestPlanForSpec`; generating-state poll loop (`setInterval` → `fetchPlanStatus` until ready/failed) with mount-guard + interval cleanup on unmount / phase-change; registered `PlanStatus` in `App.tsx` (PROTECTED_ROUTES + `Stack.Screen`); added `planStatus.*` i18n namespace (EN/ES parity, own scoped count test).
- [x] 6.3 RED: Extended the screen test: a **Regenerate** action in the `ready` state calls `regeneratePlan(specId)`, transitions the UI to `generating` on `202` and re-points the poll loop at the new plan id; a `403` surfaces a clear quota-exhausted notice with the plan left unchanged. (Orchestrator scope: C2 uses `regeneratePlan`; the adherence-adapt CONFIRM banner / `409 no_adaptation` UX is D1. `409` is not reachable from regenerate.)
- [x] 6.4 GREEN: Wired the Regenerate action (via `regeneratePlan`, in-flight disabled, `403`→`adaptation.quotaExhausted` notice, other error→`planStatus.error` notice, `sessionExpired`→Login) into `PlanStatusScreen.tsx`'s ready/failed UI.
- [x] 6.5 TRIANGLE: `pnpm --filter mobile test` green (48 files / 398 tests; 8 new PlanStatusScreen tests); `pnpm --filter mobile type-check` clean; `pnpm --filter @kinora/i18n test` green (66 tests, planStatus parity+count); `pnpm deps-guard` clean; `pnpm architecture` clean. Manual Expo dev-client smoke is out of scope for this executor (no device/e2e); the generating→ready transition, regenerate success, and 403/network error paths are covered by the automated screen tests.

## Phase 7: Slice C3 — Mobile Nav Entry + Dashboard Summary Fetch [Requirements: Mobile Adherence Suggestion Surface (prerequisite infra)]

- [ ] 7.1 RED: Add failing `HomeScreen` test: the manual `workoutPlanId` text-input flow is replaced by a plan entry point that navigates to `PlanStatusScreen`; `HomeScreen` fetches `GET /progress/dashboard` (existing endpoint, no new route) for summary display.
- [ ] 7.2 GREEN: Modify `apps/mobile/src/screens/HomeScreen.tsx` and its navigation wiring to add the plan-status entry point and the dashboard-summary fetch (no adherence banner rendering yet — that is Track D).
- [ ] 7.3 TRIANGLE: Run `pnpm --filter mobile test -- HomeScreen` green; `pnpm -w typecheck`; confirm the manual `workoutPlanId`-paste flow is no longer reachable; confirm the Track C boundary holds — reuses only the shared API (dashboard read + B1's `/adapt`), introduces no new backend endpoints, and reaches parity with the web plan/regenerate behavior.

## Phase 8: Slice D1 — Mobile Adherence Banner + Confirm [Requirements: Mobile Adherence Suggestion Surface, Coaching Tone and Internationalization]

- [ ] 8.1 RED: Add failing test for an `AdherenceBanner` component: `level: "low"` → renders the banner with accept/reject wired to the Track C `confirmAdapt`; `ok`/`insufficient_data` → no banner; a loading state while the dashboard read is in flight; an offline/error state that degrades gracefully without crashing and attempts no regeneration.
- [ ] 8.2 GREEN: Create `apps/mobile/src/screens/**/AdherenceBanner.tsx` consuming the dashboard summary's `adaptation` field (via the `GET /progress/dashboard` fetch added in C3) and `plan-status-client.ts`'s `confirmAdapt`.
- [ ] 8.3 GREEN: Reuse the `adaptation` i18n namespace (from B2) on mobile for all banner copy — no mobile-only copy fork.
- [ ] 8.4 TRIANGLE: Run `pnpm --filter mobile test -- AdherenceBanner` green; `pnpm -w typecheck`; manual smoke via the Expo dev client for low/ok/insufficient/offline; confirm the same confirm-only quota and no-quota-on-read rules as web hold on mobile; confirm no auto-apply path exists in the mobile code either.

## Dependency Order

`A1 → A2 → B1 → B2` (web ships complete and independently here) `; A1/A2 → C1 → C2 → C3 → D1`
(mobile requires A for the read surface and Track C's own three slices in order before the
mobile banner in D1 can confirm anything). B and C do not depend on each other and may run in
parallel once A2 lands; D1 depends on both A (read surface) and C3 (nav/dashboard-fetch entry
point + confirm client).
