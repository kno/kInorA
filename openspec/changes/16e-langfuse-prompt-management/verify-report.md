# Verify Report: Slice A1 — Tracing Channel + Dead-Path Removal

Change: `16e-langfuse-prompt-management` (GitHub #366)
Verified branch: `feat/langfuse-tracing-handler`
Verified PR: https://github.com/kno/kInorA/pull/368 (base `main`, open, not merged)
Verified commit: `5c77759` (HEAD of the branch at verification time)

## Gate evidence (accepted as reported by the orchestrator, not re-run)

- `pnpm type-check` — all 7 projects, Done.
- `apps/api` `pnpm test:coverage` — 163 files, 1957 passed, 116 skipped, exit 0, functions
  **88.08%** (gate 85%).
- `pnpm build` — Done.
- `git diff --stat main..feat/langfuse-tracing-handler` (code only) confirms the diff is exactly
  9 files / 306 insertions / 326 deletions ≈ 632 changed lines, under the 800-line budget.

## Scope discipline (Requirement 8) — PASS

The diff touches exactly: `apps/api/README.md`, `apps/api/src/ai/__tests__/adapter-factory.test.ts`,
`apps/api/src/ai/__tests__/langfuse-handler.test.ts` (new),
`apps/api/src/ai/__tests__/openrouter-generator.test.ts` (deleted),
`apps/api/src/ai/adapter-factory.ts`, `apps/api/src/ai/langfuse-handler.ts` (new),
`apps/api/src/ai/openrouter-generator.ts`, `apps/api/src/ai/port.ts`, `apps/api/src/app.ts`.

No touch to `prompt.ts`, `extraction-prompt.ts`, `extraction-adapter.ts`, `mask.ts`, or
`docker-compose.yml`. **No scope leakage into A2/B1/B2 detected.**

## Per-requirement verdict

| Requirement (spec.md) | Verdict | Evidence / gap |
|---|---|---|
| Safe-By-Construction Tracing Handler | **PARTIAL (functionally satisfied, one untested path)** | `buildLangfuseCallbackHandler` returns `null` on missing either key (tested, 3 cases) and on throwing construction (+exactly one secret-free warn, tested — warn payload asserted to exclude both key values). `invokeChain`'s conditional spread `...(handler ? { callbacks: [handler] } : {})` (`adapter-factory.ts:64`) keeps the no-handler config byte-identical (tested: `not.toHaveProperty("callbacks")`). **Gap:** the "trace emission or flush failure never rejects the request" scenario is implemented at `app.ts:395-405` (`onClose` hook, try/catch around `flushAsync()`, warns and swallows) but **no test exercises this hook** — no `app.test.ts` or route suite asserts the hook is registered, that a rejecting `flushAsync` is swallowed, or that shutdown is not delayed. Code inspection confirms correctness (bare `try { await … } catch { warn }`, no throw possible), but this is unverified by the suite, unlike every other sub-scenario of this requirement. |
| Langfuse Base URL Resolution | **PASS** | `resolveLangfuseBaseUrl(env)` = `LANGFUSE_BASEURL ?? LANGFUSE_HOST`. All three scenarios (`LANGFUSE_HOST`-only, both-set, neither-set) are directly tested, including that no `baseUrl` key at all is passed to the constructor when neither is set (`langfuse-handler.test.ts:110-116`, asserts `not.toHaveProperty("baseUrl")` rather than `toBeUndefined()` — correctly distinguishes "no key" from "key set to undefined"). |
| Masking Invariant on Trace Payloads (input half — the only half A1 claims) | **PASS** | `adapter-factory.test.ts:161-178` — asserts the invoke input contains `[REDACTED]` and does NOT contain `osteoporosis`, AND `JSON.stringify([invokeInput, resolvedProgram])` does not contain the raw term. Confirmed adversarially: removing `mask(rawPrompt, limitationTerms)` at `adapter-factory.ts:58` (or the call at line 61) would make `invokeInput` equal the raw prompt containing `osteoporosis`, failing line 175 — the test is a real regression guard, not a tautology. Note the `resolvedProgram` half of the assertion is trivially true regardless of masking (the mocked `mockProgram` fixture never contained the term to begin with, since `WorkoutProgramSchema` output has no limitation-bearing field) — this is by design (schema shape excludes limitation fields structurally) and matches the spec's "Output payload carries no limitation-bearing field" scenario, not a test weakness for A1's claimed scope. |
| No Untraced Duplicate Prompt Path Remains | **PASS** | `OpenRouterPlanGenerator` class and `__tests__/openrouter-generator.test.ts` are both deleted (commit `6fa4787`, confirmed absent on disk). `warnIfAiConfigMissing` remains in `openrouter-generator.ts`, is still imported at `app.ts:21`, and is still covered by `__tests__/startup-warning.test.ts` (confirmed present). `port.ts`'s implementor-list comment was rewritten to reference the `adapter-factory.ts` provider factories instead of the deleted class — no dangling reference found anywhere (grepped `port.ts`, `app.ts` around lines ~132/~224 pre-edit locations, `openrouter-generator.ts`). All five plan-generation provider factories (openrouter/openai/anthropic/google/opencode-go) call `invokeChain` exclusively — confirmed by reading `adapter-factory.ts` in full; no alternate prompt/mask/invoke path exists. |
| Prompt Tests Run Offline | **PASS** (for A1-scoped modules) | `langfuse-handler.test.ts` hoists `vi.mock("langfuse-langchain")` with a plain recording/throwing constructor — no real client, no network, no credentials ever constructed. `adapter-factory.test.ts` mocks `@langchain/openai`/`@langchain/anthropic`/`@langchain/google-genai` fully; `mockInvoke` never performs a real call. No test in the diff requires network access or real Langfuse credentials. |

## Strict TDD compliance (Requirement 9)

Commit sequence: `a1731a9` (openspec docs) → `cbcdce5` (handler.ts + its test, same commit) →
`84d6a2e` (adapter-factory.ts wiring + inverted/masking tests + app.ts, same commit) → `6fa4787`
(delete OpenRouterPlanGenerator + its test) → `6fb4837` (README) → `51364ed` (tasks.md) → `5c77759`
(apply-progress.md).

**Observation, not a violation:** every code commit bundles its test(s) and implementation together
in one commit (e.g. `cbcdce5` adds `langfuse-handler.test.ts` and `langfuse-handler.ts` in the same
commit; `84d6a2e` adds the inverted/masking tests and the `adapter-factory.ts`/`app.ts` production
changes together). `tasks.md`'s A1.2–A1.9 checklist and `apply-progress.md` both assert the RED step
was run and confirmed failing before each GREEN step, but **git history alone cannot independently
confirm the RED phase actually ran** — the repository only shows the post-GREEN squashed state per
module. This is consistent with the project's usual commit granularity (one commit per cohesive
work unit, not per TDD micro-step) and is not by itself evidence of a TDD violation, but it means
strict-TDD compliance for A1 rests on the apply agent's self-report, not on independently
verifiable commit-level evidence.

## Additional checks

- **Null-handler byte-identical config** — confirmed at the code level (conditional spread, no
  `callbacks: []` fallback) and by test (`not.toHaveProperty("callbacks")`), matching the spec's
  precise requirement that a `null` handler produces NO `callbacks` key at all, not an empty array
  or `undefined` value.
- **Credential leakage in logs** — confirmed no code path can pass `publicKey`/`secretKey` values
  into `warn(...)`; the only `warn()` call sites pass `error.name`-derived strings
  (`langfuse-handler.ts:73`) or `errName` from a caught error (`app.ts:400-403`). Tested for the
  construction-failure path; untested for the `onClose` flush-failure path (see gap above), though
  the same "error.name only" pattern is used there too.
- **Dead-path removal completeness** — grepped the full `apps/api/src` tree; no remaining reference
  to `OpenRouterPlanGenerator` anywhere (class, import, or test).

## Summary

A1 is functionally complete and matches `design.md`'s A1-scoped interfaces exactly
(`TracingHandler`, `AiTracingDeps { handler? }`, `resolveLangfuseBaseUrl`,
`buildLangfuseCallbackHandler`). Four of five A1-claimed requirements are fully and adversarially
verified by tests that would genuinely fail if the guarantee were removed. One requirement (Safe-
By-Construction Tracing Handler) is **PARTIAL**: the `onClose` flush-failure sub-scenario is
correctly implemented by inspection but has zero test coverage — a CI regression that reintroduces
a throwing/blocking `onClose` hook would not be caught by the current suite. This is a WARNING, not
a CRITICAL, because the implementation is simple enough (a single try/catch with no other logic) to
audit by inspection, and it does not gate merge on its own, but it should be closed either in a
follow-up commit to this PR or explicitly deferred with a tracked issue before archive.

## Findings by severity

- **CRITICAL:** none.
- **WARNING:** 1 — `onClose`/`flushAsync` best-effort shutdown behavior (app.ts:395-405) has no
  automated test coverage.
- **SUGGESTION:** 1 — commit granularity (test+impl combined per commit) means TDD RED-phase
  compliance is self-reported, not independently git-verifiable; consider splitting RED/GREEN into
  separate commits in future slices if independent TDD auditability matters, or accept the
  self-report as sufficient (team convention).

## Recommendation

`next_recommended`: proceed toward merge/A2 is reasonable once the team decides whether the
`onClose` coverage gap needs closing first. Given `chain_strategy: stacked-to-main` (A1 reaching
production early is the whole point, per `proposal.md`), and given the gap is a missing *test* for
already-correct code rather than a functional defect, this WARNING does not need to block merge —
but it should be tracked (either fixed in a fast-follow commit on this PR, or filed as a follow-up
issue) rather than silently dropped.
