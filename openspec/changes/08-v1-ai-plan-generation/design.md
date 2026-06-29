# Design: 08 — AI Plan Generation

## Technical Approach

Add the LLM stack from zero behind a hexagonal `PlanGenerator` port. The LangChain/OpenRouter/Langfuse adapter lives ONLY in `apps/api/src/ai/` (infrastructure). OpenRouter is the LLM gateway for v1 — no direct provider integration. Pure rules (equipment substitution, limitation-warning shaping, prompt building, diagnostic guard) stay in `@kinora/domain` / `apps/api/src/ai/*` with NO network imports. Confirm and regenerate create a `generating` `workout_plans` row, return immediately, and schedule in-process background generation that flips status to `ready|failed`. The owner is notified over an authenticated WebSocket. Implements spec requirements: Plan Generation, Async Lifecycle, Auto-Trigger + Regenerate, WebSocket status, Safe Substitutions.

## Architecture Constraints (AGENTS.md / 04-v1-ai-operation)

| Constraint | Enforcement |
|---|---|
| Clean layering — domain forbids network/runtime deps | LangChain/OpenRouter/Langfuse confined to `apps/api/src/ai/`; domain holds only pure functions; `pnpm deps-guard`/`architecture` must pass |
| Never log health data (AGENTS.md:72) | `PlanSpec.limitations` masked before Langfuse via `mask`; never logged unmasked anywhere |
| Strict TDD; no live LLM in CI | `PlanGenerator` mock-injectable; Langfuse NO-OP when env unset |

## Architecture Decisions

| Decision | Choice | Rejected | Rationale |
|---|---|---|---|
| LLM gateway | OpenRouter via LangChain `ChatOpenAI` (OpenAI-compatible) behind `PlanGenerator` port | Direct `ChatAnthropic` / `@anthropic-ai/sdk` | No commitment to a single provider now; OpenRouter routes/bills; swappable later behind the same port |
| Structured output | `.withStructuredOutput(WorkoutProgramSchema)` | Raw JSON parse | Zod-validated. NOTE: chosen OpenRouter model MUST support tool/function-calling or JSON-schema output; `.withStructuredOutput` may need `method: "jsonSchema"` or function-calling per model — verify at apply time |
| Model | `OPENROUTER_MODEL` env, REQUIRED/configurable (OpenRouter `provider/model` id namespace) | Hardcoded Anthropic default | Whole point is NOT committing to Anthropic; model chosen via env at deploy time |
| Observability | `langfuse-langchain` `CallbackHandler` via `callbacks` invoke config | Custom logging | Standard tracing; NO-OP when keys unset (dev/CI safe) |
| Trace redaction | Langfuse `mask` strips limitation text from inputs/outputs | Trace raw | Limitations are health data; only model, tokens, latency, cost, status, redacted prompt/plan are traced |
| Async execution | In-process fire-and-forget with error capture → `markFailed` | Job runner (BullMQ) | v1 single-node; no queue infra. Trade-off: lost on restart → stuck `generating` swept by timeout/manual regenerate |
| Real-time status | `@fastify/websocket`, per-user in-memory registry | SSE / polling | Spec mandates WebSocket; registry scales to single node (documented limit) |
| Storage | JSONB `program_json` typed by `WorkoutProgram` contract | Normalized tables | Avoids premature normalization; 09a reads session/exercise/planned-set from JSON |

## Data Flow

    confirm/regenerate ──→ assertPlanSpecShape ──→ repo.createGenerating ──→ 201 {planId,generating}
                                                          │ (fire-and-forget)
                                                          ▼
       buildPlanPrompt(spec) ─→ PlanGenerator.generate ─→ withStructuredOutput(Zod)
                                          │ (Langfuse callback + mask)
                                          ▼
       applyEquipmentSubstitutions + injectLimitationWarnings + assertNoDiagnosticLanguage
                                          │
                  ┌── ok → markReady(program) ──┐    └── error → markFailed(error)
                  ▼                              ▼
            wsRegistry.notify(userId, {planId, status})  ← owner-only, tenant-scoped

## File Changes

| File | Action | Description |
|---|---|---|
| `packages/contracts/src/index.ts` | Modify | `WorkoutProgram`, `WorkoutSession`, `WorkoutExercise`, `WorkoutPlanStatus` |
| `packages/domain/src/plan/{equipment-substitution,limitation-warnings}.ts` | Create | Pure functions; re-export from `index.ts` |
| `apps/api/src/ai/{port,openrouter-generator,prompt,schema,guard}.ts` | Create | `PlanGenerator` port, OpenRouter (`ChatOpenAI`) adapter, `buildPlanPrompt`, Zod `WorkoutProgramSchema`, `assertNoDiagnosticLanguage` |
| `apps/api/src/db/schema.ts` + `drizzle/0003_*` | Modify/Create | `workout_plans` table + `workout_plan_status` enum; `db:generate` |
| `apps/api/src/db/repositories/{workout-plan,plan-spec}.ts` | Create/Modify | `WorkoutPlanRepository`; `findConfirmedById` |
| `apps/api/src/ws/registry.ts` + `apps/api/src/routes/{plan,ws}.ts` + `app.ts` | Create/Modify | WS registry, regenerate route, WS endpoint, DI wiring |
| `docker-compose.yml`, `.github/workflows/ci-cd.yml` | Modify | `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `LANGFUSE_*` (not in unit-test step) |
| `apps/web/src/app/(app)/create-plan/*` + plan view | Modify | regenerate action/client, WS subscribe, status UI + fetch fallback |

## Interfaces / Contracts

```ts
// @kinora/contracts
export type WorkoutPlanStatus = "generating" | "ready" | "failed";
export interface WorkoutExercise {
  name: string; sets: number; reps: string; restSeconds: number;
  notes?: string; substitutionNote?: string;
}
export interface WorkoutSession { day: number; title: string; exercises: WorkoutExercise[]; }
export interface WorkoutProgram {
  weeklySessions: WorkoutSession[];      // length = daysPerWeek
  limitationWarnings: string[];
}
// apps/api/src/ai/port.ts (unchanged by the OpenRouter switch)
export interface PlanGenerator { generate(spec: PlanSpec): Promise<WorkoutProgram>; }
```

OpenRouter adapter (`openrouter-generator.ts`):

```ts
new ChatOpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  model: process.env.OPENROUTER_MODEL,
  configuration: {
    baseURL: "https://openrouter.ai/api/v1",
    defaultHeaders: { "HTTP-Referer": <app url>, "X-Title": "kInorA" },
  },
}).withStructuredOutput(WorkoutProgramSchema)
```

Constructable without `OPENROUTER_API_KEY` — fails only at call time (CI/unit-test safe).

`WorkoutProgramSchema` (Zod) mirrors the above for `.withStructuredOutput`. Forward-compatible with 09a: `sets`/`reps`/`restSeconds` already express planned sets per exercise/session.

`WorkoutPlanRepository`: `createGenerating`, `markReady`, `markFailed`, `findLatestByPlanSpec`, `findById` — all tenant+user scoped.

## Testing Strategy

| Layer | What | Approach |
|---|---|---|
| Unit | prompt forbids diagnostics; substitutions; warnings; mask removes limitations; diagnostic guard rejects | Pure-fn, no mock |
| Route | 422 incomplete before LLM, 401, 404 cross-tenant, async→generating | Mock DB + mock `PlanGenerator` |
| Repo | tenant isolation; status transitions | Mock DB |
| WS | only owner notified (cross-user, cross-tenant) | In-memory registry |
| E2E | confirm→generating→ready | `scripts/e2e-with-stack.mjs`, PlanGenerator mocked (no live LLM/Langfuse) |

No `OPENROUTER_*`/`LANGFUSE_*` keys required for unit tests/CI.

## Migration / Rollout

`db:generate` (drizzle-kit) → commit sql + journal + snapshot. Foundation-first chained PRs: PR1 contract+domain+storage; PR2 api LLM adapter (OpenRouter)+async+Langfuse; PR3 WebSocket + web UX. New deps: `@langchain/openai`, `@langchain/core`, `langfuse-langchain`, `@fastify/websocket`, `zod`.

**Provider switch note**: moving from direct-Anthropic to OpenRouter was a localized adapter + config change (one adapter file + env names) thanks to the `PlanGenerator` port — NO domain, route, or contract changes. This is exactly the localized swap the port was designed to absorb. The `claude-api` reference is now relevant only if the chosen `OPENROUTER_MODEL` happens to be a Claude model.

## Risks

| Risk | Mitigation |
|---|---|
| OpenRouter is an external gateway dependency / SPOF | Async lifecycle already isolates failures → `markFailed`; status surfaced to user; retry via regenerate |
| Structured-output support varies per OpenRouter model | Require a tool/function-calling or JSON-schema-capable model; verify `.withStructuredOutput` method at apply time; parser/guard rejects malformed output → `failed` |
| Model availability / id churn on OpenRouter | `OPENROUTER_MODEL` env, chosen at deploy time; no hardcoded default |
| Cost / routing | Delegated to OpenRouter (its routing + billing) |

## Open Questions

- [ ] Stuck-`generating` sweep interval (timeout sweep vs manual regenerate only) — decide in tasks.
- [ ] Confirm `.withStructuredOutput` mode (`jsonSchema` vs function-calling) for the chosen `OPENROUTER_MODEL` at apply time.
