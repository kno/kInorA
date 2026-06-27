# Design: v1 Create-Plan Wizard

## Technical Approach

Six-step true stepper (goal → location → frequency → duration → equipment → limitations) producing a typed `PlanSpec`. Drafts persist server-side in `plan_drafts` (one active per user per tenant) so exit/resume survives sessions; Finish promotes the draft to a confirmed `plan_specs` row (`confirmed=true`). `PlanSpec` is extended in `@kinora/contracts` (atomic compile-checked break), drafts/plan-specs use new Drizzle tables and tenant-scoped repositories, and the route is the FIRST protected resource route reusing `requireAuth` + tenant context. `preferenceScores` are DERIVED deterministically from answers. Delivered as 3 chained PRs (contracts+domain → api → web).

## Scope Boundary: PlanSpec vs. Workout Plan

This change (07) produces and persists a confirmed **`PlanSpec`** ONLY — the user's training *requirements* (goal, location, frequency, duration, equipment, limitations, `preferenceScores`). It does NOT produce a workout program.

The actual training *program* (exercises, sets, reps, rest, weekly schedule) is the deliverable of change **08-v1-ai-plan-generation**, whose spec accepts a `PlanSpec` and produces a structured workout plan. 08 persists that program in its OWN entity (e.g. a future `plans` / `workout_plans` table that references a `plan_specs` row).

Therefore 07 MUST NOT create exercises, training sessions, or any weekly schedule. The `plan_specs` table stores the confirmed wizard output; the `plans`/`workout_plans` table is reserved for 08 and is out of scope here.

## Architecture Decisions

| Decision | Choice | Alternatives rejected | Rationale |
|---|---|---|---|
| PlanSpec change | Break-in-place: `limitations` → object array + add `preferenceScores` | additive optional field; separate WizardSpec | monorepo `tsc` catches all consumers atomically; no permanent cruft |
| State persistence | Server `plan_drafts`, one active per user/tenant | sessionStorage/cookie; multiple drafts | spec requires cross-session resume; single draft matches resume/overwrite rule |
| preferenceScores | Derived deterministically client+server from answers | user-entered | spec says derived; reproducible, testable |
| Route shape | First protected resource route via `requireAuth` + `authContext.tenantId` | per-route ad-hoc auth | 09/10 reuse; one canonical pattern |
| Selectable card | Orbit-level `OrbitSelectableCard` | wizard-local | 08 may reuse; foundation-consistent |
| Promote | Read draft, build PlanSpec, insert plan_spec, delete draft (one tx) | keep draft | clean single-active invariant |
| Persisted entity name | `plan_specs` (confirmed requirements) | `plans` (workout program) | 07 persists requirements, not a program; `plans`/`workout_plans` reserved for 08 |

## 1. PlanSpec Contract (`packages/contracts/src/index.ts`)

```ts
export interface PlanLimitation { text: string; isWarning: boolean }
export interface PlanPreferenceScores {
  strength: number; hypertrophy: number; endurance: number; mobility: number; // 0..1
}
export interface PlanSpec {
  goal: PlanGoal;
  daysPerWeek: number;
  sessionDurationMinutes: number;
  location: TrainingLocation;            // home | gym | outdoor — REQUIRED
  equipment: string[];
  limitations: PlanLimitation[];         // was string[]
  preferenceScores: PlanPreferenceScores;
  confirmed: boolean;
}
```
`assertPlanSpecShape` (boundary.ts) updated atomically: validate `limitations` as array of `{text:string,isWarning:boolean}`, and `preferenceScores` object with four numeric keys. 08's `boundary.ts` adapts to the object `limitations` in the SAME PR.

## 2. preferenceScores Derivation

Pure fn in `@kinora/domain` (`derivePreferenceScores(spec)`), called server-side at promote (source of truth) and mirrored client-side for preview. Keys `strength|hypertrophy|endurance|mobility`, each clamped `0..1`, rounded to 2 decimals.

Base by goal, then small modifiers; final clamp 0..1:

| goal | strength | hypertrophy | endurance | mobility |
|---|---|---|---|---|
| strength | 0.9 | 0.6 | 0.2 | 0.3 |
| hypertrophy | 0.6 | 0.9 | 0.3 | 0.3 |
| fat_loss | 0.4 | 0.5 | 0.9 | 0.4 |
| general_fitness | 0.5 | 0.5 | 0.6 | 0.6 |

Modifiers: `daysPerWeek>=5` → endurance +0.1; `sessionDurationMinutes<=30` → endurance +0.1, hypertrophy −0.1; `location==="outdoor"` → endurance +0.1, mobility +0.1; `equipment` empty → strength −0.1, mobility +0.1; any `limitations` → mobility +0.1.

Example: `{goal:"strength", daysPerWeek:3, duration:60, location:"gym", equipment:["barbell"], limitations:[]}` → `{strength:0.9, hypertrophy:0.6, endurance:0.2, mobility:0.3}`.

## 3. DB Design (`apps/api/src/db/schema.ts` + new `drizzle/0002_*.sql`)

`plan_drafts`: `id uuid pk defaultRandom`, `tenant_id uuid → tenants(cascade)`, `user_id uuid → users(cascade)`, `step int notNull`, `spec_json jsonb notNull`, `updated_at timestamptz notNull defaultNow`. Unique index `plan_drafts_tenant_user_unique (tenant_id,user_id)` → enforces one active draft.

`plan_specs` (confirmed wizard requirements — NOT a workout program): `id uuid pk defaultRandom`, `tenant_id`, `user_id` (both cascade), `spec_json jsonb notNull` (the confirmed `PlanSpec`), `confirmed boolean notNull default false`, `created_at timestamptz notNull defaultNow`. Index on `(tenant_id,user_id)`. Migration is additive; down-migration drops both tables. The generated workout program (08) lives in a separate `plans`/`workout_plans` table that is out of scope here and would reference `plan_specs(id)`.

**Migration generation (mechanism, not hand-written):** define both tables in `apps/api/src/db/schema.ts`, then run `pnpm --filter api db:generate` (`drizzle-kit generate`) to emit `drizzle/0002_*.sql` AND update `drizzle/meta/_journal.json` + a new `meta/0002_snapshot.json`. Do NOT author the SQL by hand — drizzle tracks state via the journal/snapshots (existing 0000/0001 follow this). Verify by running `pnpm --filter api db:migrate` against a Postgres (the E2E harness `scripts/e2e-with-stack.mjs` and CI/deploy already apply migrations this way); confirm the two tables + indexes are created. Commit the generated `.sql`, journal, and snapshot together in the API PR.

## 4. API Design (`apps/api/src/routes/plan.ts`, register in `app.ts`)

All routes use `preHandler: requireAuth()` and read `request.authContext!.{tenantId,userId}` — body never carries tenant/user.

| Method/Path | Body | Returns |
|---|---|---|
| `POST /plan-specs/drafts` | `{ step:number; spec:Partial<PlanSpec> }` | upserted draft `{step,spec}` |
| `GET /plan-specs/drafts/current` | — | `{step,spec}` or `204` if none |
| `POST /plan-specs` | `{}` (promote current draft) | `201 {id, spec}`; `409` if no draft / incomplete |

Repositories (`apps/api/src/db/repositories/plan-draft.ts`, `plan-spec.ts`) follow `SessionRepository`: constructor `(db)`, methods accept explicit `tenantId`/`userId`. `PlanDraftRepository`: `upsert`, `findCurrent`, `delete`. `PlanSpecRepository`: `create`. Promote = service reads draft, runs `assertPlanSpecShape`+`derivePreferenceScores`, inserts the confirmed `plan_specs` row, deletes draft. No workout program is generated here (that is 08).

## 5. Open Design References (apply MUST follow these)

The wizard UI MUST be implemented from the available Open Design snapshot, not invented. Apply reads these local files (pull fresh via the `open-design` MCP only if needed):

| Source | Use for |
|---|---|
| `docs/open-design/kinora/screens/mobile-create-plan.html` | **Primary** stepper reference: one-question-per-screen layout, step-question cards, fixed bottom Continue/Back action bar, spacing/tokens. The `.step-progress`/`.step-dots`/`.step-bar-fill` markup is the default progress UI — REPLACED here by the Orbit-logo indicator below. |
| `docs/open-design/kinora/screens/web-create-plan.html` | Desktop create-plan visuals/tokens (we use the stepper, not the all-visible "Formulario" — spec wins), card styling for option cards (`.option-card`/`.obj-card`). |
| `docs/open-design/kinora/screens/web-plan.html` | Visual language continuity for the post-create plan surface (context only). |
| `docs/open-design/kinora/icons.html` | **Authoritative reference for the progress ring**: the Orbit logo used as progress (`.orbit-wrap`, `#orbitArc`, `#orbitDotG`, `.orbit-readout`) — track + growing arc + lime ball at the head + center readout. `OrbitProgress` MUST replicate this. Also the matched stroke-icon set. |
| `kinora-brand-proposals.html` | Orbit brand/logo reference. |
| `apps/web/src/components/orbit/`, `components/icons/` (06c), `apps/web/src/app/globals.css` | Reuse the Orbit primitives, `OrbitLogoIcon`, and the OKLch design tokens (`--accent`, `--accent-dim`, `--surface`, `--r-card`, etc.) — do not hardcode colors. |

Selectable option cards in the snapshot (`.option-card`/`.obj-card`) become the new `OrbitSelectableCard` primitive. All other surfaces reuse existing Orbit components.

## 5b. Web Design (`apps/web/src/app/(app)/create-plan/`, `components/wizard/`, `components/orbit/`)

Stepper shell client component holds `{step, spec}`; on entry a server component (or action) calls `GET /plan-specs/drafts/current` and hydrates (resume) or starts empty. Each Continue calls `saveDraftAction` (server action mirroring `submit-login.ts`: pure orchestrator + `Authorization: Bearer` from `kinora_session` cookie) → `POST /plan-specs/drafts`. Back is local, preserves prior values. Six step components (GoalStep, LocationStep, FrequencyStep, DurationStep, EquipmentStep, LimitationsStep); location renders before equipment and filters equipment options. Finish enabled only when all required inputs present (client guard + server `409`), calls `confirmPlanSpecAction` → `POST /plan-specs` → redirect. Finish persists the confirmed `PlanSpec` only; it does NOT generate a workout program (that is 08).

`OrbitSelectableCard` (`components/orbit/OrbitSelectableCard.tsx`, exported from `index.ts`): props `{ selected?:boolean; onSelect?:()=>void; disabled?:boolean }` + label/children, renders `.option-card`/`.obj-card` tokens, `role="button"`, `aria-pressed`.

**`OrbitProgress` — REUSABLE Orbit-logo progress ring.** This is a general-purpose component, NOT wizard-specific. `docs/open-design/kinora/icons.html` already shows the Orbit logo used as a progress ring AND lists the intended reuse: AI loader, session progress in the tracker, weekly-streak ring, loading splash. The wizard is just its first consumer. New component `components/orbit/OrbitProgress.tsx` (Orbit-level; exported from `index.ts`), with its own tests; the wizard imports it. Apply MUST replicate the `icons.html` mechanic exactly — it is the authoritative reference, not the snapshot's plain dots/bar.

**Props (reusable API):**

| Prop | Type | Default | Purpose |
|---|---|---|---|
| `value` | `number` | — | Current progress amount. |
| `max` | `number` | `100` | Denominator. Fraction `p = clamp(value/max, 0, 1)`. Wizard passes `value=current-1, max=total-1`; a % gauge passes `value=pct, max=100`. |
| `size` | `number` | `200` | Rendered px (width=height). `viewBox` stays `0 0 48 48`; the SVG scales. |
| `showPercent` | `boolean` | `false` | Show the rounded `p*100`% number in the center (the `.orbit-pct` readout). |
| `label` | `string` | — | Small uppercase caption under the readout (e.g. "Sesión", "Paso"). |
| `children` | `ReactNode` | — | Custom center content; overrides `showPercent`/`label` (wizard passes "N / 6"). |
| `indeterminate` | `boolean` | `false` | Continuous spin for loaders/splash (no fixed value); honors reduced-motion. |
| `className` | `string` | — | Style hook. |
| `aria-label` | `string` | — | Accessible name; component sets `role="progressbar"` + `aria-valuemin/max/now` from value/max (omitted when `indeterminate`). |

**Geometry / mechanic (from `icons.html`, `viewBox="0 0 48 48"`, center `(24,24)`):**
- **Track ring** (`.orbit-track`): `<circle cx=24 cy=24 r=16 stroke-width=4>`, stroke `--border`, static.
- **Progress arc** (`.orbit-arc`, `--muted`): same `<circle r=16>` with `transform="rotate(-90 24 24)"` (start at 12 o'clock); drawn via `stroke-dasharray = C`, `stroke-dashoffset = C * (1 - p)`, `C = 2π·16 ≈ 100.53`. Grows from 12 o'clock clockwise.
- **Lime ball** at the arc head: `<circle r=6 fill=--accent>` in a `<g>` with `transform-box: view-box; transform-origin: 24px 24px; transform: rotate(θ)`, `θ = p * 360°`; keep the lime drop-shadow glow. At `p=1` the ring is complete and the ball is back at the top.
- **Center readout** (`.orbit-readout`): renders `children`, else the `showPercent` number (+`label`), else nothing.
- Animate arc `stroke-dashoffset` and ball `transform` with `transition: .3s ease`; honor `prefers-reduced-motion` (drop transitions, still reflects state).

**Wizard usage:** `<OrbitProgress value={step-1} max={total-1} size={64} aria-label={"Step "+step+" of "+total}>{step} / {total}</OrbitProgress>` (custom readout shows the step count, not a %).

Tests (component-level): arc `stroke-dashoffset` and ball `<g>` rotation match a given `value/max`; `showPercent` renders the rounded %; `children` overrides the readout; `indeterminate` exposes no `aria-valuenow` and adds the spin (skipped under reduced-motion); size sets width/height. Wizard test: passes step props and shows "N / total".

## 6. Testing Strategy (Strict TDD)

| Layer | What |
|---|---|
| Contract | type-level test: `limitations` is `PlanLimitation[]`, `preferenceScores` shape present |
| Domain | `derivePreferenceScores` table cases + clamp/modifier edges; updated `plan-draft` fixtures |
| API repo | upsert single-active, findCurrent none/exists, promote inserts `plan_specs` + deletes draft, tenant isolation |
| API route | requireAuth 401 unauth; draft upsert/get; promote 201/409 incomplete; cross-tenant denial |
| Web component | each step renders cards, selection updates state; Back preserves; Finish disabled until complete; resume hydration; `OrbitSelectableCard` aria; `OrbitProgress` — arc `stroke-dashoffset` + ball `<g>` rotation + center readout + `aria-valuenow` match the step, reduced-motion path |
| E2E | full-stack harness: login → complete 6 steps → exit → resume → finish → confirmed `plan_specs` persisted (no workout program) |

## Migration / Rollout

Additive migration `0002`. Revert PRs in reverse (web → api → contracts+domain); drop both tables via down-migration.

## Delivery (3 chained PRs)

PR1 contracts+domain (PlanSpec + `derivePreferenceScores` + fixtures + `assertPlanSpecShape`; coordinate 08 `boundary.ts`) → PR2 api (tables, migration, repos, routes, register) → PR3 web (stepper from the Open Design create-plan snapshot, `OrbitSelectableCard`, `OrbitProgress` animated-logo indicator, 6 steps, server actions). Each compiles green and is autonomously testable.

## Open Questions

- None blocking. Draft TTL/purge intentionally deferred (out of scope).
