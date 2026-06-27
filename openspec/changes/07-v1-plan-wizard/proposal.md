# Proposal: v1 Create-Plan Wizard

## Intent

Authenticated users have no way to capture their training requirements: the create-plan surface is a 17-line placeholder. This change delivers the card-based, step-by-step create-plan wizard from the spec, producing a typed `PlanSpec` (the user's training *requirements*) that 08 (AI plan generation) consumes to produce the actual workout program. Outcome: a user defines goal, training location, frequency, duration, equipment, and limitations one step at a time, can leave and resume exactly where they stopped, and finishes with a **confirmed `PlanSpec` persisted** (NOT a workout program). A `PlanSpec` cannot be confirmed without all required inputs — including `location` (home/gym/outdoor), which gates the relevant equipment.

## Scope

### In Scope
- True stepper UI on all viewports (one step at a time), per the mobile Open Design stepper.
- Six steps: goal, location (home/gym/outdoor), frequency, duration, equipment, limitations — with state-preserving Back nav. `location` precedes equipment because it constrains the available equipment.
- All required inputs (goal, location, frequency, duration, equipment, limitations) must be captured before a `PlanSpec` can be confirmed.
- `preferenceScores` DERIVED from answers (not user-entered).
- Limitations stored as `{ text: string; isWarning: boolean }[]`, `isWarning` default `true` (no diagnosis).
- Server-persisted single active draft per user per tenant; resume/overwrite on re-entry; promote to a confirmed `PlanSpec` (`plan_specs` row) on Finish.
- First protected resource route: `requireAuth` + tenant scoping + repository pattern.
- UI implemented from the available Open Design create-plan snapshot (mobile stepper as primary reference), reusing the Orbit foundation and design tokens.
- New `OrbitSelectableCard` primitive (Orbit-level; 08 may reuse).
- New **reusable** `OrbitProgress` component (Orbit-level): the Orbit logo used as a progress ring exactly as already shown in `docs/open-design/kinora/icons.html` (track + arc growing from 12 o'clock + lime ball at the arc head + center readout). Props include `value`/`max` (progress), `showPercent`, `size`, `label`/`children`, `indeterminate`. Built reusable on purpose (icons.html lists reuse: AI loader, session progress, weekly streak, splash); the wizard is its first consumer and replaces the snapshot's plain dots/bar with it.

### Out of Scope
- AI plan generation (08): the actual workout program (exercises, sets, reps, rest, weekly schedule). 07 produces a confirmed `PlanSpec` only; 08 consumes that `PlanSpec` and persists the generated program in its own entity (e.g. a future `plans`/`workout_plans` table that references a `plan_specs` row). 07 MUST NOT create exercises, sessions, or a schedule.
- Conversational / voice create-plan (v1.1).
- Open Design desktop "Formulario" all-visible layout (spec stepper wins).
- Draft TTL / purge policy (later change).

## Capabilities

### New Capabilities
- None — the `07-v1-plan-wizard` capability spec already exists in `openspec/specs/`.

### Modified Capabilities
- `07-v1-plan-wizard`: implements the existing spec; no requirement changes. The spec's "preference scores" are clarified as derived-from-answers (proposal decision, not a spec edit).

## Approach

Extend `PlanSpec` in `@kinora/contracts` in place: `limitations: string[]` → `{ text; isWarning }[]` plus `preferenceScores`. This is a compile-time, monorepo-bounded break that `tsc` catches across all consumers; it MUST be applied atomically with 08's `apps/api/src/plan/boundary.ts`. Persist drafts in a new `plan_drafts` table and confirmed `PlanSpec`s in `plan_specs` (the workout-program table is 08's and out of scope). Build the wizard as a true stepper reusing the Orbit foundation plus a new `OrbitSelectableCard`. `preferenceScores` are computed deterministically from wizard answers.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/contracts/src/index.ts` | Modified | Extend `PlanSpec` (limitations object, `preferenceScores`) |
| `packages/domain/src/plan/plan-draft.ts` | Modified | Inherits extended `PlanSpec`; fixtures |
| `apps/api/src/plan/boundary.ts` | Modified | `assertPlanSpecShape` for new shape (coordinate w/ 08) |
| `apps/api/src/db/schema.ts` + migration | New | `plan_drafts`, `plan_specs` tables |
| `apps/api/src/db/repositories/` | New | `PlanDraftRepository`, `PlanSpecRepository` (`plan-spec.ts`) |
| `apps/api/src/routes/plan.ts` + `app.ts` | New | First protected route: `POST /plan-specs/drafts`, `GET /plan-specs/drafts/current`, `POST /plan-specs` (promote) |
| `apps/web/src/app/(app)/create-plan/page.tsx` | Modified | Replace scaffold with stepper shell |
| `apps/web/src/components/orbit/OrbitSelectableCard.tsx` | New | Selectable option card primitive (from OD `.option-card`/`.obj-card`) |
| `apps/web/src/components/orbit/OrbitProgress.tsx` | New | Reusable Orbit-logo progress ring (props: value/max, showPercent, size, label/children, indeterminate) per `icons.html` |
| `apps/web/src/components/wizard/` | New | 6 step components (incl. location) + draft server actions, built from the OD create-plan snapshot |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| `PlanSpec` break desyncs 08 | Med | Atomic edit + `tsc` gate; update `boundary.ts` same PR |
| First protected-route pattern wrong (reused by 09/10) | Med | Follow auth/tenant/repository conventions; route + repo tests |
| PR-size risk HIGH | High | Delivery `ask-on-risk`; exploration recommends 3 chained PRs (contracts+domain → api → web); split decided in tasks phase |
| `preferenceScores` mapping unclear | Low | Decided: derived from answers; exact map defined in design |

## Rollback Plan

Revert the chained PRs in reverse order (web → api → contracts+domain). The `plan_drafts`/`plan_specs` migration is additive; roll back via a down-migration dropping both tables. `PlanSpec` reverts cleanly since the change is atomic and compile-checked.

## Dependencies

- Orbit component foundation (06c) — available.
- Coordinated atomically with 08's `apps/api/src/plan/boundary.ts`.
- Boundary with 08 (AI plan generation): 07 is the producer of a confirmed `PlanSpec`; 08 is its consumer and owns the generated workout program. 08's eventual workout-program entity references `plan_specs(id)`. 07 does not depend on 08 being implemented.

## Success Criteria

- [ ] User completes all 6 steps (incl. location) and a confirmed `plan_specs` row (the `PlanSpec`) is persisted — no workout program is created.
- [ ] A `PlanSpec` cannot be confirmed unless goal, location, frequency, duration, equipment, and limitations are all captured.
- [ ] Back nav preserves prior step values.
- [ ] Exit-then-return resumes at the exact step from the server draft.
- [ ] Limitations stored as `{ text, isWarning: true }[]`; `preferenceScores` derived.
- [ ] The plan-specs route is auth-protected and tenant-scoped; `tsc` and Vitest coverage pass.

## First-Slice Scope Boundary

First deliverable slice: contracts + domain (PR 1) — extend `PlanSpec`, fixtures, and `assertPlanSpecShape`. It is autonomous, compiles green, and unblocks api and web slices.
