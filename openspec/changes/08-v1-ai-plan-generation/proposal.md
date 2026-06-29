# Proposal: 08 — AI Plan Generation

## Intent

After the 07 wizard captures a confirmed `PlanSpec`, the user has no plan. Today there is zero LLM infrastructure. This change adds the full AI stack to turn a confirmed `PlanSpec` into a stored, structured `WorkoutProgram` — generated automatically on wizard confirm, run in the background, with safe equipment substitutions and limitation-as-warning handling (never diagnostic). Success: confirming the wizard yields a `ready` plan the user can view, with regeneration available and live status pushed over WebSocket.

## Scope

### In Scope
- New AI stack in `apps/api/src/ai/`: `@anthropic-ai/sdk`, mock-injectable `PlanGenerator` interface, pure prompt builder, pure response parser/validator.
- `workout_plans` table (JSONB `program_json`, `status: generating|ready|failed`) + migration; `WorkoutPlanRepository` (tenant-scoped); `findConfirmedById` on `PlanSpecRepository`.
- `WorkoutProgram` contract in `@kinora/contracts` (sessions × exercises × sets/reps/rest/notes), shared with 09a.
- Pure domain functions: `applyEquipmentSubstitutions`, `injectLimitationWarnings` (no diagnostic language).
- **Auto-trigger**: `POST /plan-specs` confirm flow kicks off generation; separate **regenerate** action. Multiple `workout_plans` per `plan_spec` (latest active).
- **Async**: trigger returns immediately; background generation transitions status.
- **WebSocket** push (`@fastify/websocket`, authenticated) on `ready`/`failed`.
- `ANTHROPIC_API_KEY`/`ANTHROPIC_MODEL` plumbed into compose + CI deploy/secrets (NOT required for unit tests/CI).

### Out of Scope
- Live workout tracking / execution UI → 09a.
- Conversational / voice plan editing → v1.1 (12/13).
- The wizard itself → 07 (shipped).
- Job-queue infra beyond what background execution needs (design picks in-process async vs runner).

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `08-v1-ai-plan-generation`: existing spec covers generation, substitution, limitation-warning, no-diagnosis. Add requirements for async generation lifecycle (`generating→ready|failed`), auto-trigger on confirm + regenerate, and WebSocket status notification.

## Approach

Validate the `PlanSpec` (reuse `assertPlanSpecShape`) before any LLM call; reuse the 07 protected-resource pattern (`requireAuth` + tenant scoping + injected repositories). On confirm, create a `workout_plans` row in `generating` and return immediately; a background task builds the prompt, calls the `PlanGenerator`, parses/validates into `WorkoutProgram`, applies domain substitutions/warnings, persists, and flips status to `ready`/`failed`. The browser opens an authenticated WebSocket and receives a push on completion. The prompt MUST forbid diagnostic language; the parser MUST reject diagnostic output. Design phase consults the claude-api reference for the current model id + structured-output (tool-use) pattern, and decides the background-execution model and WebSocket auth/scaling.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/contracts/src/index.ts` | New | `WorkoutProgram`, `WorkoutSession`, `WorkoutExercise`, `WorkoutPlanStatus` |
| `packages/domain/src/plan/` | New | `equipment-substitution.ts`, `limitation-warnings.ts` |
| `apps/api/src/ai/` | New | `client.ts` (`PlanGenerator`), `prompt.ts`, `parser.ts` |
| `apps/api/src/db/schema.ts` + `drizzle/0003_*.sql` | New | `workout_plans` table + status enum |
| `apps/api/src/db/repositories/` | New/Modified | `workout-plan.ts`; `plan-spec.ts` `findConfirmedById` |
| `apps/api/src/routes/plan.ts` + `app.ts` | Modified | auto-trigger on confirm, regenerate route, WS endpoint, wire AI client |
| `apps/api` WS infra | New | `@fastify/websocket` authenticated channel |
| `docker-compose.yml`, `.github/workflows/ci-cd.yml` | Modified | `ANTHROPIC_API_KEY`/`ANTHROPIC_MODEL` (not in unit-test step) |
| `apps/web/src/app/(app)/create-plan/` | Modified | regenerate action + client; WS subscribe + status UI |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| LLM latency blocking request | High | Async background execution; trigger returns immediately |
| Model-id volatility | Med | `ANTHROPIC_MODEL` env default; design verifies current id |
| CI requiring API key | Med | Client constructable without key; unit/CI never call live API |
| WS auth/scaling | Med | Authenticated channel; design decides single-node vs scaled |
| LLM non-determinism / parse failure | Med | Tool-use structured output, temp 0, retries; status→`failed` |
| Diagnostic-language safety breach | Low | Prompt forbids; parser rejects; unit-tested prompt + parser |
| Largest net-new surface | High | Decompose into small testable units; likely chained PRs |

## Rollback Plan

Revert the change PRs (contracts/domain, api LLM+storage+WS, web). Drop migration `0003_*` (down). Remove `ANTHROPIC_*` secrets. No 07 behavior depends on this; reverting leaves the confirmed `PlanSpec` intact and ungenerated.

## Dependencies

- 07 plan-wizard (shipped): `PlanSpec`, `assertPlanSpecShape`, confirm flow.
- Anthropic API key + account; `@anthropic-ai/sdk`, `@fastify/websocket`.

## Success Criteria

- [ ] Confirming the wizard auto-creates a `workout_plans` row (`generating`) without blocking the HTTP response.
- [ ] Background generation transitions to `ready` with a valid `WorkoutProgram`, or `failed`; browser is notified over WebSocket.
- [ ] Incomplete `PlanSpec` returns a validation error before any LLM call.
- [ ] Substitutions applied for missing equipment; limitations rendered as warnings; no diagnostic language.
- [ ] Regenerate produces a new `workout_plans` row (latest active).
- [ ] Unit tests/CI pass without a live `ANTHROPIC_API_KEY`.

## First-Slice Boundary

Slice 1 (foundation, no LLM call): `WorkoutProgram` contract + pure domain substitution/warning functions + `workout_plans` schema/migration/repository — fully unit-testable, lowest risk. Later slices add the api LLM stack + async + WebSocket, then web UX. Final split decided in tasks phase.
