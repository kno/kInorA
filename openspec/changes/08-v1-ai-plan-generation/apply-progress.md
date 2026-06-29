# Apply Progress: 08-v1-ai-plan-generation

**Batch**: 2 of N (PR 1 — Contract + PR 2 — Domain pure functions)
**Branch (PR2)**: feat/08-plan-gen-pr2-domain
**Mode**: Strict TDD
**Date**: 2026-06-29

---

## Completed Tasks (PR 1)

- [x] 1.1.1 Add `WorkoutPlanStatus`, `WorkoutExercise`, `WorkoutSession`, `WorkoutProgram` to `packages/contracts/src/index.ts`
- [x] 1.2.1 Create `packages/contracts/src/workout-program.schema.ts` exporting `WorkoutProgramSchema` (Zod) mirroring the TS types; include `limitationWarnings` array
- [x] 1.3.1 RED: wrote `packages/contracts/src/__tests__/workout-program.test.ts` — 12 test cases asserting types and schema behaviour
- [x] 1.3.2 GREEN: all 25 tests pass (13 baseline + 12 new)
- [x] 1.3.3 Re-export `WorkoutProgramSchema` from `packages/contracts/src/index.ts`
- [x] 1.4.1 Conventional commit: `feat(contracts): add WorkoutProgram types and Zod schema` (c4b8748)

---

## Completed Tasks (PR 2)

- [x] 2.1.1 RED: wrote `packages/domain/src/plan/__tests__/equipment-substitution.test.ts` — 9 test cases (no-op when equipment available, bodyweight substitution map, substitution note recorded, multi-session, pure fn, edge cases)
- [x] 2.1.2 GREEN: created `packages/domain/src/plan/equipment-substitution.ts` — `applyEquipmentSubstitutions(program, equipment): WorkoutProgram`; pure, no network imports
- [x] 2.1.3 REFACTOR: `SUBSTITUTION_MAP` extracted as a data constant in the same file (done as part of initial implementation)
- [x] 2.2.1 RED: wrote `packages/domain/src/plan/__tests__/limitation-warnings.test.ts` — 9 test cases (appends warnings, professional advisory language, multiple limitations, no hard-block, no duplicate warnings, pure fn)
- [x] 2.2.2 GREEN: created `packages/domain/src/plan/limitation-warnings.ts` — `injectLimitationWarnings(program, limitations): WorkoutProgram`; pure
- [x] 2.3.1 RED: wrote `packages/domain/src/plan/__tests__/diagnostic-guard.test.ts` — 10 test cases (clean programs pass, diagnostic patterns rejected from notes/titles/warnings/substitutionNotes, case-insensitive, error message quality)
- [x] 2.3.2 GREEN: created `packages/domain/src/plan/diagnostic-guard.ts` — `assertNoDiagnosticLanguage(program): void | throws`; pure, no network
- [x] 2.4.1 Exported all three functions from `packages/domain/src/plan/index.ts` and `packages/domain/src/index.ts` (`.js` extension — NodeNext)
- [x] 2.4.2 Conventional commit: `feat(domain): add equipment substitution, limitation warnings, diagnostic guard` (82aba2f)

---

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1.1–1.3.3 | `packages/contracts/src/__tests__/workout-program.test.ts` | Unit | ✅ 13/13 | ✅ Written | ✅ 25/25 | ✅ 6 cases | ➖ None needed |
| 2.1.1–2.1.3 | `packages/domain/src/plan/__tests__/equipment-substitution.test.ts` | Unit | ✅ 39/39 | ✅ Written (cannot resolve module) | ✅ 9/9 | ✅ multi-session, edge cases, no-op path | ✅ SUBSTITUTION_MAP extracted |
| 2.2.1–2.2.2 | `packages/domain/src/plan/__tests__/limitation-warnings.test.ts` | Unit | ✅ 39/39 | ✅ Written (cannot resolve module) | ✅ 9/9 | ✅ multiple limitations, dedup, empty | ➖ None needed |
| 2.3.1–2.3.2 | `packages/domain/src/plan/__tests__/diagnostic-guard.test.ts` | Unit | ✅ 39/39 | ✅ Written (cannot resolve module) | ✅ 10/10 | ✅ case-insensitive, all string fields, error message | ➖ None needed |

### Test Summary

- **Total tests written (PR2)**: 28 (9 + 9 + 10)
- **Total tests passing**: 67 domain (7 files) — 39 baseline + 28 new
- **Layers used**: Unit (28)
- **Approval tests** (refactoring): None — no pre-existing files modified
- **Pure functions created**: 3 (`applyEquipmentSubstitutions`, `injectLimitationWarnings`, `assertNoDiagnosticLanguage`)

---

## Files Changed (PR 2)

| File | Action | Description |
|------|--------|-------------|
| `packages/domain/src/plan/equipment-substitution.ts` | Created | `applyEquipmentSubstitutions` + `SUBSTITUTION_MAP` constant |
| `packages/domain/src/plan/limitation-warnings.ts` | Created | `injectLimitationWarnings` with dedup logic |
| `packages/domain/src/plan/diagnostic-guard.ts` | Created | `assertNoDiagnosticLanguage` with 18 diagnostic patterns |
| `packages/domain/src/plan/index.ts` | Modified | Added `.js` re-exports for all three new functions |
| `packages/domain/src/index.ts` | Modified | Added `.js` re-exports for all three new functions |
| `packages/domain/src/plan/__tests__/equipment-substitution.test.ts` | Created | 9 unit tests |
| `packages/domain/src/plan/__tests__/limitation-warnings.test.ts` | Created | 9 unit tests |
| `packages/domain/src/plan/__tests__/diagnostic-guard.test.ts` | Created | 10 unit tests |

---

## Verification Results (PR 2)

```
pnpm --filter @kinora/domain test
 Test Files  7 passed (7)
      Tests  67 passed (67)
   Duration  554ms
```

```
pnpm --filter @kinora/domain build
(exit 0 — NodeNext tsconfig.build.json clean)
```

```
pnpm type-check (repo-wide, 5 packages)
(exit 0 — clean; fixed noUncheckedIndexedAccess in test files)
```

```
pnpm architecture
✔ no dependency violations found (738 modules, 1972 dependencies cruised)
✅ Architecture negative guard passed
```

---

## Deviations from Design

None. All functions are pure, domain-only, no network/runtime/db imports. `.js` extensions used on all barrel re-exports per NodeNext requirement. `SUBSTITUTION_MAP` was extracted inline with initial implementation rather than as a second refactor step — same end result.

---

## Workload / PR Boundary

- PR 2 branch: `feat/08-plan-gen-pr2-domain`
- PR: https://github.com/kno/kInorA/pull/35
- Strategy: stacked-to-main
- Base: main (PR1 already merged)
- Estimated review budget: ~350 changed lines — within 400-line budget

---

## Completed Tasks (PR 3)

- [x] 3.1.1 RED: wrote `apps/api/src/db/__tests__/workout-plan-schema.test.ts` — 14 tests (enum values × 4, table def × 1, columns × 9)
- [x] 3.1.2 GREEN: added `workoutPlanStatusEnum` pgEnum + `workoutPlans` table to `apps/api/src/db/schema.ts`
- [x] 3.2.1 Ran `pnpm db:generate` — committed `drizzle/0003_married_cloak.sql`, `drizzle/meta/_journal.json`, `drizzle/meta/0003_snapshot.json`; sql verified to contain `CREATE TYPE workout_plan_status` and `CREATE TABLE workout_plans`
- [x] 3.3.1 RED: wrote `apps/api/src/db/repositories/__tests__/workout-plan.test.ts` — 11 tests (createGenerating × 2, markReady × 2, markFailed × 2, findLatestByPlanSpec × 3, findById × 2)
- [x] 3.3.2 GREEN: created `apps/api/src/db/repositories/workout-plan.ts` — `WorkoutPlanRepository` with all 5 tenant-scoped methods
- [x] 3.4.1 RED: added 3 tests to `apps/api/src/db/repositories/__tests__/plan-spec.test.ts` for `findConfirmedById` (confirmed → returns, draft → undefined, cross-tenant → undefined)
- [x] 3.4.2 GREEN: added `findConfirmedById(tenantId, id)` to `apps/api/src/db/repositories/plan-spec.ts`
- [x] 3.5.1 Conventional commit: `feat(api/db): add workout_plans schema, migration, and repositories` (e36d23d)

---

## TDD Cycle Evidence (PR 3)

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 3.1.1–3.1.2 | `apps/api/src/db/__tests__/workout-plan-schema.test.ts` | Unit | ✅ 258/258 | ✅ Written (import fail) | ✅ 272/272 | ✅ 4 enum + 9 column cases | ➖ None needed |
| 3.3.1–3.3.2 | `apps/api/src/db/repositories/__tests__/workout-plan.test.ts` | Unit | N/A (new) | ✅ Written (module not found) | ✅ 286/286 | ✅ createGenerating × 2, markReady × 2, markFailed × 2, findLatestByPlanSpec (newest + empty + cross-tenant), findById (own + cross-tenant) | ➖ None needed |
| 3.4.1–3.4.2 | `apps/api/src/db/repositories/__tests__/plan-spec.test.ts` | Unit | ✅ 3/3 | ✅ Written (method not found) | ✅ 6/6 | ✅ confirmed + draft + cross-tenant | ➖ None needed |

### Test Summary (PR 3)

- **Total tests written**: 28 (14 schema + 11 repo + 3 plan-spec extension)
- **Total tests passing**: 286 (api package), up from 258 baseline
- **Layers used**: Unit (28)
- **Approval tests**: None — existing plan-spec tests were safety-net checked and remained green
- **Pure functions created**: 0 — repository methods; mock-DB pattern used for unit tests

---

## Files Changed (PR 3)

| File | Action | Description |
|------|--------|-------------|
| `apps/api/src/db/schema.ts` | Modified | Added `workoutPlanStatusEnum` pgEnum and `workoutPlans` table |
| `apps/api/drizzle/0003_married_cloak.sql` | Created | Migration: CREATE TYPE + CREATE TABLE + FKs + index |
| `apps/api/drizzle/meta/_journal.json` | Modified | Journal entry for migration 0003 |
| `apps/api/drizzle/meta/0003_snapshot.json` | Created | Drizzle schema snapshot post-migration |
| `apps/api/src/db/repositories/workout-plan.ts` | Created | `WorkoutPlanRepository` with 5 tenant-scoped methods |
| `apps/api/src/db/repositories/plan-spec.ts` | Modified | Added `findConfirmedById(tenantId, id)` |
| `apps/api/src/db/__tests__/workout-plan-schema.test.ts` | Created | 14 unit tests for enum + table shape |
| `apps/api/src/db/repositories/__tests__/workout-plan.test.ts` | Created | 11 unit tests for repository methods |
| `apps/api/src/db/repositories/__tests__/plan-spec.test.ts` | Modified | +3 tests for `findConfirmedById` |

---

## Verification Results (PR 3)

```
pnpm --filter api test
 Test Files  24 passed (24)
      Tests  286 passed (286)
   Duration  1.86s
```

```
pnpm --filter api build
exit 0 (NodeNext tsconfig.build.json clean)
```

```
pnpm type-check (repo-wide)
exit 0 — clean
```

```
pnpm architecture
✔ no dependency violations found (741 modules, 1984 dependencies cruised)
✅ Architecture negative guard passed
```

```
pnpm push pre-push hook
✅ Coverage thresholds met. Push allowed.
```

---

## Post-Review Security Fixes (commit 18a3740, pushed to same PR branch)

### CRITICAL — markReady/markFailed tenant-scoped
- `markReady(tenantId, id, program)` — was `(id, program)`. WHERE: `and(eq(workoutPlans.tenantId, tenantId), eq(workoutPlans.id, id))`
- `markFailed(tenantId, id, errorMessage)` — was `(id, errorMessage)`. Same compound WHERE.
- Both now return `WorkoutPlanRecord | undefined` — undefined on tenant mismatch (0 rows).
- Added cross-tenant isolation tests for both: wrong tenant → `undefined`.

### MEDIUM — findLatestByPlanSpec DESC ordering proved
- Added test: asserts `orderBy` arg's `queryChunks` contain `" desc"` + result is the newer row.

### LOW — Orphaned JSDoc removed from plan-spec.ts
- Stale `/** Insert a confirmed plan_specs row … */` fragment removed; JSDoc restored to `create()`.

### Final verification (post-fix)
- `pnpm --filter api test`: 289 passed (24 files) — up from 286
- `pnpm --filter api build`: exit 0
- `pnpm type-check`: clean
- `pnpm architecture`: no violations
- Pre-push hook: coverage thresholds met

## PR 3

- Branch: `feat/08-plan-gen-pr3-storage`
- PR: https://github.com/kno/kInorA/pull/36
- Commits: e36d23d (initial), 18a3740 (security fix)
- Base: main (stacked-to-main)

---

## Completed Tasks (PR 4) — all [x]

- [x] 4.1.1 Created `apps/api/src/ai/port.ts` — `PlanGenerator` interface `{ generate(spec: PlanSpec): Promise<WorkoutProgram> }`; imports only from `@kinora/contracts`
- [x] 4.2.1 RED: wrote `apps/api/src/ai/__tests__/prompt.test.ts` — 14 tests (goal, frequency, equipment, location, duration, limitations, do-not-diagnose instruction, no diagnostic phrasing in prompt itself)
- [x] 4.2.2 GREEN: created `apps/api/src/ai/prompt.ts` — `buildPlanPrompt(spec: PlanSpec): string`; pure, only `@kinora/contracts` imports; explicit no-diagnose/no-medical-advice instruction
- [x] 4.3.1 RED: wrote `apps/api/src/ai/__tests__/mask.test.ts` — 8 tests (single term, multiple occurrences, multiple terms, empty limitations no-op, no-match no-op, case sensitivity, empty text)
- [x] 4.3.2 GREEN: created `apps/api/src/ai/mask.ts` — `mask(text, limitations): string`; pure, literal string replacement via split/join
- [x] 4.4.1 Created `apps/api/src/ai/mock-generator.ts` — `MockPlanGenerator implements PlanGenerator`; deterministic; `weeklySessions.length === daysPerWeek`; no network; 9 tests in `__tests__/mock-generator.test.ts`
- [x] 4.5.1 Conventional commit: `feat(api/ai): add PlanGenerator port, prompt builder, mask helper, mock generator` (163e728)

---

## TDD Cycle Evidence (PR 4)

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 4.1.1 | N/A (interface only) | Unit | N/A (new file) | Triangulation skipped: purely structural, single interface, no logic | — | — | — |
| 4.2.1–4.2.2 | `apps/api/src/ai/__tests__/prompt.test.ts` | Unit | N/A (new file) | ✅ Written (module not found) | ✅ 14/14 (fixed diagnostic example in prompt text) | ✅ goal/freq/equipment/location/duration/limitations/no-diagnose/self-clean | ➖ None needed |
| 4.3.1–4.3.2 | `apps/api/src/ai/__tests__/mask.test.ts` | Unit | N/A (new file) | ✅ Written (module not found) | ✅ 8/8 | ✅ single term, multiple occurrences, multiple terms, no-op, no-match, case, empty | ➖ None needed |
| 4.4.1 | `apps/api/src/ai/__tests__/mock-generator.test.ts` | Unit | N/A (new file) | ✅ Written (module not found) | ✅ 9/9 | ✅ daysPerWeek=3/4/6, two instances, output shape, timing | ➖ None needed |

### Test Summary (PR 4)

- **Total tests written**: 31 (14 prompt + 8 mask + 9 mock-generator)
- **Total tests passing**: 320 (api package, 27 files), up from 289 baseline
- **Layers used**: Unit (31)
- **Approval tests**: None — no existing files modified
- **Pure functions created**: 2 (`buildPlanPrompt`, `mask`) + 1 class (`MockPlanGenerator`)

---

## Files Changed (PR 4)

| File | Action | Description |
|------|--------|-------------|
| `apps/api/src/ai/port.ts` | Created | `PlanGenerator` hexagonal interface |
| `apps/api/src/ai/prompt.ts` | Created | `buildPlanPrompt` pure function |
| `apps/api/src/ai/mask.ts` | Created | `mask` pure function |
| `apps/api/src/ai/mock-generator.ts` | Created | `MockPlanGenerator implements PlanGenerator` |
| `apps/api/src/ai/__tests__/prompt.test.ts` | Created | 14 unit tests |
| `apps/api/src/ai/__tests__/mask.test.ts` | Created | 8 unit tests |
| `apps/api/src/ai/__tests__/mock-generator.test.ts` | Created | 9 unit tests |

---

## Verification Results (PR 4)

```
pnpm --filter api test
 Test Files  27 passed (27)
      Tests  320 passed (320)
   Duration  2.29s
```

```
pnpm --filter api build
exit 0 (tsc clean)
```

```
pnpm type-check (repo-wide)
exit 0 — clean
```

```
pnpm architecture
✔ no dependency violations found (748 modules, 1996 dependencies cruised)
✅ Architecture negative guard passed
```

```
pnpm push pre-push hook
✅ Coverage thresholds met. Push allowed.
```

## PR 4

- Branch: `feat/08-plan-gen-pr4-ai-port`
- PR: https://github.com/kno/kInorA/pull/37
- Commits: 163e728 (initial), 7209221 (review fixes)
- Base: main (stacked-to-main)
- Status: open, review fixes pushed — awaiting re-review

---

## PR4 Review Fixes Applied (commit 7209221)

### Fix A (HIGH 2) — mask: regex-special-char regression test
- Added test locking in split/join behavior for terms with `(`, `)`, `-` special chars
- A RegExp-based refactor would break this test

### Fix B (MEDIUM 1) — mask: empty-string term guard
- Added `if (term.length === 0) continue` in mask.ts
- Added 2 tests: `mask("abc", [""])` → `"abc"`; mixed `["", "lower back pain"]` still redacts

### Fix C (MEDIUM 2) — prompt: preferenceScores included
- Added `Training emphasis (0–1 weights): strength=…, hypertrophy=…, endurance=…, mobility=…` line
- Added 2 tests asserting all four score values appear in the prompt

### Fix D (LOW) — mock: day-numbering tests
- Added 3 tests: first session day=1, sequential 1..4 (4-day), sequential 1..3 (3-day)

### Fix E (LOW) — prompt label simplified
- Removed redundant "(treat as background context only, NOT as diagnoses)" from limitations label
- All 16 prompt tests green

### Fix F (HIGH 1) — KEEP `limitationWarnings: []` — decision recorded
- Design.md data-flow: `generate()` → `injectLimitationWarnings` (domain, runs downstream in PR6)
- Mock returning `[]` is correct — pre-populating would duplicate warnings in PR6 pipeline tests
- Added explanatory comment to mock-generator.ts at return site

### Final verification (post-fixes)
- `pnpm --filter api test`: 328 passed (27 files, +8 new tests)
- `pnpm --filter api build`: exit 0
- `pnpm type-check`: clean
- `pnpm architecture`: 748 modules, 0 violations
- Pre-push hook: coverage thresholds met

---

## Completed Tasks (PR 5) — all [x]

- [x] 5.1.1 Added `@langchain/openai@1.5.3`, `@langchain/core@1.2.1`, `langfuse-langchain@3.38.20`, `zod@4.4.3` to `apps/api/package.json` via `pnpm add`; `pnpm-lock.yaml` regenerated and committed
- [x] 5.2.1 RED: wrote `apps/api/src/ai/__tests__/openrouter-generator.test.ts` — 11 tests (construction without key, ChatOpenAI base URL, X-Title header, withStructuredOutput called, mask strips limitation text from invoke arg, Langfuse handler wired to callbacks, generate returns WorkoutProgram, error propagation)
- [x] 5.2.2 GREEN: created `apps/api/src/ai/openrouter-generator.ts` — `OpenRouterPlanGenerator implements PlanGenerator`; `method: "jsonSchema"` chosen for withStructuredOutput (broadest OpenRouter model compatibility); mask applied before invoke; constructor does not throw without key
- [x] 5.3.1 Added `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_HOST` to `docker-compose.yml` under api service environment
- [x] 5.3.2 Added same 5 vars to `.github/workflows/ci-cd.yml` deploy job env block + Validate required secrets gate; confirmed NOT in ci (unit-test/build) job
- [x] 5.3.3 Created `apps/api/README.md` documenting all env vars; notes `OPENROUTER_MODEL` must support JSON-schema structured output
- [x] 5.4.1 Conventional commit: `feat(api/ai): add OpenRouter adapter, Langfuse tracing, secrets wiring` (cec3885)

## TDD Cycle Evidence (PR 5)

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 5.2.1–5.2.2 | `apps/api/src/ai/__tests__/openrouter-generator.test.ts` | Unit | ✅ 328/328 | ✅ Written (module not found) | ✅ 11/11 | ✅ construction w/o key + w/key, base URL, header, mask with and without limitations, callback wiring, generate, error | ➖ None needed |

### Test Summary (PR 5)

- **Total tests written**: 11
- **Total tests passing**: 339 (api package, 28 files), up from 328 baseline
- **Layers used**: Unit (11)
- **Approval tests**: None — new file only
- **Pure functions created**: 0 (class; generate() is impure by design — calls LLM)

## Files Changed (PR 5)

| File | Action | Description |
|------|--------|-------------|
| `apps/api/package.json` | Modified | Added `@langchain/openai`, `@langchain/core`, `langfuse-langchain`, `zod` |
| `pnpm-lock.yaml` | Modified | Lockfile regenerated |
| `apps/api/src/ai/openrouter-generator.ts` | Created | `OpenRouterPlanGenerator implements PlanGenerator`; method: "jsonSchema" |
| `apps/api/src/ai/__tests__/openrouter-generator.test.ts` | Created | 11 unit tests (mocked @langchain/openai) |
| `docker-compose.yml` | Modified | Added 5 LLM/observability env vars to api service |
| `.github/workflows/ci-cd.yml` | Modified | Added 5 vars to deploy job only (NOT in ci test job) |
| `.env.example` | Modified | Added 5 vars with placeholder values and comments |
| `apps/api/README.md` | Created | API env var documentation |

## Verification Results (PR 5)

```
pnpm --filter api test
 Test Files  28 passed (28)
      Tests  339 passed (339)
   Duration  2.00s
```

```
pnpm --filter api build
exit 0 (tsc clean)
```

```
pnpm type-check (repo-wide)
exit 0 — clean
```

```
pnpm architecture
✔ no dependency violations found (1304 modules, 3614 dependencies cruised)
✅ Architecture negative guard passed
```

```
pnpm push pre-push hook
✅ Coverage thresholds met. Push allowed.
```

## PR 5

- Branch: `feat/08-plan-gen-pr5-openrouter`
- PR: https://github.com/kno/kInorA/pull/38
- Commits: cec3885
- Base: main (stacked-to-main)
- Status: open, awaiting review — do NOT merge until prod secrets configured

## withStructuredOutput Method Decision

**Chosen: `method: "jsonSchema"`**

Rationale: OpenRouter routes across many providers and not all support the tool/function-calling protocol (`"functionCalling"`). JSON-schema mode has the broadest model compatibility on OpenRouter while still producing Zod-validated, type-safe output via LangChain's `.withStructuredOutput`. The chosen `OPENROUTER_MODEL` must still support JSON-schema-mode structured output (documented in README and .env.example).

---

## Completed Tasks (PR 6) — all [x]

- [x] 6.1.1 RED: wrote `apps/api/src/ai/__tests__/generation-service.test.ts` — 9 tests (422 on invalid/unconfirmed spec, no generator call before validation, invalid spec shape throws, returns planId without awaiting LLM, createGenerating args, markReady on success with tenantId+planId+program, markFailed on generator throw with tenantId+planId+message, diagnostic guard → markFailed not markReady, no unhandledRejection when markFailed itself throws)
- [x] 6.1.2 GREEN: created `apps/api/src/ai/generation-service.ts` — `PlanGenerationService.startGeneration(tenantId, userId, planSpecId)`: findConfirmedById → assertPlanSpecShape → createGenerating → fire-and-forget runGenerationTask (buildPlanPrompt → generate → applyEquipmentSubstitutions → injectLimitationWarnings → assertNoDiagnosticLanguage → markReady); catch → markFailed; markFailed errors swallowed; stuck-generating comment documented
- [x] 6.2.1 RED: wrote `apps/api/src/routes/__tests__/plan-generation.test.ts` — confirm route tests (200 happy; 422 incomplete; 401 unauthenticated; 404 cross-tenant; startGeneration called with authContext tenantId+userId)
- [x] 6.2.2 GREEN: added `POST /plan-specs/:id/confirm` handler to `apps/api/src/routes/plan.ts`; extends `PlanRoutesOptions` with `generationService?`, `planRepo?`, `specRepo?` injection points; returns 200 { planId, status: "generating" }
- [x] 6.3.1 RED: wrote regenerate route tests in `plan-generation.test.ts` — 202 happy; 422 unconfirmed; 401; 404 cross-tenant; reuses startGeneration with authContext args
- [x] 6.3.2 GREEN: added `POST /plan-specs/:id/regenerate` handler; returns 202 { planId, status: "generating" }; prior row NOT deleted; stuck-generating comment present
- [x] 6.4.1 RED: wrote fetch route tests — `GET /workout-plans/:id` (200 with plan; 401; 404 cross-tenant; findById called with tenantId) and `GET /plan-specs/:id/workout-plan` (200 latest plan; 401; 404; findLatestByPlanSpec called with tenantId)
- [x] 6.4.2 GREEN: added both read routes to `apps/api/src/routes/plan.ts`; use WorkoutPlanRepository.findById / findLatestByPlanSpec (tenant-scoped)
- [x] 6.5.1 Wired `WorkoutPlanRepository`, `PlanGenerationService`, `OpenRouterPlanGenerator` into `apps/api/src/app.ts` DI block; backward-compatible with legacy 2-arg `buildApp(db?, socialAuthService?)` signature; `BuildAppOptions` type added with `planGenerator?` override for tests; OpenRouter constructed lazily (no key required at build time)
- [x] 6.6.1 Conventional commit: `feat(api): add generation service, regenerate route, workout-plan read routes` (a11f562)

## TDD Cycle Evidence (PR 6)

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 6.1.1–6.1.2 | `apps/api/src/ai/__tests__/generation-service.test.ts` | Unit | ✅ 341/341 | ✅ Written (module not found) | ✅ 9/9 | ✅ missing spec + invalid shape + slow generator + markReady + markFailed + diagnostic guard + double-catch | ➖ None needed |
| 6.2.1–6.2.2 | `apps/api/src/routes/__tests__/plan-generation.test.ts` | Integration | N/A (new file) | ✅ Written (routes missing → 14 fail) | ✅ 20/20 | ✅ confirm + regenerate + two fetch routes + 2 genuine cross-tenant GET tests | ➖ None needed |

### Test Summary (PR 6 — post-review-fixes)

- **Total tests written**: 29 (9 generation-service + 20 plan-generation routes)
- **Total tests passing**: 370 (30 files), up from 341 baseline (+29 net)
- **Layers used**: Unit (9), Integration (20)
- **Approval tests**: None — new files + non-breaking extension of plan.ts
- **Pure functions created**: 0 (service class; route handlers)

## PR6 Review Fixes (commit e971355)

### Fix 1 — robust buildApp discriminator
`"planGenerator" in opts` replaces fragile `!("select" in obj)` check.

### Fix 2 — generationService required at registration
`PlanRoutesOptions.generationService` changed from optional to required. Plugin throws at boot if missing. Per-request 503 guards removed. `plan.test.ts` passes `noopGenerationService`.

### Fix 3 — genuine cross-tenant GET tests
GET /workout-plans/:id and GET /plan-specs/:id/workout-plan each have a dedicated TENANT_B cross-tenant test that asserts (a) repo called with TENANT_B tenantId, (b) 404 returned.

### Fix 4 — symmetric assertions
Success test: `expect(markFailed).not.toHaveBeenCalled()`. Failure test: `expect(markReady).not.toHaveBeenCalled()`.

### Fix 5 — deterministic fake timers
All background-task tests use `vi.useFakeTimers()` + `vi.runAllTimersAsync()` instead of `setTimeout(r, 10)`.

### Fix 6 — removed dead buildPlanPrompt call
`buildPlanPrompt(spec)` and its import removed from `generation-service.ts`. The OpenRouter adapter builds the prompt internally.

### Fix 7 — 404 vs 422 status mapping
`PlanSpecNotFoundError` (statusCode=404) for missing/cross-tenant spec. `PlanSpecShapeError` (statusCode=422) for assertPlanSpecShape failure. Route tests use real error classes instead of manually-set statusCode fiction.

### Fix 8 — warn on stuck-generating risk
`markReady` / `markFailed` returning undefined (0 rows updated) triggers `console.warn` with planId + tenantId. No health data logged.

## Files Changed (PR 6)

| File | Action | Description |
|------|--------|-------------|
| `apps/api/src/ai/generation-service.ts` | Created | `PlanGenerationService` + `PlanSpecNotFoundError` + `PlanSpecShapeError` |
| `apps/api/src/ai/__tests__/generation-service.test.ts` | Created | 9 unit tests (fake timers, symmetric assertions) |
| `apps/api/src/routes/plan.ts` | Modified | Confirm/regenerate/fetch routes; generationService required |
| `apps/api/src/routes/__tests__/plan.test.ts` | Modified | Added noopGenerationService to buildTestApp |
| `apps/api/src/routes/__tests__/plan-generation.test.ts` | Created | 20 integration tests (incl. 2 genuine cross-tenant) |
| `apps/api/src/app.ts` | Modified | DI wiring: WorkoutPlanRepository, PlanGenerationService, OpenRouterPlanGenerator; BuildAppOptions |

## Verification Results (PR 6)

```
pnpm --filter api test
 Test Files  30 passed (30)
      Tests  368 passed (368)
   Duration  2.77s
```

```
pnpm deps-guard
✅ Dependency guard passed — no prohibited packages found.
```

```
pnpm --filter api build
exit 0 (tsc NodeNext clean)
```

```
pnpm type-check (repo-wide)
exit 0 — clean
```

```
pnpm architecture
✔ no dependency violations found (1307 modules, 3639 dependencies cruised)
✅ Architecture negative guard passed
```

## PR 6

- Branch: `feat/08-plan-gen-pr6-service-routes`
- Commit: a11f562
- Base: main (stacked-to-main, PR5 merged)
- Status: open — awaiting review

## Completed Tasks (PR 7a) — all [x]

- [x] 7a.1.1 Added `@fastify/websocket` to `apps/api/package.json` via `pnpm add --filter api`; `pnpm-lock.yaml` regenerated; `pnpm deps-guard` passed
- [x] 7a.1.2 RED: wrote `apps/api/src/ws/__tests__/registry.test.ts` — 8 tests (notify sends to matching user's sockets; cross-user isolation; no-op on unknown user; closed sockets skipped; unregister removes socket; unregister + notify is no-op; partial unregister leaves others intact; cross-tenant isolation via distinct userId strings)
- [x] 7a.1.3 GREEN: created `apps/api/src/ws/registry.ts` — `WsRegistry` class with `register(userId, socket)`, `unregister(userId, socket)`, `notify(userId, payload)` backed by `Map<string, Set<WsSocket>>`; skips sockets with `readyState !== WS_OPEN (1)`; notify exceptions swallowed per-socket
- [x] 7a.2.1 RED: wrote `apps/api/src/routes/__tests__/ws.test.ts` — 5 tests (authenticated upgrade accepted via injectWS + headers; socket registered in WsRegistry; unauthenticated rejected with non-101; 'ready' payload shape; 'failed' payload shape)
- [x] 7a.2.2 GREEN: created `apps/api/src/routes/ws.ts` — `wsRoutes: FastifyPluginAsync<WsRoutesOptions>` with `preValidation` hook that returns 401 before WS upgrade when `authContext` is null; WS handler registers socket + unregisters on close; auth via existing `authPlugin` Bearer token path
- [x] 7a.2.3 Registered `@fastify/websocket` plugin and `wsRoutes` in `apps/api/src/app.ts`; `WsRegistry` injected as shared instance to both route and service; `wsRegistry?` added to `BuildAppOptions`
- [x] 7a.3.1 Updated `PlanGenerationService.runGenerationTask` to accept `userId` parameter; calls `wsRegistry?.notify(userId, { planId, status: "ready" })` after `markReady`; calls `wsRegistry?.notify(userId, { planId, status: "failed" })` after `markFailed`; all notify calls wrapped in try/catch (fire-and-forget-safe)
- [x] 7a.3.2 Added 4 new tests to `apps/api/src/ai/__tests__/generation-service.test.ts`: notify called with correct userId + {planId, status:"ready"} on success; notify called with correct userId + {planId, status:"failed"} on failure; notify exception does not propagate; no registry provided → no-op (registry is optional)
- [x] 7a.4.1 Conventional commit: `feat(api/ws): add WebSocket registry and authenticated plan-status endpoint` (918d51b)

## TDD Cycle Evidence (PR 7a)

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 7a.1.2–7a.1.3 | `apps/api/src/ws/__tests__/registry.test.ts` | Unit | N/A (new file) | ✅ Written (module not found) | ✅ 8/8 | ✅ multi-socket, cross-user, cross-tenant, closed-socket skip, unregister, partial unregister | ➖ None needed |
| 7a.2.1–7a.2.2 | `apps/api/src/routes/__tests__/ws.test.ts` | Integration | N/A (new file) | ✅ Written (module not found) | ✅ 5/5 | ✅ auth + no-auth + registry spy + ready + failed payloads | ➖ None needed |
| 7a.3.1–7a.3.2 | `apps/api/src/ai/__tests__/generation-service.test.ts` | Unit | ✅ 7/7 (pre-existing service tests) | ✅ Written (notify spy → 0 calls) | ✅ 13/13 | ✅ success path + failure path + notify exception + no registry | ➖ None needed |

### Test Summary (PR 7a)

- **Total tests written**: 17 (8 registry + 5 ws route + 4 service notify)
- **Total tests passing**: 387 (32 files), up from 370 baseline (+17 net)
- **Layers used**: Unit (12), Integration (5)
- **Approval tests**: 7 (pre-existing service tests as safety net before modifying generation-service.ts)
- **Pure functions created**: 0 (WsRegistry class, route plugin)

## Files Changed (PR 7a)

| File | Action | Description |
|------|--------|-------------|
| `apps/api/src/ws/registry.ts` | Created | `WsRegistry` in-memory per-user socket registry |
| `apps/api/src/ws/__tests__/registry.test.ts` | Created | 8 unit tests |
| `apps/api/src/routes/ws.ts` | Created | `wsRoutes` — GET /ws/plans with preValidation 401 guard |
| `apps/api/src/routes/__tests__/ws.test.ts` | Created | 5 integration tests via injectWS |
| `apps/api/src/ai/generation-service.ts` | Modified | Optional WsRegistry param; notify on ready/failed; userId threaded through runGenerationTask |
| `apps/api/src/ai/__tests__/generation-service.test.ts` | Modified | +4 notify tests; mock WsRegistry factory |
| `apps/api/src/app.ts` | Modified | @fastify/websocket + wsRoutes + shared WsRegistry DI; wsRegistry? in BuildAppOptions |
| `apps/api/package.json` | Modified | Added @fastify/websocket |
| `pnpm-lock.yaml` | Modified | Lockfile updated for @fastify/websocket |

## Verification Results (PR 7a)

```
pnpm --filter api test
 Test Files  32 passed (32)
      Tests  387 passed (387)
   Duration  4.23s
```

```
pnpm deps-guard
✅ Dependency guard passed — no prohibited packages found.
```

```
pnpm --filter api build
exit 0 (tsc NodeNext clean)
```

```
pnpm type-check (repo-wide)
exit 0 — clean
```

```
pnpm architecture
✔ no dependency violations found (1357 modules, 3779 dependencies cruised)
✅ Architecture negative guard passed
```

```
pnpm push pre-push hook
✅ Coverage thresholds met. Push allowed.
```

## PR 7a

- Branch: `feat/08-plan-gen-pr7a-ws`
- Commit: 918d51b
- PR: https://github.com/kno/kInorA/pull/40
- Base: main (stacked-to-main, PR1–PR6 merged)
- Status: open — do NOT merge (orchestrator runs fresh auth + user-isolation review first)

## WS Auth Mechanism Used

Auth via existing `authPlugin` Bearer token path. The `authPlugin` `onRequest` hook sets `request.authContext` from `Authorization: Bearer <token>`. A `preValidation` hook in `wsRoutes` returns 401 before the WS upgrade handshake completes when `authContext` is null. This ensures the HTTP-level rejection (not just close-after-upgrade), making `@fastify/websocket`'s `injectWS()` throw in tests for the unauthenticated path.

Browser WebSocket note: browsers cannot send `Authorization` headers on WS connections. A future iteration should add a `?token=` query-param read path inside `wsRoutes` before the auth check. This is scoped out of PR7a (v1).

## Remaining Tasks

- [ ] PR 7b: Web UX

---

---

## Review Fixes Applied (post-MERGE-WITH-FIXES review of PR #35, commit acdbd7a)

### Fix 1 — `injectLimitationWarnings` isWarning intentionally ignored
- Added clarifying comment: domain never hard-blocks; `isWarning` is NOT a gate.
- Added test: `isWarning: false` still produces a single non-blocking advisory warning.

### Fix 2 — `DIAGNOSTIC_PATTERNS` narrowed to phrasing/attribution only
- Removed bare condition nouns (arthritis, syndrome, herniated, etc.) — false positives on legit fitness copy.
- New list: `you have`, `you may have`, `diagnosed with`, `you suffer from`, `suffering from`, `your condition/diagnosis/chronic condition`, `this indicates`, `this suggests a`, `symptoms of`.
- Added tests: 7 attribution violations (THROWS) + 4 legit-content passes (NOT throw), including "iliotibial band syndrome" and "arthritis-friendly session".

### Fix 3 — Unknown-exercise substitution path now tested
- Added test: exercise NOT in SUBSTITUTION_MAP returned unchanged, no substitutionNote.

### Acknowledge — Diagnostic guard placement is correct
- design.md file table lists guard under `apps/api/src/ai/` — this is stale. tasks.md 2.3.2 specifies `packages/domain/src/plan/diagnostic-guard.ts`. Pure function, no side effects. Domain is the correct home. No code move.

---

## Status

15/15 PR1+PR2 tasks complete. Review fixes applied (commit acdbd7a). PR #35 updated at https://github.com/kno/kInorA/pull/35. Ready for re-review before merge.
