# Verify Report: 16e-langfuse-prompt-management — Full Chain (A1 → A2 → B1 → B2a → B2b → C)

Change: `16e-langfuse-prompt-management` (GitHub #366, open, `enhancement`, `status:approved`)
Verified against: `main` @ `c062278` (HEAD at verification time; working tree clean, no uncommitted changes)
Slices merged: A1 `2bd7fc5` (#368), A2 `d132d99` (#370), B1 `835ca73` (#371), B2a `a5a55d2` (#372),
B2b `162e8b7` (#373), C `c062278` (#376)

This report **extends** the prior A1-only verify report (preserved below under "A1 — original
verification, preserved") with the remaining five slices and a full-chain cross-check. The A1
`onClose`/`flushAsync` WARNING flagged in that original report is **resolved** — see "A1 WARNING
resolution" below.

## Gate evidence (re-run by this executor, not accepted secondhand)

| Gate | Command | Result |
|---|---|---|
| Unit/integration tests | `pnpm --filter api test` (via `cd apps/api && pnpm test`) | **170 test files, 2041 passed, 116 skipped**, exit 0 |
| Coverage | `pnpm --filter api test:coverage` | **170 files, 2041 passed, 116 skipped, exit 0.** `All files` functions **88.49%** (gate 85%, `apps/api/vitest.config.ts:31`). `langfuse-handler.ts`, `prompt-linked-chain.ts`, `remote-template-validation.ts`, `prompt-provider.ts`, `prompt-source-port.ts`, `prompt-template.ts`, `prompt.ts`, `langfuse-prompt-gateway.ts` all measure **100% functions**. `mask.ts` 100% all metrics. |
| Type-check | `pnpm type-check` | All 7 workspace projects, **Done**, no errors |
| Build | `pnpm build` | `ui-api-guard` ✅ (48 client files, 0 violations), `architecture` (dep-cruiser) **0 dependency violations across 2011 modules / 6026 dependencies** ✅, architecture negative guard ✅, every package/app build **Done**, exit 0 |

These numbers match what `apply-progress.md` reported for slice C's own gate run — independently
reproduced here, not merely re-quoted.

## Scope discipline (Requirement — issue out-of-scope list) — PASS

`git diff --stat df18b21..c062278 -- . ':!openspec'` (the full 16e chain against its pre-change base)
touches exactly 31 files: `apps/api/README.md`, `docker-compose.yml`, and 29 files under
`apps/api/src/ai/*` + `apps/api/src/app.ts` (10 new production modules, their tests, 2 generated
snapshot files, and the deleted `openrouter-generator.test.ts`). No file under `packages/contracts`,
`apps/web`, `apps/mobile`, or any other app/package is touched. Nothing in scope for prompt A/B
testing infrastructure, an evaluation harness, self-hosting Langfuse, or a fourth prompt exists
anywhere in the diff — the three prompt names (`kinora-plan-generation`, `kinora-chat-reply`,
`kinora-chat-extraction`) are the only ones referenced. **No scope leakage.**

## A1 WARNING resolution

The original A1-only report flagged one WARNING: the `onClose`/`flushAsync` best-effort shutdown
hook had no test coverage. On `main`, `apps/api/src/ai/langfuse-handler.ts:91` now exports
`flushLangfuseHandlerOnClose(handler, warn)`, wired at `apps/api/src/app.ts:414-415`
(`app.addHook("onClose", async () => { await flushLangfuseHandlerOnClose(langfuseHandler, ...) })`),
and is covered by three cases in `langfuse-handler.test.ts:118-157`: swallows a rejecting
`flushAsync` and warns with `errName` only (asserts `Object.keys(payload)` is exactly `["errName"]`,
no `message`/`stack`), resolves without warning on success, and no-ops when the handler is `null`.
**This WARNING is closed** — not by inspection, by a real regression-guard test (a reverted
`try/catch` would fail the first case).

## Per-requirement verdict (all 20 spec.md requirements)

| # | Requirement | Verdict | Evidence |
|---|---|---|---|
| 1 | Safe-By-Construction Tracing Handler | **PASS** | `buildLangfuseCallbackHandler` returns `null` on either-missing-key or throwing construction (`langfuse-handler.test.ts:24-72`), never rejects the request path (conditional `callbacks` spread, byte-identical no-handler config, `adapter-factory.ts:112-116`), and the `onClose` flush-failure path is now tested (see above). One secret-free log line on every failure path, confirmed no credential value ever reaches `warn(...)` (`langfuse-handler.ts:73`, `app.ts:415-417`). |
| 2 | Langfuse Base URL Resolution | **PASS** | `resolveLangfuseBaseUrl(env) = LANGFUSE_BASEURL ?? LANGFUSE_HOST`; all three scenarios tested including "no explicit `baseUrl` key at all" (`langfuse-handler.test.ts:74-116`), reused identically by `langfuse-prompt-gateway.ts:62-67` for the prompt gateway's own client construction. |
| 3 | Fixed Production Label Is the Only Promotion Gate | **PASS** | `PRODUCTION_LABEL = "production"` hardcoded in `prompt-provider.ts:19`, passed to every `fetchPrompt` call (`prompt-provider.ts:99`); no env var, no promotion-time check anywhere in the diff. |
| 4 | Prompt Cache TTL Env-Configurable, 60s Default | **PASS** | `resolvePromptCacheTtlMs(env)` (`prompt-provider.ts:137-142`): unset → `60_000`; parses valid positive; `Number.isFinite(parsed) && parsed > 0` gates the default, so `NaN`/`0`/negative all fall back without throwing. 5 cases tested in `prompt-provider.test.ts` (unset/valid/`"abc"`/`"0"`/`"-5"`). |
| 5 | Prompt Cache TTL Env Var Forwarded in Compose | **PASS** | `docker-compose.yml:90`: `LANGFUSE_PROMPT_CACHE_TTL_MS: ${LANGFUSE_PROMPT_CACHE_TTL_MS:-60000}` inside the `api` service's `environment:` block. `docker-compose-env-forward.test.ts` parses that service's block SPECIFICALLY (a `environmentOf(compose, "api")` helper that locates the `api:` service, then its `environment:` sub-block, then scans only those lines) — NOT a whole-file `toContain`, so a var appearing in a comment, another service, or `volumes:` would NOT satisfy it. Independently confirmed load-bearing by the apply executor (deleted the line locally → red; restored → green), and re-confirmed here by reading the test's implementation (`environmentOf`, lines 29-51) — it genuinely asserts placement inside the `api` service's `environment:` block, not mere file-wide presence. |
| 6 | Remote Prompt Fetch With Mandatory Local Fallback | **PASS** | `ResolvePrompt.resolve()` (`prompt-provider.ts:89-119`) covers every failure class in one ordered try/fallback: `gateway === null` → `no_credentials`; `fetchPrompt` throw → `prompt_not_found` (via `PromptNotFoundError`) or `fetch_failed`; `validateRemoteTemplate` reject → its reason code; `checkRenderedTemplate` reject → `unresolved_marker_after_render`. Every branch calls `this.fallback(...)` which renders `def.localTemplate` and returns `source: "fallback"` — no failure class can surface as a request-path error. All classes tested in `prompt-provider.test.ts` (B2.8/B2.9 per apply-progress). |
| 7 | TTL Cache With Concurrent-Burst Coalescing | **PASS** | `pending` Map keyed by `def.name` (`prompt-provider.ts:50,69-86`): a cold/expired `execute()` starts exactly one `resolve()` promise, stored in `pending` before any awaiter can race it, deleted only in `.finally()`. Tested: cold-cache burst of 5 concurrent calls → 1 `fetchPrompt` call, same resolved value to all callers (`prompt-provider.test.ts`, mirrors `billing-pricing.test.ts`'s pattern per design). |
| 8 | Fallback Result Is Cached Too | **PASS** | `execute()` caches `resolution` from `.then(...)` regardless of `source` (`prompt-provider.ts:74-81`, comment: "Cache whatever was resolved — remote OR fallback"). Tested: a sustained failure makes exactly 1 upstream attempt across repeated calls within one TTL window; TTL expiry retries after. |
| 9 | Untrusted Remote Template Validation Fails Closed | **PASS** | `validateRemoteTemplate` (`remote-template-validation.ts:47-78`) implements the ordered algorithm exactly: zod shape (`payload_not_string`/`payload_empty`/`payload_too_large`) → unknown-variable → required-markers-present → strictly-increasing `orderedMarkers` via `indexOf` (`marker_order_violated`, first failure wins, REJECTS WHOLE — no repair attempted, confirmed by reading the function: on any check failing it returns immediately with no mutation of `template`) → `checkRenderedTemplate` post-render `{{` sweep (`unresolved_marker_after_render`). All 10 `PromptRejectionReason` values covered table-driven in `remote-template-validation.test.ts`, including the explicit "relocates a required marker out of order — marker_order_violated, not repaired" case (line 65-71) asserting the whole template is rejected, not reordered. |
| 10 | Local and Remote Templates Share One Renderer, Byte-Identical Output | **PASS, with the documented in-tree caveat carried forward from B1's own record** | `renderTemplate`/`templateVariablesOf` (`prompt-template.ts`) are the single renderer for both paths; `ResolvePrompt.resolve()` and every local-path caller (`buildPlanPrompt`, `buildReplyPrompt`, `buildExtractionPrompt`) call the same function. **The in-tree byte-identical/snapshot tests cannot themselves prove byte-identity post-refactor** (both `.snap` files were written in the GREEN commits, after the refactor, so they freeze POST-refactor output — a tautology once the pre-refactor function no longer exists in the tree). This gap was independently closed by the orchestrator: pre-refactor `prompt.ts`/`extraction-prompt.ts` were materialized from `main` via `git show`, and 19/19 cases (11 plan-prompt + 4×2 chat-prompt) proved byte-for-byte equality, recorded in `apply-progress.md`'s "Orchestrator ruling and independent byte-identity proof (B1)" section. That record is present, accurate, and specific (exact case count, exact method). The committed snapshots now serve as the intended FORWARD drift guard once equality was established externally — this is the correct convention, and `apply-progress.md` states it explicitly for future slices. |
| 11 | Masking Invariant on Trace Payloads | **PASS** | `mask()` runs on the RENDERED string at exactly two call-site files/three call sites total: `adapter-factory.ts:87` (before `linkStructuredChain` at line 93 and before `.invoke` at line 112), and `extraction-adapter.ts:231` (`streamReply`, before `linkStreamingModel` at line 242) / `extraction-adapter.ts:302` (`extract`, before `linkStructuredChain` at line 314). Every metadata/attribution object is built AFTER masking already occurred, so nothing unmasked can leak via metadata either. Masking-payload tests exist at all three sites (A1's `adapter-factory.test.ts`, A2/B1's `extraction-adapter.test.ts` masking-relocation block) and assert both `[REDACTED]` presence and raw-term absence, including in `JSON.stringify([invokeInput, resolvedProgram])`. |
| 12 | First-Mention Limitation Masking Gap Is Accepted, Not Fixed | **PASS** | `extraction-adapter.test.ts`'s B1 masking-relocation block includes "first-mention phrase NOT masked in either pass (accurate, not a bug)" per `apply-progress.md`. Follow-up issue #374 filed and OPEN, confirmed via `gh issue view 374` (title: "Tighten first-mention limitation masking gap now that a real trace channel exists"). No requirement anywhere in the spec attempts to mask a first-mention term — confirmed by reading the full spec text. |
| 13 | Trace Attribution to Prompt Source and Version | **PASS** | `adapter-factory.ts:95-109` and both `extraction-adapter.ts` call sites build `promptSource` (always present, default `"fallback"` set before any branch per B2.19's REFACTOR note — confirmed by reading the code: the `let promptSource: ... = "fallback"` declaration precedes every conditional), and attach `promptName`/`promptVersion`/`promptLabel: "production"`/`langfusePrompt` ONLY inside `promptSource === "langfuse"` branches — never on the fallback path. Tested at both call sites (C.9 attribution cases). |
| 14 | Native Prompt-Version Linkage Populates on the Happy Path | **PASS** | `linkStructuredChain`/`linkStreamingModel` (`prompt-linked-chain.ts:55-85`) rebuild ONE FLAT `RunnableSequence.from([promptStep(), ...structured.steps])` (or `[promptStep(), model]`), reusing the structured chain's own `steps` getter so the model becomes a sibling run of the prompt step under the same parent. `prompt-linked-chain.test.ts` proves this with a REAL `RunnableSequence`/`RunnableLambda` from `@langchain/core` and a genuine ~15-line offline `BaseChatModel` subclass (`CannedChatModel`) producing a real `handleChatModelStart` event — not a mock — asserting the model's `parentRunId` equals the prompt step's own `runId`. |
| 15 | Graceful Degradation to Flat Attribution | **PASS** | Both linkers check `== null` FIRST (guards `RunnableSequence.isRunnableSequence`'s `.middle` dereference), then the duck-typed shape guard (`isRunnableSequence` / `Runnable.isRunnable`); any non-matching shape — including `null`, `undefined`, a plain object, and an `includeRaw`-shaped fake — returns `{ chain: <original, untouched>, linked: false }` with no throw. Guard-degradation table in `prompt-linked-chain.test.ts:205-236` covers all four cases (`null`, `undefined`, plain-object, includeRaw-shaped). Flat `promptSource`/`promptLinked` (always attached) plus the conditional scalar fields still populate the trace on the declined path, and the call still generates successfully — proven by the declined-guard-still-generates case in `adapter-factory.test.ts`'s slice-C describe block. |
| 16 | Masking Invariant Holds Across the Restructured Invocation Chain | **PASS** | `promptStep()` is a pure `RunnableLambda` identity over its input (`prompt-linked-chain.ts:35-37`) — it receives the value AFTER `mask()` already ran at the call site (confirmed by source order: `mask()` at `adapter-factory.ts:87` / `extraction-adapter.ts:231,302`, `linkStructuredChain`/`linkStreamingModel` called strictly after, at lines 93/242/314). `prompt-linked-chain.test.ts`'s masking-invariant case asserts the outer sequence start, the prompt step's start, AND the model's `handleChatModelStart` all observe only the already-masked string. |
| 17 | Output Equivalence Under Chain Restructuring | **PASS** | `linkStructuredChain` reuses `structured.steps` verbatim (`prompt-linked-chain.ts:65`, `[promptStep(), ...structured.steps]`) — the bound LLM and parser objects are untouched, only reparented, so the last step's output type and the `WorkoutProgramSchema.parse` call site are identical before/after. Tested: reparented vs. untouched sequence produce an identical parsed result for the same canned model response (C.7/C.8 per `apply-progress.md`); `WorkoutProgramSchema.parse` behavior confirmed identical. |
| 18 | Native Linkage Behaviour Is Verifiable Offline | **PASS** | `prompt-linked-chain.test.ts` uses `@langchain/core`'s REAL `RunnableSequence`/`RunnableLambda` plus the local `CannedChatModel` subclass — no network, no Langfuse client, no SDK mock (only a locally-defined `fakeCallbackHandler()` recording `(runId, parentRunId, metadata, payload)`). Confirmed by reading the test file directly: no `vi.mock` of any network-facing module, no credential anywhere in the file. |
| 19 | Prompt Tests Run Offline With No Network/Credentials | **PASS** | Full apps/api suite (170 files, 2041 passed) run with no `LANGFUSE_*` env vars set in this environment and no network access; `test:coverage` gate green at 88.49% functions (≥85%). `langfuse-handler.test.ts`/`langfuse-prompt-gateway.test.ts` hoist `vi.mock` over the SDK constructor; `prompt-provider.test.ts` uses a fake gateway + injected clock; `prompt-linked-chain.test.ts` uses real but offline LangChain primitives. No test in the diff requires network or credentials. |
| 20 | No Untraced Duplicate Prompt Path Remains | **PASS** | `grep -rn "OpenRouterPlanGenerator" apps/` returns nothing anywhere in the tree (class and its dedicated test both deleted in A1, confirmed absent on `main`). `warnIfAiConfigMissing` still exists in `openrouter-generator.ts` and is still imported/tested. All five plan-generation provider factories (`createOpenRouterAdapter`, `createOpenAIAdapter`, `createAnthropicAdapter`, `createGoogleAdapter`, `createOpenCodeGoAdapter`, `adapter-factory.ts`) call the SAME `invokeChain` — confirmed by reading the full file: no alternate prompt/mask/invoke path exists anywhere in `apps/api/src`. |

**All 20 requirements: PASS.** Requirement 10 carries one documented, already-resolved caveat (the
in-tree tests are a tautology post-refactor; byte-identity was proven externally and recorded) —
this is disclosed above, not silently accepted, matching the original apply record's own honesty
about the limitation.

## Production facts (per team-lead's message, treated as established)

1. Langfuse traces arrive in production — the A1 credentials are valid. Consistent with code: `buildLangfuseCallbackHandler` only returns non-null when construction succeeds against those exact credentials, so a non-null handler in production entails a working client.
2. The three prompts exist in Langfuse under `production`, and a monitored call showed `promptSource: "langfuse"` — consistent with `ResolvePrompt.resolve()`'s only path that sets `source: "langfuse"` (a successful fetch + validation + render + post-render check, `prompt-provider.ts:118`).
3. After C deployed, both plan generation and chat turns show `promptLinked: true` with full metadata, and the Langfuse Prompts tab shows linked executions. **This supersedes design.md's own stated residual uncertainty** (design.md's Open Questions explicitly deferred this exact confirmation to "once, out of band, after C deploys" — task C.17). The code path that produces this outcome is `linkStructuredChain`/`linkStreamingModel` reparenting under the real `withStructuredOutput` shape all five providers return — exactly the happy path design.md's SDK verification section predicted would work. No artifact in this change claims linkage cannot be established; design.md is explicit that the "Blocking finding" language never applied here (design.md frames the flat-sequence decomposition as "the fix," not a fallback) — there is nothing to correct in the design or spec text on this point.

## Task completeness (tasks.md)

- A1.1–A1.15: all `[x]`, all match the code (verified above).
- A2.1–A2.7: all `[x]`, verified via `extraction-adapter.ts`'s conditional `callbacks` spread at both call sites, identical idiom to `invokeChain`.
- B1.1–B1.11: all `[x]`; the byte-identity caveat is documented in `apply-progress.md` and repeated in this report's Requirement 10 row, not silently dropped.
- B2.1–B2.20 (across B2a + B2b): all `[x]`; verified against `remote-template-validation.ts`, `prompt-source-port.ts`, `langfuse-prompt-gateway.ts`, `prompt-provider.ts`, the compose forward, and the call-site wiring.
- C.1–C.16: all `[x]`, verified against `prompt-linked-chain.ts` and both attachment sites.
- **C.17 is unchecked in `tasks.md`, by design** ("Operational, not a test... Deliberately left unchecked here"). Per the team-lead's message, the product owner has now CONFIRMED this exact operational fact in production (Prompts tab populates, `promptLinked: true`). **Recommendation: check off C.17 in `tasks.md` before archive**, citing the product owner's confirmation, since the only reason it was left open was that "this executor cannot perform it before merge" — that blocker no longer applies now that deployment and confirmation have both happened.
- Final Verification checklist (tasks.md bottom): all six items `[x]`; every one independently re-run and reconfirmed by this executor above (test, coverage, tsc, architecture, build, the two greps).

## Loose ends — all accounted for

- Follow-up #374 (first-mention masking gap) — filed, OPEN, confirmed via `gh issue view`.
- Follow-up #375 (re-run `prompt-linked-chain` tests on a `@langchain/*` bump) — filed, OPEN, confirmed via `gh issue view`.
- #369 (the `buildApp` coverage-instrumentation trap, filed during A1) — OPEN, confirmed via `gh issue view`. Consistent with the coverage report's own `app.ts` line: `27.5%` statements / `71.42%` functions covered, the exact instrumentation artifact #369 describes — not a regression introduced by this change, and not silently dropped; it is tracked.
- #366 (the parent issue) — OPEN, correctly not auto-closed by any PR in the chain (each PR used `Part of #366`, per the documented convention to avoid the premature auto-close that happened once during A1). Closing #366 is an archive-time action, not something any slice's PR should have done.
- No task or requirement was found to have been silently dropped without becoming one of the above tracked items.

## Findings by severity

- **CRITICAL:** none.
- **WARNING:** none. (The one WARNING from the A1-only report — `onClose` flush-failure coverage — is resolved on `main`, see above.)
- **SUGGESTION:** 1 — before archive, check off task C.17 in `tasks.md` and note the product owner's production confirmation (Prompts tab populates, `promptLinked: true`) as the closing evidence, so the task record does not read as an indefinitely-open operational item once the fact is actually confirmed.

## Final verdict

**PASS.** All 20 spec requirements verified with passing, adversarially-checked tests (not source
inspection alone); all four gates (`test`, `test:coverage`, `type-check`, `build`) independently
re-run in this session, all green; scope discipline confirmed with a full-chain diff; the masking
invariant is confirmed unbroken at every one of the three call sites, before and after the slice-C
chain restructure; the mandatory-fallback guarantee is confirmed for every named failure class with
a covering test; the #352 closed-vocabulary marker-order guarantee is confirmed to reject a
relocated remote template WHOLE, never repaired; the TTL compose-forward test is confirmed
placement-asserting, not a whole-file `toContain`; C's degradation path is confirmed to leave
generation/chat working with `promptLinked: false` and no throw; the B1 byte-identity claim is
confirmed to rest on the orchestrator's external, out-of-tree proof (documented, not silently
assumed) with the committed snapshots serving correctly as the forward drift guard. The one
remaining item is administrative (close out task C.17 with the now-available production evidence),
not a functional or spec gap. **Recommend archive**, with task C.17 checked off first.

---

# A1 — original verification, preserved

*(Everything below this line is the original A1-only verify report, produced before A2/B1/B2/C
existed, and is kept verbatim as the historical record this report extends.)*

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
