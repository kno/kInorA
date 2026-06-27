# Tasks: v1 Create-Plan Wizard

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 900–1 200 (additions + deletions) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 → PR 2 → PR 3 (stacked to main) |
| Delivery strategy | ask-on-risk |
| Chain strategy | stacked-to-main |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Base |
|------|------|-----------|------|
| 1 | Contracts + domain: extend `PlanSpec`, `derivePreferenceScores`, fixtures, `assertPlanSpecShape` | PR 1 | main |
| 2 | API: DB schema, generated migration, repositories, routes, register in `app.ts` | PR 2 | PR 1 merged to main |
| 3 | Web: `OrbitProgress`, `OrbitSelectableCard`, 6 step components, stepper shell, server actions, E2E | PR 3 | PR 2 merged to main |

---

## PR 1 — Contracts + Domain

> Autonomous. No workout program. Ends with `tsc` green monorepo-wide and all unit tests passing.

### Phase 1 — RED: Contract types

- [x] 1.1 **TEST (RED)** — In `packages/contracts/src/__tests__/plan-spec.test.ts` (create file): write a type-level compile test asserting `PlanLimitation` has `{text:string;isWarning:boolean}`, `PlanPreferenceScores` has four numeric keys (`strength|hypertrophy|endurance|mobility`), and `PlanSpec` includes `location: TrainingLocation`, `limitations: PlanLimitation[]`, and `preferenceScores: PlanPreferenceScores`. Confirm this fails before the change.
- [x] 1.2 **IMPLEMENT** — In `packages/contracts/src/index.ts`: export `PlanLimitation`, `PlanPreferenceScores`; update `PlanSpec` replacing `limitations: string[]` → `limitations: PlanLimitation[]`, add `location: TrainingLocation` (if not present), add `preferenceScores: PlanPreferenceScores`. Keep all other existing fields untouched.
- [x] 1.3 **VERIFY** — Run `pnpm --filter contracts test`; confirm GREEN. Run `pnpm tsc --noEmit` from repo root; ALL consumers must compile — fix any type errors before continuing.

### Phase 2 — RED: `derivePreferenceScores` pure function

- [x] 2.1 **TEST (RED)** — In `packages/domain/src/plan/__tests__/derive-preference-scores.test.ts` (create file): write table-driven tests for all four base-goal rows from the design; clamp tests (result never < 0 or > 1); each modifier case: `daysPerWeek>=5` → endurance +0.1; `sessionDurationMinutes<=30` → endurance +0.1, hypertrophy −0.1; `location==="outdoor"` → endurance +0.1, mobility +0.1; `equipment` empty → strength −0.1, mobility +0.1; any `limitations` → mobility +0.1; combined modifiers; reference example from design (`strength/3/60/gym/barbell/[]` → `{strength:0.9,hypertrophy:0.6,endurance:0.2,mobility:0.3}`). Confirm RED.
- [x] 2.2 **IMPLEMENT** — Create `packages/domain/src/plan/derive-preference-scores.ts`: `export function derivePreferenceScores(spec: Pick<PlanSpec, 'goal'|'daysPerWeek'|'sessionDurationMinutes'|'location'|'equipment'|'limitations'>): PlanPreferenceScores`. Apply base table then modifiers; clamp each key to `[0,1]`; round to 2 decimals. Export from `packages/domain/src/index.ts`.
- [x] 2.3 **VERIFY** — Run `pnpm --filter domain test`; confirm GREEN.

### Phase 3 — RED: Domain fixtures + `assertPlanSpecShape`

- [x] 3.1 **TEST (RED)** — In `packages/domain/src/plan/__tests__/plan-draft.test.ts` (or existing fixture test): update/add assertions that fixtures include `location`, `limitations` as `PlanLimitation[]`, and `preferenceScores` with correct shape. Confirm RED.
- [x] 3.2 **IMPLEMENT** — Update `plan-draft` fixtures in `packages/domain/src/plan/plan-draft.ts` (or fixture file): replace any `limitations: string[]` with `limitations: PlanLimitation[]`, add `location`, add `preferenceScores` stub values.
- [x] 3.3 **TEST (RED)** — In `apps/api/src/plan/__tests__/boundary.test.ts` (create or extend): write tests for the updated `assertPlanSpecShape` — valid object passes; `limitations` not array of `{text,isWarning}` throws; `preferenceScores` missing/invalid throws; 08's `boundary.ts` acceptance of `PlanLimitation[]` (coordinate comment noting atomic coupling). Confirm RED.
- [x] 3.4 **IMPLEMENT** — In `apps/api/src/plan/boundary.ts`: update `assertPlanSpecShape` to validate `limitations` as `{text:string,isWarning:boolean}[]` and `preferenceScores` as `{strength,hypertrophy,endurance,mobility}` all numbers. Also update `apps/api/src/plan/boundary.ts` coordinate for change 08 (same file, atomic update — both limitation shapes handled).
- [x] 3.5 **VERIFY** — Run `pnpm --filter api test`; run `pnpm tsc --noEmit` from root; confirm GREEN across all packages. PR 1 is complete.

---

## PR 2 — API

> Depends on PR 1 merged to main. No workout program generated. Ends with migrations applied, routes tested, `tsc` green.

### Phase 4 — RED: DB schema + migration

- [x] 4.1 **TEST (RED)** — In `apps/api/src/db/__tests__/schema.test.ts` (create or extend): write type assertions that `plan_drafts` and `plan_specs` table schemas exist with the correct column types (id uuid, tenant_id, user_id, step/spec_json/updated_at for drafts; id/tenant_id/user_id/spec_json/confirmed/created_at for plan_specs). Confirm RED.
- [x] 4.2 **IMPLEMENT** — In `apps/api/src/db/schema.ts`: add `planDrafts` table (`id uuid pk defaultRandom`, `tenant_id uuid → tenants cascade`, `user_id uuid → users cascade`, `step int notNull`, `spec_json jsonb notNull`, `updated_at timestamptz notNull defaultNow`) with unique index `plan_drafts_tenant_user_unique(tenant_id, user_id)`; add `planSpecs` table (`id uuid pk defaultRandom`, `tenant_id`, `user_id` both cascade, `spec_json jsonb notNull`, `confirmed boolean notNull default false`, `created_at timestamptz notNull defaultNow`) with index on `(tenant_id, user_id)`.
- [x] 4.3 **GENERATE MIGRATION** — Run `pnpm --filter api db:generate` (drizzle-kit); commit the emitted `drizzle/0002_*.sql`, updated `drizzle/meta/_journal.json`, and new `drizzle/meta/0002_snapshot.json` together. Do NOT hand-write the SQL.
- [x] 4.4 **VERIFY** — Run `pnpm --filter api db:migrate` against a Postgres instance (E2E harness `scripts/e2e-with-stack.mjs`); confirm both tables and the unique index are created.

### Phase 5 — RED: Repositories

- [x] 5.1 **TEST (RED)** — Create `apps/api/src/db/repositories/__tests__/plan-draft.test.ts`: tests for `PlanDraftRepository.upsert` (single-active: second upsert for same tenant+user replaces first); `findCurrent` returns null when none; `findCurrent` returns latest step+spec; `delete` removes record; cross-tenant isolation (tenant A cannot see tenant B draft). Confirm RED.
- [x] 5.2 **IMPLEMENT** — Create `apps/api/src/db/repositories/plan-draft.ts`: `PlanDraftRepository` class constructor `(db: Db)` with `upsert(tenantId, userId, step, spec): Promise<Draft>`, `findCurrent(tenantId, userId): Promise<Draft|null>`, `delete(tenantId, userId): Promise<void>`.
- [x] 5.3 **TEST (RED)** — Create `apps/api/src/db/repositories/__tests__/plan-spec.test.ts`: tests for `PlanSpecRepository.create` inserts confirmed `plan_specs` row; `confirmed` field is `true`; cross-tenant isolation. Confirm RED.
- [x] 5.4 **IMPLEMENT** — Create `apps/api/src/db/repositories/plan-spec.ts`: `PlanSpecRepository` class constructor `(db: Db)` with `create(tenantId, userId, spec: PlanSpec): Promise<{id: string; spec: PlanSpec}>`.
- [x] 5.5 **VERIFY** — Run `pnpm --filter api test`; confirm GREEN.

### Phase 6 — RED: Plan routes

- [x] 6.1 **TEST (RED)** — Create `apps/api/src/routes/__tests__/plan.test.ts`: `POST /plan-specs/drafts` returns 401 without auth token; returns upserted draft with step+spec when authenticated; second call for same user replaces previous (single-active); `GET /plan-specs/drafts/current` returns 204 when no draft; returns `{step,spec}` when draft exists; `POST /plan-specs` returns 409 when no draft or incomplete spec (missing required fields); returns 201 `{id,spec}` when draft is complete + deletes the draft; cross-tenant: user from tenant B cannot see tenant A draft (403 or 204). Confirm RED.
- [x] 6.2 **IMPLEMENT** — Create `apps/api/src/routes/plan.ts`: `planRoutes(fastify, {db})` using `preHandler: requireAuth()`; read `request.authContext!.{tenantId,userId}`; `POST /plan-specs/drafts` → `PlanDraftRepository.upsert`; `GET /plan-specs/drafts/current` → `findCurrent` → 204 or `{step,spec}`; `POST /plan-specs` → read draft → `assertPlanSpecShape` → `derivePreferenceScores` → `PlanSpecRepository.create` + `PlanDraftRepository.delete` in one transaction → 201 `{id,spec}`; returns 409 if no draft or shape invalid. No workout program generated.
- [x] 6.3 **IMPLEMENT** — Register `planRoutes` in `apps/api/src/app.ts`; pass `db` instance.
- [x] 6.4 **VERIFY** — Run `pnpm --filter api test`; run `pnpm tsc --noEmit`; confirm GREEN. PR 2 is complete.

---

## PR 3 — Web

> Depends on PR 2 merged to main. Implemented strictly from the Open Design create-plan snapshot. Ends with all component tests + E2E green.

### Phase 7 — RED: `OrbitProgress` component

- [x] 7.1 **TEST (RED)** — Create `apps/web/src/components/orbit/__tests__/OrbitProgress.test.tsx`: arc `stroke-dashoffset` equals `C*(1-p)` for a given `value/max` (C≈100.53); ball `<g>` `transform` rotation equals `p*360°`; `showPercent` renders rounded `p*100`%; `children` overrides percent readout; `indeterminate` omits `aria-valuenow` and adds spin class; `size` prop sets `width` and `height` on svg; `aria-label` sets accessible name; reduced-motion path removes transitions. Confirm RED.
- [x] 7.2 **IMPLEMENT** — Create `apps/web/src/components/orbit/OrbitProgress.tsx`: SVG `viewBox="0 0 48 48"` scaled by `size` prop; track ring `<circle cx=24 cy=24 r=16 stroke-width=4>` stroke `var(--border)`; arc `<circle r=16 transform="rotate(-90 24 24)">` stroke `--muted` with `stroke-dasharray≈100.53`, `stroke-dashoffset=C*(1-p)`, `transition:.3s ease`; lime ball `<circle r=6 fill=var(--accent)>` in `<g transform-box=view-box transform-origin=24px 24px rotate(θ)>` with glow drop-shadow; center readout renders `children` else `showPercent` number (+ `label`) else nothing; `role="progressbar"` + `aria-valuemin=0 aria-valuemax={max} aria-valuenow={value}` (omitted when `indeterminate`); honor `prefers-reduced-motion`. Replicate `icons.html` mechanic exactly.
- [x] 7.3 **IMPLEMENT** — Export `OrbitProgress` from `apps/web/src/components/orbit/index.ts`.
- [x] 7.4 **VERIFY** — Run `pnpm --filter web test`; confirm GREEN.

### Phase 8 — RED: `OrbitSelectableCard` component

- [x] 8.1 **TEST (RED)** — Create `apps/web/src/components/orbit/__tests__/OrbitSelectableCard.test.tsx`: renders children; `selected=true` sets `aria-pressed="true"`; `onSelect` called on click; `disabled=true` blocks click and sets `aria-disabled`; applies `.option-card` token class. Confirm RED.
- [x] 8.2 **IMPLEMENT** — Create `apps/web/src/components/orbit/OrbitSelectableCard.tsx`: props `{selected?, onSelect?, disabled?, className?, children}` + label; `role="button"`, `aria-pressed={selected}`, `aria-disabled={disabled}`; renders `.option-card`/`.obj-card` classes from design tokens; no hardcoded colors.
- [x] 8.3 **IMPLEMENT** — Export `OrbitSelectableCard` from `apps/web/src/components/orbit/index.ts`.
- [x] 8.4 **VERIFY** — Run `pnpm --filter web test`; confirm GREEN.

### Phase 9 — RED: Six step components

- [x] 9.1 **TEST (RED)** — Create `apps/web/src/components/wizard/__tests__/GoalStep.test.tsx`: renders `OrbitSelectableCard` for each goal option; selecting one calls `onSelect` with the goal value; pre-selected value renders `aria-pressed="true"`. Confirm RED.
- [x] 9.2 **IMPLEMENT** — Create `apps/web/src/components/wizard/GoalStep.tsx`: props `{value?, onSelect}`, renders selectable cards for each `PlanGoal` value using `OrbitSelectableCard`, reuses design tokens from OD mobile-create-plan snapshot.
- [x] 9.3 **TEST (RED)** — Create `apps/web/src/components/wizard/__tests__/LocationStep.test.tsx`: renders three options (home/gym/outdoor); selection calls handler; pre-selected reflects. Confirm RED.
- [x] 9.4 **IMPLEMENT** — Create `apps/web/src/components/wizard/LocationStep.tsx`: props `{value?, onSelect}`, three `OrbitSelectableCard` options for `TrainingLocation`.
- [x] 9.5 **TEST (RED)** — Create `apps/web/src/components/wizard/__tests__/FrequencyStep.test.tsx`: renders day-count options; selection updates; pre-selected reflects. Confirm RED.
- [x] 9.6 **IMPLEMENT** — Create `apps/web/src/components/wizard/FrequencyStep.tsx`: props `{value?, onSelect}`, numeric card options for `daysPerWeek`.
- [x] 9.7 **TEST (RED)** — Create `apps/web/src/components/wizard/__tests__/DurationStep.test.tsx`: renders duration options; selection updates. Confirm RED.
- [x] 9.8 **IMPLEMENT** — Create `apps/web/src/components/wizard/DurationStep.tsx`: props `{value?, onSelect}`, options for `sessionDurationMinutes`.
- [x] 9.9 **TEST (RED)** — Create `apps/web/src/components/wizard/__tests__/EquipmentStep.test.tsx`: options filtered by selected `location` (home ≠ gym options); empty selection is valid; submitting with empty array is accepted. Confirm RED.
- [x] 9.10 **IMPLEMENT** — Create `apps/web/src/components/wizard/EquipmentStep.tsx`: props `{value?, location, onSelect}`, renders `OrbitSelectableCard` for each equipment option filtered by `location`; multi-select; empty array allowed.
- [x] 9.11 **TEST (RED)** — Create `apps/web/src/components/wizard/__tests__/LimitationsStep.test.tsx`: renders text input; added limitation appears as `{text, isWarning:true}`; empty list is valid. Confirm RED.
- [x] 9.12 **IMPLEMENT** — Create `apps/web/src/components/wizard/LimitationsStep.tsx`: props `{value?, onSelect}`, free-text input; each entry stored as `PlanLimitation{text, isWarning:true}`; no medical diagnosis logic.
- [x] 9.13 **VERIFY** — Run `pnpm --filter web test`; confirm all 6 step component tests GREEN.

### Phase 10 — RED: Stepper shell + server actions

- [x] 10.1 **TEST (RED)** — Create `apps/web/src/app/(app)/create-plan/__tests__/stepper-shell.test.tsx`: renders current step component; Back preserves prior values; Continue is disabled when current step value is null (for required steps); Finish is disabled unless all required inputs present; `OrbitProgress` receives correct `value`/`max` props; resume: when `initialDraft` is provided shell starts at draft step with pre-filled values; overwrite: when existing draft, shows continue/overwrite option. Confirm RED.
- [x] 10.2 **IMPLEMENT** — Create `apps/web/src/app/(app)/create-plan/StepperShell.tsx` (client component): state `{step:number; spec:Partial<PlanSpec>}`; steps array `[GoalStep, LocationStep, FrequencyStep, DurationStep, EquipmentStep, LimitationsStep]`; `<OrbitProgress value={step-1} max={5} size={64} aria-label={"Step "+step+" of 6"}>{step} / 6</OrbitProgress>`; Back is local (no server call), preserves spec slice; Continue calls `saveDraftAction`; Finish enabled only when `goal, location, daysPerWeek, sessionDurationMinutes` non-null and `equipment` visited; Finish calls `confirmPlanSpecAction` then redirect. Replaces the placeholder scaffold.
- [x] 10.3 **IMPLEMENT** — Create `apps/web/src/app/(app)/create-plan/actions.ts`: `saveDraftAction(step, spec)` → `POST /plan-specs/drafts` with `Authorization: Bearer <kinora_session cookie>` (mirror `submit-login.ts` pattern); `confirmPlanSpecAction()` → `POST /plan-specs` → redirect on success, throw on 409.
- [x] 10.4 **IMPLEMENT** — Update `apps/web/src/app/(app)/create-plan/page.tsx`: server component calls `GET /plan-specs/drafts/current` to get `initialDraft`; renders `<StepperShell initialDraft={...} />`.
- [x] 10.5 **VERIFY** — Run `pnpm --filter web test`; run `pnpm tsc --noEmit`; confirm GREEN.

### Phase 11 — E2E

- [x] 11.1 **TEST (RED)** — In `apps/web/src/e2e/` (or equivalent E2E directory): write authenticated E2E test: login → navigate to `/create-plan` → complete all 6 steps → exit (close tab / navigate away) → re-open `/create-plan` → resume at correct step with prior values → complete → Finish → assert redirect, assert `plan_specs` row exists in DB with correct spec (no workout program row). Confirm RED against `pnpm test:e2e` using `scripts/e2e-with-stack.mjs`.
- [x] 11.2 **VERIFY** — Run `pnpm test:e2e`; confirm GREEN. PR 3 is complete.

---

## Cross-Cutting Rules (apply in every PR)

- 07 persists a confirmed `PlanSpec` ONLY — no exercises, sessions, or weekly schedule created.
- Reuse Orbit foundation (06c) and `--accent`, `--border`, `--surface`, `--r-card` design tokens; no hardcoded colors.
- Each PR must compile green (`tsc --noEmit`) and all its tests must pass independently before merging.
- PR 2 depends on PR 1 being merged; PR 3 depends on PR 2 being merged. Do not mix concerns across PR boundaries.
- Migration is generated (`db:generate`), not hand-authored; commit SQL + journal + snapshot together.
- Commit messages follow Conventional Commits; no AI attribution.
