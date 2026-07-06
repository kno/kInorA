# Exploration: 08-v1-ai-plan-generation

## Current State

### Producer contract (07, shipped)

`PlanSpec` is defined at `packages/contracts/src/index.ts:31-40`:
- Fields: `goal: PlanGoal`, `daysPerWeek: number`, `sessionDurationMinutes: number`, `location: TrainingLocation`, `equipment: string[]`, `limitations: PlanLimitation[]`, `preferenceScores: PlanPreferenceScores`, `confirmed: boolean`
- `PlanLimitation = { text: string; isWarning: boolean }` (line 19-22)

`plan_specs` table (`apps/api/src/db/schema.ts`): uuid PK, tenant_id FK, user_id FK, spec_json JSONB, confirmed boolean, created_at. Index on (tenant_id, user_id). Migration: `apps/api/drizzle/0002_sharp_tag.sql`.

`PlanSpecRepository` (`apps/api/src/db/repositories/plan-spec.ts`): single `create()` method. No `findById` yet — 08 must add `findConfirmedById(tenantId, userId, id)`.

`POST /plan-specs` (`apps/api/src/routes/plan.ts`) returns `{ id, spec }` — web already has the spec id after wizard completion.

Validation at `apps/api/src/plan/boundary.ts`:
- `assertPlanSpecInput` — wizard fields only
- `assertPlanSpecShape` — full PlanSpec including preferenceScores + confirmed. A comment explicitly notes 08 shares this boundary.

### Existing LLM / AI infrastructure

**None.** The archived 04-v1-ai-operation (`openspec/changes/archive/2026-06-21-04-v1-ai-operation/`) was documentation-only (created `AGENTS.md`, no runtime code). Grep for `anthropic`, `@anthropic-ai`, `claude`, `openai`, `ANTHROPIC_API_KEY` finds zero matches in source. `apps/api/package.json` has no AI dependencies.

**08 must add the entire LLM stack from zero:**
1. `@anthropic-ai/sdk` to `apps/api/package.json`
2. LLM client wrapper + `PlanGenerator` interface (`apps/api/src/ai/client.ts`)
3. Prompt builder — pure function (`apps/api/src/ai/prompt.ts`)
4. LLM response parser/validator — pure function (`apps/api/src/ai/parser.ts`)
5. `ANTHROPIC_API_KEY` and `ANTHROPIC_MODEL` env vars
6. Design phase MUST consult current Anthropic SDK/Messages API docs (claude-api reference) for model ID and structured output pattern (tool-use vs response_format) — model IDs change frequently.

### Where the generated plan lives

The schema reserves this for 08: "the actual workout program will live in a separate table referencing plan_specs(id)." 08 defines a `workout_plans` table. 09a (`openspec/specs/09a-v1-workout-tracking-core/spec.md`) needs session day, exercise list, planned sets/reps/rest — enough to drive the live tracker and exercise detail surfaces.

**Recommended storage: JSONB `program_json` on `workout_plans`**
```
workout_plans(id, tenant_id, user_id, plan_spec_id FK, program_json JSONB, status ENUM, generated_at)
```
`program_json` holds a `WorkoutProgram` contract type (sessions × exercises × sets/reps/rest/notes). 09a references `workout_plan_id` and reads session structure from JSONB. `status` enum (`generating | ready | failed`) enables future async migration without a schema change.

### API + route pattern

Established at `apps/api/src/routes/plan.ts` + `apps/api/src/auth/plugin.ts`:
- `requireAuth()` preHandler reads `request.authContext!.{ tenantId, userId }` — never from body
- Repository injected via plugin options at `buildApp()` (`apps/api/src/app.ts`)
- 08 adds: `POST /plan-specs/:id/generate` route

Web pattern: server action in `apps/web/src/app/(app)/create-plan/actions.ts` wraps a typed pure client function (mirrors `plan-draft-client.ts`). 08 adds `generatePlanAction(specId)` + `generatePlan(specId, token)`.

### Domain logic

Pure functions in `@kinora/domain` (alongside `derive-preference-scores.ts`):
- `packages/domain/src/plan/equipment-substitution.ts` — `applyEquipmentSubstitutions(program, equipment[])`
- `packages/domain/src/plan/limitation-warnings.ts` — `injectLimitationWarnings(program, limitations[])` — no diagnostic language

Prompt building and response parsing stay in `apps/api/src/ai/` — LLM infrastructure, not domain rules.

### Testing strategy (Strict TDD active)

Real Anthropic API calls MUST NOT run in unit tests or CI.
1. `PlanGenerator` interface injected into routes — production impl wraps SDK; tests use a `vi.fn()` stub.
2. Pure-function unit tests (no mock): `buildPlanPrompt` (asserts goal/equipment/days present; limitation warnings present; NO diagnostic language), `parsePlanResponse` (valid JSON → WorkoutProgram; invalid → ParseError), `applyEquipmentSubstitutions`, `injectLimitationWarnings`.
3. Route tests (mock DB + mock generator): 422 before LLM call on incomplete spec; 404 wrong tenant; 401 unauthenticated; 201 happy path.
4. Repository tests (mock DB): `WorkoutPlanRepository.create`/`findById` tenant-scoped isolation.
5. E2E (`scripts/e2e-with-stack.mjs`): real DB + API, Anthropic SDK intercepted at the client boundary — no live API calls in CI.
6. `ANTHROPIC_API_KEY` must not be required for unit test runs — client constructable with a missing key, fails only at call time.

### Config / secrets

- `ANTHROPIC_API_KEY` — required for generation; validate at API startup.
- `ANTHROPIC_MODEL` — optional, env-configurable default (design confirms model ID).
- `docker-compose.yml` api env block: add both vars.
- `.github/workflows/ci-cd.yml` deploy env + "Validate required secrets": add `ANTHROPIC_API_KEY`. CI unit-test step must NOT require it.

## Affected Areas

- `packages/contracts/src/index.ts` — add `WorkoutProgram`, `WorkoutSession`, `WorkoutExercise`, `WorkoutPlanStatus`
- `packages/domain/src/plan/equipment-substitution.ts`, `limitation-warnings.ts` — new pure functions; re-export from `index.ts`
- `apps/api/src/db/schema.ts` — add `workoutPlans` table + status enum; `apps/api/drizzle/0003_*.sql` migration
- `apps/api/src/db/repositories/plan-spec.ts` — add `findConfirmedById`; `workout-plan.ts` — new repository
- `apps/api/src/ai/{client,prompt,parser}.ts` — new LLM stack
- `apps/api/src/routes/plan.ts` — add generation route; `apps/api/src/app.ts` — wire AI client
- `docker-compose.yml`, `.github/workflows/ci-cd.yml` — `ANTHROPIC_API_KEY` plumbing
- `apps/web/src/app/(app)/create-plan/` — `generatePlanAction` + client function

## Approaches

| Approach | Pros | Cons | Effort |
|----------|------|------|--------|
| A. Synchronous (block on LLM) | Simple; one round trip; matches 07 pattern; no job infra | Timeout risk (10-20s); Fastify per-route timeout config needed | Low |
| B. Async with status polling | No timeout risk; user can leave/return | Polling complexity; job runner; status transitions; overkill for v1 | High |
| C. Synchronous with SSE streaming | Responsive UX | Complex streaming client+server; premature for v1 | High |

## Recommendation

**Approach A — synchronous for v1.** Spec requires neither streaming nor async. Add a `status` enum column from the start so async migration stays backward-compatible. Fastify supports per-route timeout override.

Design phase MUST: (1) consult the claude-api reference for the current model ID; (2) choose tool-use vs `response_format` schema for structured output (tool-use more reliable); (3) define the `WorkoutProgram` contract shape; (4) confirm Fastify timeout config for long routes.

## Key Decisions for the Proposal

1. **Storage shape**: JSONB `program_json` (recommended — avoids premature normalization; 09a needs only a FK + enough JSON for planned sets) vs normalized session/exercise tables.
2. **Generation trigger**: explicit `POST /plan-specs/:id/generate` (recommended — single responsibility, supports regeneration) vs automatic on confirm.
3. **LLM output format**: tool-use / response_format schema (recommended — reliable structured plans) vs raw JSON in user message.

## Open Questions

- Max acceptable latency for synchronous generation? (If <5s required, async/streaming may be needed.)
- Allow multiple generated plans per PlanSpec (regeneration)? Recommendation: yes — `plan_spec_id` not unique on `workout_plans`.
- Validate generated plan structure before persisting? Yes — `parsePlanResponse` asserts `WorkoutProgram` shape before insert.

## Risks

- **LLM latency** vs Fastify timeout → configure per-route timeout.
- **LLM output non-determinism** → robust parser + 1-2 retries at temperature 0.
- **Model ID volatility** → env-configurable default; verify current model in design.
- **CI key requirement** → `ANTHROPIC_API_KEY` not required for unit tests; client mock-injectable.
- **WorkoutProgram forward-compat** → define the contract type now for 09a.
- **Diagnostic language** → prompt forbids it; unit-test prompt text + parser rejects diagnostic patterns.
- **Largest net-new surface so far** → decompose into small, independently testable units (client, prompt, parser, substitution, repository) within the per-task budget.
