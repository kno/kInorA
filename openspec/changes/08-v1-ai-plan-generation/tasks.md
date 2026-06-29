# Tasks: 08 — AI Plan Generation

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 1 800 – 2 400 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR1 → PR2 → PR3 → PR4 → PR5 → PR6 → PR7a → PR7b |
| Delivery strategy | ask-on-risk |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Contracts | PR 1 | no deps; base for all |
| 2 | Pure domain functions | PR 2 | depends PR1 |
| 3 | DB schema + repositories | PR 3 | depends PR1 |
| 4 | AI port + prompt (no network) | PR 4 | depends PR1, PR2 |
| 5 | OpenRouter adapter + Langfuse + secrets | PR 5 | depends PR4 |
| 6 | Generation service + API routes | PR 6 | depends PR3, PR4, PR5 |
| 7a | WebSocket server (api) | PR 7a | depends PR6 |
| 7b | Web UX | PR 7b | depends PR6, PR7a |

---

## PR 1 — Contract (no deps)

### Phase 1.1: Types
- [x] 1.1.1 Add `WorkoutPlanStatus`, `WorkoutExercise`, `WorkoutSession`, `WorkoutProgram` to `packages/contracts/src/index.ts`

### Phase 1.2: Zod schema (collocated in contracts)
- [x] 1.2.1 Create `packages/contracts/src/workout-program.schema.ts` exporting `WorkoutProgramSchema` (Zod) mirroring the TS types; include `limitationWarnings` array

### Phase 1.3: Tests (RED → GREEN)
- [x] 1.3.1 RED: write `packages/contracts/src/__tests__/workout-program.test.ts` — assert `WorkoutProgram` shape, `WorkoutPlanStatus` union, schema parse of a valid object, schema rejection of diagnostic language fields
- [x] 1.3.2 GREEN: ensure tests pass with the types added in 1.1.1 and schema in 1.2.1
- [x] 1.3.3 Re-export `WorkoutProgramSchema` from `packages/contracts/src/index.ts`

### Phase 1.4: Commit
- [x] 1.4.1 Conventional commit: `feat(contracts): add WorkoutProgram types and Zod schema`

---

## PR 2 — Domain pure functions (needs PR1)

### Phase 2.1: Equipment substitution
- [x] 2.1.1 RED: write `packages/domain/src/plan/__tests__/equipment-substitution.test.ts` — bodyweight substitution maps, no-op when equipment available, substitution note recorded in exercise
- [x] 2.1.2 GREEN: create `packages/domain/src/plan/equipment-substitution.ts` — `applyEquipmentSubstitutions(program, equipment): WorkoutProgram`; pure, no network imports
- [x] 2.1.3 REFACTOR: extract substitution map to a data constant in the same file

### Phase 2.2: Limitation warnings
- [x] 2.2.1 RED: write `packages/domain/src/plan/__tests__/limitation-warnings.test.ts` — warning appended when limitation present, no hard-block, no duplicate warnings
- [x] 2.2.2 GREEN: create `packages/domain/src/plan/limitation-warnings.ts` — `injectLimitationWarnings(program, limitations): WorkoutProgram`; pure

### Phase 2.3: Diagnostic language guard
- [x] 2.3.1 RED: write `packages/domain/src/plan/__tests__/diagnostic-guard.test.ts` — rejects strings containing diagnostic patterns, passes clean strings
- [x] 2.3.2 GREEN: create `packages/domain/src/plan/diagnostic-guard.ts` — `assertNoDiagnosticLanguage(program): void | throws`; pure, no network

### Phase 2.4: Re-exports + commit
- [x] 2.4.1 Export all three functions from `packages/domain/src/plan/index.ts` and `packages/domain/src/index.ts`
- [x] 2.4.2 Conventional commit: `feat(domain): add equipment substitution, limitation warnings, diagnostic guard`

---

## PR 3 — Storage (needs PR1)

### Phase 3.1: Schema + enum
- [x] 3.1.1 RED: write `apps/api/src/db/__tests__/workout-plan-schema.test.ts` — assert `workout_plan_status` enum values, `workout_plans` table column presence and types
- [x] 3.1.2 GREEN: add `workout_plan_status` pgEnum and `workout_plans` table (id, tenant_id, user_id, plan_spec_id FK, status, program_json JSONB, error_message, created_at, updated_at) to `apps/api/src/db/schema.ts`

### Phase 3.2: Migration
- [x] 3.2.1 Run `pnpm db:generate` — commit generated `drizzle/0003_married_cloak.sql`, journal entry, and snapshot; verify sql contains `CREATE TYPE workout_plan_status` and `CREATE TABLE workout_plans`

### Phase 3.3: WorkoutPlanRepository
- [x] 3.3.1 RED: write `apps/api/src/db/repositories/__tests__/workout-plan.test.ts` — test `createGenerating` returns id+status, `markReady` persists JSON, `markFailed` persists error, `findLatestByPlanSpec` returns newest row, `findById` respects tenant scope (cross-tenant returns undefined)
- [x] 3.3.2 GREEN: create `apps/api/src/db/repositories/workout-plan.ts` — `WorkoutPlanRepository` with `createGenerating(tenantId,userId,planSpecId)`, `markReady(id,program)`, `markFailed(id,error)`, `findLatestByPlanSpec(tenantId,planSpecId)`, `findById(tenantId,id)` — all tenant-scoped

### Phase 3.4: PlanSpecRepository extension
- [x] 3.4.1 RED: add test to `apps/api/src/db/repositories/__tests__/plan-spec.test.ts` — `findConfirmedById` returns spec when confirmed, undefined when draft or cross-tenant
- [x] 3.4.2 GREEN: add `findConfirmedById(tenantId, id)` to `apps/api/src/db/repositories/plan-spec.ts`

### Phase 3.5: Commit
- [x] 3.5.1 Conventional commit: `feat(api/db): add workout_plans schema, migration, and repositories`

---

## PR 4 — AI port + prompt (no network; needs PR1, PR2)

### Phase 4.1: PlanGenerator port
- [x] 4.1.1 Create `apps/api/src/ai/port.ts` — `PlanGenerator` interface `{ generate(spec: PlanSpec): Promise<WorkoutProgram> }`; no external imports

### Phase 4.2: Prompt builder
- [x] 4.2.1 RED: write `apps/api/src/ai/__tests__/prompt.test.ts` — prompt contains goal, frequency, equipment; prompt contains explicit "do not diagnose" instruction; prompt includes limitations as context; prompt does not emit diagnostic patterns itself
- [x] 4.2.2 GREEN: create `apps/api/src/ai/prompt.ts` — `buildPlanPrompt(spec: PlanSpec): string`; pure, no imports from outside `@kinora/contracts`

### Phase 4.3: Redaction helper
- [x] 4.3.1 RED: write `apps/api/src/ai/__tests__/mask.test.ts` — `mask` replaces limitation text with `[REDACTED]`, handles empty limitations, handles multiple terms
- [x] 4.3.2 GREEN: create `apps/api/src/ai/mask.ts` — `mask(text: string, limitations: string[]): string`; pure, no network

### Phase 4.4: Mock generator
- [x] 4.4.1 Create `apps/api/src/ai/mock-generator.ts` — `MockPlanGenerator implements PlanGenerator`; returns a deterministic `WorkoutProgram` from spec without network; used by all route/service tests

### Phase 4.5: Commit
- [x] 4.5.1 Conventional commit: `feat(api/ai): add PlanGenerator port, prompt builder, mask helper, mock generator`

---

## PR 5 — OpenRouter adapter + Langfuse + secrets (needs PR4)

### Phase 5.1: Dependencies
- [x] 5.1.1 Add `@langchain/openai`, `@langchain/core`, `langfuse-langchain`, `zod` to `apps/api/package.json` via `pnpm add`; verify workspace hoisting does not conflict with `packages/contracts`

### Phase 5.2: OpenRouter adapter
- [x] 5.2.1 RED: write `apps/api/src/ai/__tests__/openrouter-generator.test.ts` — adapter constructable without `OPENROUTER_API_KEY` (no throw on import/construct); `mask` strips limitation text from trace input; SDK invoke path wired (mock `@langchain/openai`)
- [x] 5.2.2 GREEN: create `apps/api/src/ai/openrouter-generator.ts` — `OpenRouterPlanGenerator implements PlanGenerator`; `new ChatOpenAI({ apiKey, model, configuration: { baseURL: "https://openrouter.ai/api/v1", defaultHeaders: { "HTTP-Referer": ..., "X-Title": "kInorA" } } }).withStructuredOutput(WorkoutProgramSchema)`; Langfuse `CallbackHandler` wired via `callbacks` invoke config; `mask` applied to spec.limitations before Langfuse trace; no key required to construct (fails at call time)

### Phase 5.3: Env + secrets wiring
- [x] 5.3.1 Add `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_HOST` to `docker-compose.yml` under the `api` service (values from `.env`)
- [x] 5.3.2 Add the same vars to `.github/workflows/ci-cd.yml` deploy-payload step and secret-validation; confirm they are NOT added to the unit-test step
- [x] 5.3.3 Document required env vars in `apps/api/README.md` (or equivalent config doc); note `OPENROUTER_MODEL` MUST be a tool/function-calling capable model

### Phase 5.4: Commit
- [x] 5.4.1 Conventional commit: `feat(api/ai): add OpenRouter adapter, Langfuse tracing, secrets wiring`

---

## PR 6 — Generation service + API routes (needs PR3, PR4, PR5)

### Phase 6.1: Generation service
- [x] 6.1.1 RED: write `apps/api/src/ai/__tests__/generation-service.test.ts` — validates spec via `assertPlanSpecShape` (422 on invalid), creates `generating` row, returns planId without awaiting LLM, calls `markReady` on success, calls `markFailed` on LLM error; stuck-`generating` strategy: manual regenerate (no sweep — one failed row triggers a new `generating` row on explicit regenerate; stale rows remain visible); use `MockPlanGenerator`
- [x] 6.1.2 GREEN: create `apps/api/src/ai/generation-service.ts` — `PlanGenerationService` with `startGeneration(tenantId, userId, planSpecId)`: validate → createGenerating → fire-and-forget background task (buildPlanPrompt → generator.generate → applyEquipmentSubstitutions → injectLimitationWarnings → assertNoDiagnosticLanguage → markReady) catch → markFailed

### Phase 6.2: Route: confirm auto-trigger
- [x] 6.2.1 RED: add tests to `apps/api/src/routes/__tests__/plan-generation.test.ts` — `POST /plan-specs/:id/confirm` returns 200 with `{ planId, status: "generating" }`; 422 when spec incomplete; 401 unauthenticated; 404 cross-tenant
- [x] 6.2.2 GREEN: modify `apps/api/src/routes/plan.ts` — after confirming the spec, call `PlanGenerationService.startGeneration` and include `{ planId, status }` in response

### Phase 6.3: Route: regenerate
- [x] 6.3.1 RED: add test — `POST /plan-specs/:id/regenerate` returns 202 `{ planId, status: "generating" }`; prior row not deleted; 422 unconfirmed spec; 401; 404 cross-tenant
- [x] 6.3.2 GREEN: add `POST /plan-specs/:id/regenerate` handler in `apps/api/src/routes/plan.ts`; reuses `PlanGenerationService.startGeneration`

### Phase 6.4: Route: fetch plan
- [x] 6.4.1 RED: add test — `GET /workout-plans/:id` returns plan with status; 401; 404 cross-tenant; `GET /plan-specs/:id/workout-plan` returns latest plan for spec
- [x] 6.4.2 GREEN: add both read routes in `apps/api/src/routes/plan.ts`; use `WorkoutPlanRepository`

### Phase 6.5: DI wiring
- [x] 6.5.1 Wire `WorkoutPlanRepository`, `PlanGenerationService`, `OpenRouterPlanGenerator` into `apps/api/src/app.ts` DI block; keep `MockPlanGenerator` injectable for tests via env or factory arg

### Phase 6.6: Commit
- [x] 6.6.1 Conventional commit: `feat(api): add generation service, regenerate route, workout-plan read routes`

---

## PR 7a — WebSocket server (needs PR6)

### Phase 7a.1: WS plugin + registry
- [x] 7a.1.1 Add `@fastify/websocket` to `apps/api/package.json`
- [x] 7a.1.2 RED: write `apps/api/src/ws/__tests__/registry.test.ts` — `notify(userId, payload)` calls only the matching socket; cross-user/cross-tenant isolation; disconnected socket cleaned up
- [x] 7a.1.3 GREEN: create `apps/api/src/ws/registry.ts` — `WsRegistry` with `register(userId, socket)`, `unregister(userId, socket)`, `notify(userId, payload)` (in-memory `Map<userId, Set<socket>>`)

### Phase 7a.2: Authenticated WS endpoint
- [x] 7a.2.1 RED: add test `apps/api/src/routes/__tests__/ws.test.ts` — authenticated connection accepted; unauthenticated rejected; `ready`/`failed` event payload shape `{ planId, status }`
- [x] 7a.2.2 GREEN: create `apps/api/src/routes/ws.ts` — Fastify WebSocket route `/ws/plans`; validates session/auth via `requireAuth` equivalent; registers socket in `WsRegistry`; unregisters on close
- [x] 7a.2.3 Register WebSocket plugin and route in `apps/api/src/app.ts`

### Phase 7a.3: Emit from generation service
- [x] 7a.3.1 Update `PlanGenerationService` to accept `WsRegistry` and call `registry.notify(userId, { planId, status })` after `markReady` and `markFailed`
- [x] 7a.3.2 Add test assertion: service calls `registry.notify` with correct userId and status on both success and failure

### Phase 7a.4: Commit
- [x] 7a.4.1 Conventional commit: `feat(api/ws): add WebSocket registry and authenticated plan-status endpoint`

---

## PR 7b — Web UX (needs PR6, PR7a)

### Phase 7b.1: Generate action on confirm path
- [ ] 7b.1.1 RED: write/extend `apps/web/src/app/(app)/create-plan/__tests__/confirm.test.tsx` — confirm response includes `{ planId, status: "generating" }`, redirects to plan view with status param
- [ ] 7b.1.2 GREEN: update server action / fetch in confirm step to consume `planId` and `status` from confirm response; navigate to plan view

### Phase 7b.2: Regenerate action
- [ ] 7b.2.1 RED: write `apps/web/src/app/(app)/create-plan/__tests__/regenerate.test.tsx` — regenerate button calls `POST /plan-specs/:id/regenerate`, sets local status to `generating`
- [ ] 7b.2.2 GREEN: add `regeneratePlan(specId)` server action or client fetch; wire to "Regenerate" button in plan view

### Phase 7b.3: Plan status UI
- [ ] 7b.3.1 Create `apps/web/src/app/(app)/plan/[id]/page.tsx` (or extend existing) — renders `generating` spinner, `ready` plan detail, `failed` error+regenerate CTA; uses `WorkoutProgram` type from `@kinora/contracts`
- [ ] 7b.3.2 RED: write `apps/web/src/app/(app)/plan/__tests__/plan-status.test.tsx` — spinner when generating, content when ready, error+CTA when failed; status-fetch fallback renders correctly when WS not connected

### Phase 7b.4: WebSocket subscribe
- [ ] 7b.4.1 RED: write `apps/web/src/hooks/__tests__/use-plan-ws.test.ts` — hook subscribes to `/ws/plans`, updates status on `{ planId, status }` message, handles disconnect/reconnect, skips messages for other planIds
- [ ] 7b.4.2 GREEN: create `apps/web/src/hooks/use-plan-ws.ts` — custom hook opening WS with session credential, dispatching status updates; falls back to `GET /workout-plans/:id` poll on connect failure

### Phase 7b.5: Wire hook into plan page
- [ ] 7b.5.1 Integrate `usePlanWs(planId)` into plan status page; merge WS-pushed status with server-fetched initial state
- [ ] 7b.5.2 GREEN: confirm component test passes with hook mock

### Phase 7b.6: Commit
- [ ] 7b.6.1 Conventional commit: `feat(web): add plan status UI, WebSocket subscribe, regenerate action`

---

## Cross-Cutting Notes

- Stuck-`generating` strategy (PR6 decision): **manual regenerate only**. A stale `generating` row does not auto-sweep. The user sees status `generating` indefinitely until they trigger regenerate (which creates a fresh `generating` row). The failed/stale row is retained for audit. Document this in route handler comments.
- `.withStructuredOutput` method (`jsonSchema` vs `function_calling`): verify at apply time against `OPENROUTER_MODEL`; fallback to `method: "jsonSchema"` if function-calling unavailable. Record the decision in PR5 commit message.
- No live `OPENROUTER_*` or `LANGFUSE_*` keys in unit-test CI steps — all tests use `MockPlanGenerator` or mocked SDK.
- Each PR must: compile cleanly (`pnpm build` or `tsc --noEmit`), all existing + new tests green, no new `deps-guard`/`architecture` violations.
