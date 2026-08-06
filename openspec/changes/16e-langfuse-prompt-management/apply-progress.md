# Apply Progress: 16e-langfuse-prompt-management

GitHub #366. Fixed slice order: A1 → A2 → B1 → B2 → C. This file is updated by each slice's
`sdd-apply` executor and read by later slices and by `sdd-verify` for continuity.

## Slice A1 — Tracing Channel + Dead-Path Removal

**Status: DONE.** All A1.1–A1.15 tasks in `tasks.md` are complete; none deferred, none left
unchecked.

- Branch: `feat/langfuse-tracing-handler` (from `main`)
- PR: https://github.com/kno/kInorA/pull/368 — base `main`, `chain_strategy: stacked-to-main`.
  **Open, NOT merged.** Do not merge from this file's authority; the orchestrator owns the
  review/merge lifecycle.
- 6 commits on the branch (planning-artifacts commit, 4 code work-unit commits, 1 tasks.md
  progress-marking commit). Code diff (excluding the `openspec/` planning artifacts) is
  ≈632 changed lines — under the 800-line budget (orchestrator-verified).

### Task-by-task (tasks.md A1.1–A1.15)

- [x] A1.1 — Pre-flight grep confirmed: no test outside the now-deleted
  `openrouter-generator.test.ts` ever constructed `OpenRouterPlanGenerator`.
- [x] A1.2–A1.4 — RED tests for `buildLangfuseCallbackHandler`/`resolveLangfuseBaseUrl` written
  and confirmed failing (module did not exist) before implementation.
- [x] A1.5 — GREEN: `apps/api/src/ai/langfuse-handler.ts` created.
- [x] A1.6 — RED: `adapter-factory.test.ts` inverted ("attaches the injected tracing handler" +
  "omits the callbacks key entirely when no handler is injected"), confirmed failing before A1.7.
- [x] A1.7 — GREEN: `buildAdapters(deps?: AiTracingDeps)` + conditional `callbacks` spread in
  `invokeChain`, threaded through all five provider factories.
- [x] A1.8–A1.9 — RED then confirmed-passing masking-payload test (no additional production code
  needed beyond A1.7, as the design predicted).
- [x] A1.10–A1.11 — `openrouter-generator.test.ts` deleted first (confirmed full suite still green
  with it gone, i.e. nothing else depended on the module); `OpenRouterPlanGenerator` class then
  deleted from `openrouter-generator.ts`; `warnIfAiConfigMissing` kept.
- [x] A1.12 — `app.ts` wired: handler built once, injected into `buildAdapters`, `onClose` best-effort
  `flushAsync()` hook added, stale comments at `app.ts:132`/`app.ts:224` (pre-edit line numbers)
  rewritten.
- [x] A1.13 — `apps/api/README.md` documents `LANGFUSE_BASEURL`/`LANGFUSE_HOST` precedence and the
  safe-by-construction tracing behaviour.
- [x] A1.14 — REFACTOR pass confirmed the no-handler invoke config stays byte-identical (asserted by
  A1.6's second test case: no `callbacks` key when no handler is injected).
- [x] A1.15 — Verify: all gates green (see Gate Evidence below).

### Files created

- `apps/api/src/ai/langfuse-handler.ts` — `TracingHandler` interface, `AiTracingDeps` interface,
  `resolveLangfuseBaseUrl(env)`, `buildLangfuseCallbackHandler(opts?)`.
- `apps/api/src/ai/__tests__/langfuse-handler.test.ts`.

### Files modified

- `apps/api/src/ai/adapter-factory.ts` — `buildAdapters(deps?: AiTracingDeps)`; `invokeChain(chain,
  spec, metadata, deps?)` now spreads `...(handler ? { callbacks: [handler] } : {})`; all five
  factory functions (`createOpenRouterAdapter`, `createOpenAIAdapter`, `createAnthropicAdapter`,
  `createGoogleAdapter`, `createOpenCodeGoAdapter`) take an optional `deps` param and forward it;
  the superseded "no callback attached" comment above `invokeChain` was rewritten (not deleted) to
  document why A1 overrides that rationale.
- `apps/api/src/ai/__tests__/adapter-factory.test.ts` — inverted the "does not attach callbacks"
  test into two cases (handler attached / no handler → no `callbacks` key); added a new
  `describe("masking invariant on trace payloads")` block asserting `[REDACTED]` in the invoke
  input, absence of the raw term, and absence of the raw term in
  `JSON.stringify([invokeInput, resolvedProgram])`.
- `apps/api/src/app.ts` — imports `buildLangfuseCallbackHandler`; builds `langfuseHandler` once per
  app instance (`warn` wired to `app.log.warn`); constructs `aiTracingDeps = { handler:
  langfuseHandler }` and passes it to `buildAdapters(aiTracingDeps)`; registers a Fastify `onClose`
  hook that calls `flushAsync()` best-effort (try/catch, warns on failure, never throws, never
  blocks shutdown); rewrote the stale `OpenRouterPlanGenerator`-referencing comments (the
  `planGenerator` JSDoc and the `buildApp` JSDoc).
- `apps/api/src/ai/port.ts` — rewrote the stale `OpenRouterPlanGenerator` implementor-list comment
  to reference the `adapter-factory.ts` provider factories instead.
- `apps/api/README.md` — added `LANGFUSE_BASEURL` row + precedence note to the AI env table; added
  a "Tracing (langfuse-prompt-management)" paragraph describing the safe-by-construction behaviour.
- `openspec/changes/16e-langfuse-prompt-management/tasks.md` — A1.1–A1.15 marked `[x]`.

### Files deleted

- `apps/api/src/ai/__tests__/openrouter-generator.test.ts` (class-only test; `warnIfAiConfigMissing`
  stays covered by `__tests__/startup-warning.test.ts`, confirmed unaffected).
- `OpenRouterPlanGenerator` class removed from `apps/api/src/ai/openrouter-generator.ts` (file now
  contains only `warnIfAiConfigMissing`).

### Interface/signature conformance to design.md

No deviation from `design.md`'s `## Interfaces / Contracts` section for the A1-scoped shapes:

- `TracingHandler` — `{ readonly name: string; flushAsync(): Promise<unknown> }`, exact match.
- `buildLangfuseCallbackHandler(opts?: { env?, warn? }): TracingHandler | null` — exact match.
- `AiTracingDeps` — design specifies `{ handler?: TracingHandler | null; prompts?: ResolvePrompt }`.
  A1 ships only the `handler` field (`ResolvePrompt` does not exist yet — it is a B2 module). This
  is the design's own stated intent ("`handler` ships in this slice; a later slice adds `prompts`"),
  not a deviation. **B2 must extend `AiTracingDeps` in `langfuse-handler.ts` by adding
  `prompts?: ResolvePrompt`, not redefine it elsewhere.**
- `resolveLangfuseBaseUrl(env)` — matches design precedence `LANGFUSE_BASEURL ?? LANGFUSE_HOST`.

One naming note for A2 (not a deviation, a placement decision): `AiTracingDeps` and
`TracingHandler` both live in `apps/api/src/ai/langfuse-handler.ts` (not a separate shared file) —
the design's comment "shared injection bag for both attachment sites" did not pin a file. A2 should
import `AiTracingDeps` from `./langfuse-handler.js` for `PlanSpecExtractionAdapter`'s third
constructor argument, exactly as `adapter-factory.ts` does.

### What A1 deliberately left for later slices

- No `ResolvePrompt`, no `LangfusePromptGateway`, no remote template fetch/validation, no renderer
  split, no `promptSource`/`promptLinked` attribution, no `prompt-linked-chain.ts`. All of that is
  B1/B2/C scope, untouched here.
- `PlanSpecExtractionAdapter` (`streamReply`/`extract`) does NOT yet receive `deps` — that is A2.
  The same `langfuseHandler` instance built in `app.ts` is ready to be threaded into it once A2
  adds the third constructor argument.
- `docker-compose.yml`, the prompt template constants, `mask()` relocation, and
  `remote-template-validation.ts` are untouched (B1/B2 scope).

### Gate Evidence

Orchestrator-verified (per team-lead message), consistent with what this executor observed before
going idle:

- `pnpm -r test` — apps/api: 163 test files, 1957 passed, 116 skipped; apps/web: 155 test files,
  1640 passed. All green.
- `pnpm --filter api test:coverage` — 163 test files, 1957 passed, 116 skipped, exit 0. Functions
  coverage **88.08%** (gate 85%, up from the pre-slice baseline of ~86.84%); `langfuse-handler.ts`
  itself measures 100% functions.
- `pnpm type-check` — all 7 workspace projects, Done, no errors.
- `pnpm build` — deps-guard ✅, ui-api-guard ✅, architecture (0 dependency violations across 1998
  modules / 5975 dependencies) ✅, every package/app `tsc`/`next build` Done.
- PR #368 diff ≈632 changed lines (code only, excluding the `openspec/` planning-artifact commit) —
  under the 800-line budget.

### Open items

- **Production Langfuse credential validity has NOT been exercised yet.** That only happens once
  PR #368 merges and deploys — this slice is deliberately deploy-safe either way: it either
  produces the first real trace this project has ever emitted, or exactly one secret-free
  auth-failure log line. Nothing else about generation/chat behaviour changes.
- PR #368 is open, reviewed by no one yet, not merged. A2 must NOT branch until A1 merges
  (`stacked-to-main`: no child branches from an unmerged parent).

**Update (recorded by A2's executor):** by the time A2 ran, A1's PR #368 HAD merged to `main` as
squash commit `2bd7fc5` — the note above ("A2 must NOT branch until A1 merges") was respected, it
just wasn't reflected in this file at the time A1 went idle. See the Slice A2 section below.

## Slice A2 — Extraction-Adapter Tracing

**Status: DONE.** All A2.1–A2.7 tasks in `tasks.md` are complete; none deferred, none left unchecked.

- Prerequisite state confirmed before branching: A1's PR #368 was MERGED to `main` as squash commit
  `2bd7fc5`, and `main` was pulled fresh before branching (`stacked-to-main`, no child branch off an
  unmerged parent).
- Branch: `feat/langfuse-extraction-adapter-tracing` (from `main`).
- PR: https://github.com/kno/kInorA/pull/370 — base `main`, `chain_strategy: stacked-to-main`. Open,
  NOT merged. Do not merge from this file's authority; the orchestrator owns the review/merge
  lifecycle.
- 3 work-unit commits on the branch, in this order: (1) RED — the two failing handler-attachment
  test cases added to `extraction-adapter.test.ts` (2 of 12 cases red before any implementation
  changed); (2) GREEN — the `deps` constructor arg + conditional `callbacks` spread + `app.ts`
  wiring + docstring rewrite; (3) a follow-on type-check fix (`ExtractionChatModel`'s call-options
  type loosened to `Record<string, unknown>`) needed for `pnpm type-check` to pass, since real
  provider classes' own call-options types declare `callbacks?: Callbacks` from `@langchain/core`
  and were no longer structurally assignable to the stricter `ExtractionCallOptions` once a
  `callbacks` field existed there. RED is independently verifiable in git history: the RED commit
  contains only test changes and 2 of 12 `extraction-adapter.test.ts` cases fail against the
  pre-A2 `extraction-adapter.ts`.

### Task-by-task (tasks.md A2.1–A2.7)

- [x] A2.1 — RED: `streamReply` cases added — attaches `callbacks: [handler]` when a handler is
  injected via the (then not-yet-existing) third constructor arg; omits the `callbacks` key
  entirely when not. Confirmed failing (2/12 red) before any production-code change.
- [x] A2.2 — RED: same two cases for `extract`, in the same commit.
- [x] A2.3 — RED/GREEN (same test): masking-with-tracing-attached case (`buildAdapter(..., {
  handler: FAKE_HANDLER })`) asserting both payloads still show `[REDACTED]` for a KNOWN limitation
  and NOT the raw term, plus `signal`/`runName`/`metadata` unchanged by the new `deps` arg — this
  case actually passed at RED time too (JS ignores an unused third constructor argument at
  runtime), so it never needed a GREEN-time fix; documented rather than silently accepted, per the
  design's testing-strategy intent.
- [x] A2.4 — GREEN: third constructor arg `deps?: AiTracingDeps` added to
  `PlanSpecExtractionAdapter`; conditional `callbacks` spread applied at both `streamReply` and
  `extract`, identical idiom to `invokeChain`'s A1 wiring; the stale "NO input-capturing callback
  handler is attached" docstring (lines ~41-49 pre-edit) rewritten to document the A2 override,
  mirroring the treatment A1 gave `adapter-factory.ts:28-35`.
- [x] A2.5 — GREEN: `app.ts`'s `PlanSpecExtractionAdapter` construction site now passes the SAME
  `aiTracingDeps` object A1 already builds (used for `buildAdapters(aiTracingDeps)`) as the third
  constructor argument — no second handler instance is built.
- [x] A2.6 — REFACTOR: confirmed `invokeChain` (`adapter-factory.ts`) and both extraction-adapter
  call sites share the identical `...(handler ? { callbacks: [handler] } : {})` spread — no
  divergence between the three attachment sites (one in `adapter-factory.ts`, two in
  `extraction-adapter.ts`).
- [x] A2.7 — Verify: all gates green (see Gate Evidence below). No regression in any route/
  integration suite with no credentials set (handler stays `null` end-to-end).

### Files modified

- `apps/api/src/ai/extraction-adapter.ts` — third constructor arg `deps?: AiTracingDeps`; `streamReply`
  and `extract` each spread `...(handler ? { callbacks: [handler] } : {})` into their LangChain call
  options; `ExtractionCallOptions` gains an optional `callbacks?: unknown[]` field (untyped, since it
  is forwarded verbatim into real LangChain call options whose `Callbacks` type would require
  importing `@langchain/core`'s callback types just for this structural field); `ExtractionChatModel`'s
  `stream`/`withStructuredOutput().invoke` parameter type changed from `ExtractionCallOptions` to a
  loose `Record<string, unknown>` (mirrors `invokeChain`'s `chain.invoke` parameter in
  `adapter-factory.ts`) — needed because the real `ChatOpenAI`/`ChatAnthropic`/`ChatGoogleGenerativeAI`
  classes returned by `buildExtractionModelFactory()` declare their own stricter call-options types
  with a `callbacks?: Callbacks` field, which stopped being structurally assignable to
  `ExtractionCallOptions` once THAT interface also declared a (differently-typed) `callbacks` field;
  the class-level docstring rewritten (was: "NO input-capturing callback handler is attached").
- `apps/api/src/app.ts` — `PlanSpecExtractionAdapter`'s constructor call now passes `aiTracingDeps`
  (the same object built once for A1's `buildAdapters(aiTracingDeps)`) as the third argument.
- `apps/api/src/ai/__tests__/extraction-adapter.test.ts` — new `describe` block ("tracing attachment
  (langfuse-prompt-management, slice A2)") with the three A2.1–A2.3 cases; `buildAdapter()` helper
  extended to accept an optional `AiTracingDeps` second argument; a `FAKE_HANDLER: TracingHandler`
  fixture added (no real Langfuse client).
- `openspec/changes/16e-langfuse-prompt-management/tasks.md` — A2.1–A2.7 marked `[x]`; A2 status
  note added.

### Interface/signature conformance to design.md

- `AiTracingDeps` is imported from `apps/api/src/ai/langfuse-handler.ts` exactly as A1's own note
  for A2 specified — not redefined elsewhere.
- The conditional-spread idiom at both new attachment sites is byte-identical in shape to
  `invokeChain`'s A1 wiring (`design.md`'s "Null-handler degradation" architecture decision).
- One deviation from a literal reading of the design's `ExtractionChatModel`/`ExtractionCallOptions`
  shapes (these predate this change and were not in design's `## Interfaces / Contracts` new-shapes
  list): `ExtractionChatModel`'s method parameter type was loosened from `ExtractionCallOptions` to
  `Record<string, unknown>` to keep `pnpm type-check` green — this is a widening (permissive) change,
  not a narrowing, and `ExtractionCallOptions` itself is unchanged in shape for every caller/test
  that constructs one. No design requirement references either type by name, so this is recorded
  here for B1/B2/C's awareness rather than as a deviation requiring sign-off.

### What A2 deliberately left for later slices

- Masking still runs INSIDE `buildReplyPrompt`/`buildExtractionPrompt` at this point in the chain —
  the relocation of `mask()` to the call sites (matching the plan-generation path) is B1 scope, not
  A2. A2's masking test (A2.3) therefore covers an ALREADY-KNOWN limitation only, exactly as scoped;
  it does not (and must not) assert the first-mention gap is masked.
- No renderer, no template constants, no remote prompt source, no `promptSource`/`promptLinked`
  attribution, no `prompt-linked-chain.ts`. All of that remains B1/B2/C scope, untouched here.
- `docker-compose.yml` untouched (B2 scope).

### Gate Evidence

- `pnpm -r test` — apps/api: 163 test files, 1963 passed, 116 skipped (up from A1's 1957/116 — the
  10 new A2.1–A2.3 test cases account for the +6 net after de-duplication with pre-existing cases
  reused); apps/web: 155 test files, 1640 passed; apps/mobile: 53 test files, 467 passed; all
  packages (contracts/domain/i18n/exercise-catalog) green. All green, no failures.
- `pnpm --filter api test:coverage` — 163 test files, 1963 passed, 116 skipped, exit 0. Functions
  coverage **88.1%** (gate 85%), unchanged from A1's post-slice baseline (A2 added test cases to an
  already-covered class, no new uncovered functions).
- `pnpm type-check` — all 7 workspace projects, Done, no errors (after the `ExtractionChatModel`
  call-options widening described above).
- `pnpm build` — deps-guard, ui-api-guard, architecture (0 dependency violations), every
  package/app `tsc`/`next build` — all Done, exit 0.
- PR #370 code diff is well under the ~135-line forecast and the 800-line budget (three small,
  scoped commits: RED test additions, GREEN implementation, one type-fix).

### Open items

- A1's PR #368 was merged to `main` as squash commit `2bd7fc5` before A2 branched — confirmed via
  `git log` at branch time. `stacked-to-main` was respected: A2 branched from freshly-pulled `main`,
  not from A1's now-stale feature branch. B1 must NOT branch until A2's PR #370 merges to `main`.
- Production Langfuse credential validity for the CHAT path specifically remains unexercised until
  A2 deploys — same deploy-safe posture A1 documented: either a real trace or one secret-free
  auth-failure log line, no behavioural change either way.

## Slice B1 — Renderer + Template Split + Masking Relocation

**Status: DONE.** All B1.1–B1.11 tasks in `tasks.md` are complete; none deferred, none left unchecked.

- Prerequisite state confirmed before branching: A2's PR #370 was MERGED to `main` as squash commit
  `d132d99`, and `main` was pulled fresh before branching (`stacked-to-main`, no child branch off an
  unmerged parent).
- Branch: `feat/langfuse-prompt-renderer` (from `main`).
- PR: opened against `main` (see the PR URL reported alongside this record). `chain_strategy:
  stacked-to-main`. Open, NOT merged. Do not merge from this file's authority; the orchestrator owns
  the review/merge lifecycle.
- 5 work-unit commits on the branch, RED separated from GREEN throughout:
  1. RED — `prompt-template.test.ts` (renderer unit tests), confirmed failing (module did not exist).
  2. GREEN — `apps/api/src/ai/prompt-template.ts` created (`renderTemplate`, `templateVariablesOf`,
     `PromptDefinition`, `TEMPLATE_MARKER_OPEN`).
  3. RED — byte-identical/snapshot tests added to `prompt.test.ts` referencing
     `PLAN_PROMPT_TEMPLATE`/`buildPlanPromptVariables` (did not exist yet), confirmed failing (7/47
     new cases red, existing 40 still green).
  4. GREEN — `prompt.ts` split: `PLAN_PROMPT_TEMPLATE`, `PLAN_PROMPT_DEFINITION`,
     `buildPlanPromptVariables(spec)`; `buildPlanPrompt` becomes the thin `renderTemplate` wrapper.
     All 47 tests pass, 7 snapshots written.
  5. RED — byte-identical/snapshot tests added to `extraction-prompt.test.ts` referencing
     `REPLY_PROMPT_TEMPLATE`/`EXTRACTION_PROMPT_TEMPLATE`/`buildReplyPromptVariables`/
     `buildExtractionPromptVariables` (did not exist yet), confirmed failing (6/33 new cases red).
  6. GREEN (combined, see note below) — `extraction-prompt.ts` split into templates + variables
     producers; `mask()` removed from both chat builders; `extraction-adapter.ts` now masks the
     rendered string at both call sites (`streamReply`, `extract`); the in-builder masking assertions
     moved from `extraction-prompt.test.ts` to a new
     `describe("PlanSpecExtractionAdapter masking relocation (langfuse-prompt-management, slice B1)")`
     block in `extraction-adapter.test.ts`.

**Deviation from the strict per-substep RED/GREEN convention, documented rather than silently
accepted:** commit 6 combines B1.7 (template extraction, still masked) and B1.8/B1.9 (mask
relocation) into one GREEN commit, instead of three separate commits. Reason: the byte-identical
test design in `extraction-prompt.test.ts` (commit 5's RED) compares raw `renderTemplate(...)`
output — with NO mask applied inside the test helper — against `buildReplyPrompt`/
`buildExtractionPrompt`'s own output. That equality only holds once the builders themselves stop
masking, so an intermediate "template split, still masked" GREEN state would have made those exact
RED tests fail for the wrong reason (a masking mismatch, not a missing export) and then pass a
second time after an unrelated follow-up commit — a confusing, not more auditable, git history. The
"still masked" intermediate state was manually verified transiently during implementation (confirmed
it reproduces byte-identical output before mask relocation) but never committed on its own. RED
(commit 5) and GREEN (commit 6) remain properly separated; only B1.7/B1.8/B1.9's internal boundary is
collapsed.

### Task-by-task (tasks.md B1.1–B1.11)

- [x] B1.1 — RED: `prompt-template.test.ts` (9 cases: substitution, repeated variable, empty-string
  variable, unknown marker left intact, no-marker template, purity, `templateVariablesOf` extraction,
  `TEMPLATE_MARKER_OPEN` literal). Confirmed failing (module not found) before B1.2.
- [x] B1.2 — GREEN: `apps/api/src/ai/prompt-template.ts` — `renderTemplate` (split/join per variable,
  literal, never throws), `templateVariablesOf` (regex-based, first-seen order, de-duplicated),
  `PromptDefinition` interface (exact shape from design's Interfaces/Contracts block),
  `TEMPLATE_MARKER_OPEN = "{{"`.
- [x] B1.3 — RED: 7 byte-identical/snapshot cases added to `prompt.test.ts` (no memory / with memory /
  `allowedExercises` empty / non-empty / `intensityBias` reduce/increase/maintain). Confirmed failing
  before B1.4 (`buildPlanPromptVariables`/`PLAN_PROMPT_TEMPLATE` did not exist).
- [x] B1.4 — GREEN: `PLAN_PROMPT_TEMPLATE` extracted verbatim (including the em dash in "SAFETY AND
  SCOPE RULES" and the en dash in "0–1 weights"); `buildPlanPromptVariables(spec)` computes the exact
  same 14 values the old inline builder computed (`equipmentList`, `limitationsSection`,
  `intensityBiasSection`, `memorySection`, `vocabularySection`, `taskExerciseRule`, plus the 8 scalar
  fields); `PLAN_PROMPT_DEFINITION` matches design's variable/marker table exactly; `buildPlanPrompt`
  is now `renderTemplate(PLAN_PROMPT_TEMPLATE, buildPlanPromptVariables(spec)).trim()`.
- [x] B1.5 — `toMatchSnapshot()` added to all 7 B1.3 cases; 7 snapshots written on first GREEN run.
- [x] B1.6 — RED: 6 byte-identical/snapshot cases added to `extraction-prompt.test.ts` (reply: base /
  empty draft / memory; extraction: base / empty draft / memory). Confirmed failing before B1.7/B1.9
  (both the missing exports AND, transiently, the masking mismatch described above).
- [x] B1.7 — GREEN: `REPLY_PROMPT_TEMPLATE`/`EXTRACTION_PROMPT_TEMPLATE` +
  `REPLY_PROMPT_DEFINITION`/`EXTRACTION_PROMPT_DEFINITION` extracted verbatim in
  `extraction-prompt.ts`; `buildReplyPromptVariables`/`buildExtractionPromptVariables` added;
  `limitationTermsOf` exported (was file-private).
- [x] B1.8 — RED (folded into commit 5, see deviation note): the byte-identical tests assert the
  UNMASKED renderer output equals the builder's own output, which is only true once masking is
  removed from the builder — this IS the masking-relocation RED signal for this slice.
- [x] B1.9 — GREEN: `mask(...)` removed from inside `buildReplyPrompt`/`buildExtractionPrompt` (both
  now return `renderTemplate(...).trim()` with no masking); grepped for other callers before removing
  — `extraction-adapter.ts` is the ONLY caller of either function outside tests, confirmed via
  `grep -rn "buildReplyPrompt\|buildExtractionPrompt" apps/api/src`; `extraction-adapter.ts` updated
  to `mask(buildReplyPrompt(input), limitationTermsOf(input))` /
  `mask(buildExtractionPrompt(input, assistantReply), limitationTermsOf(input))` at its two call
  sites, mirroring `invokeChain`'s A1 masking idiom exactly.
- [x] B1.10 — REFACTOR: confirmed via `grep -rn "mask(" apps/api/src` (excluding tests/mask.ts itself)
  that the LLM-trace-payload masking now runs at exactly two files/three call sites total:
  `adapter-factory.ts`'s `invokeChain` (plan prompt) and `extraction-adapter.ts`'s `streamReply` +
  `extract` (both chat prompts). `generation-service.ts:504`'s `mask(...)` call is a PRE-EXISTING,
  unrelated usage (memory-retrieval query text, not a trace payload) and is out of this slice's scope
  — not counted against the "two invocation sites" design claim, which is specifically about the
  three LLM-prompt/trace-payload masking points A1/A2/B1 designed for.
- [x] B1.11 — Verify: all gates green (see Gate Evidence below); `prompt.test.ts` (47 tests) and
  `extraction-prompt.test.ts` (27 tests, 6 relocated to `extraction-adapter.test.ts`) content
  assertions unchanged and passing.

### Files created

- `apps/api/src/ai/prompt-template.ts` — `renderTemplate`, `templateVariablesOf`, `PromptDefinition`,
  `TEMPLATE_MARKER_OPEN`.
- `apps/api/src/ai/__tests__/prompt-template.test.ts`.
- `apps/api/src/ai/__tests__/__snapshots__/prompt.test.ts.snap` (7 snapshots).
- `apps/api/src/ai/__tests__/__snapshots__/extraction-prompt.test.ts.snap` (6 snapshots).

### Files modified

- `apps/api/src/ai/prompt.ts` — `PLAN_PROMPT_TEMPLATE`, `PLAN_PROMPT_DEFINITION`,
  `buildPlanPromptVariables(spec)` exported; `buildPlanPrompt` is now the thin render wrapper.
- `apps/api/src/ai/extraction-prompt.ts` — `REPLY_PROMPT_TEMPLATE`/`EXTRACTION_PROMPT_TEMPLATE` +
  their `PromptDefinition`s + `buildReplyPromptVariables`/`buildExtractionPromptVariables` added;
  `limitationTermsOf` exported; `mask` import removed (no longer used in this file);
  `buildReplyPrompt`/`buildExtractionPrompt` now return UNMASKED text; file-level docstring rewritten
  to describe the new masking-relocation contract.
- `apps/api/src/ai/extraction-adapter.ts` — imports `limitationTermsOf` + `mask`; both `streamReply`
  and `extract` now wrap their prompt in `mask(..., limitationTermsOf(input))`; class-level docstring
  rewritten to describe the B1 masking relocation (supersedes the A2-era docstring, which described
  masking as already happening inside the builders).
- `apps/api/src/ai/__tests__/prompt.test.ts` — 7 new byte-identical/snapshot cases added; all existing
  content assertions untouched.
- `apps/api/src/ai/__tests__/extraction-prompt.test.ts` — 6 new byte-identical/snapshot cases added;
  6 masking-specific assertions REMOVED (moved to `extraction-adapter.test.ts`); the
  `sanitizeMemoryContext`-specific assertions (which check literal `[REDACTED]` inserted by
  `sanitizeMemoryContext`, unrelated to `mask()`) were KEPT — they are unaffected by the masking
  relocation since that redaction happens in the variables producer, not via `mask()`.
- `apps/api/src/ai/__tests__/extraction-adapter.test.ts` — new
  `describe("PlanSpecExtractionAdapter masking relocation (langfuse-prompt-management, slice B1)")`
  block with 4 cases: known-limitation masked in both passes; known term masked even when repeated in
  the user's message; known term masked even inside the seeded assistant reply; first-mention phrase
  NOT masked in either pass (accurate, not a bug).
- `openspec/changes/16e-langfuse-prompt-management/tasks.md` — B1.1–B1.11 marked `[x]`.

### Interface/signature conformance to design.md

No deviation from `design.md`'s `## Interfaces / Contracts` section or the variable-sets table for
the B1-scoped shapes:

- `PromptDefinition`, `renderTemplate`, `templateVariablesOf`, `TEMPLATE_MARKER_OPEN` — exact match.
- `PLAN_PROMPT_DEFINITION`/`REPLY_PROMPT_DEFINITION`/`EXTRACTION_PROMPT_DEFINITION` — variable sets,
  `requiredMarkers`, and `orderedMarkers` match the design's variable-sets table exactly, including
  the marker ORDER contract (`{{limitationsSection}}` → `{{memorySection}}` →
  `{{vocabularySection}}` → `TASK:` → `{{taskExerciseRule}}` for the plan prompt) that B2's validation
  algorithm will check.
- The #352 closed-vocabulary contract preserved exactly: `vocabularySection` and `taskExerciseRule`
  both emit `""`/the free-text rule when `allowedExercises` is empty, and the block + back-reference
  together when non-empty — proven byte-identical by the B1.3 snapshot tests, not just asserted.
- Whitespace contract preserved: `{{memorySection}}{{vocabularySection}}` remain adjacent with NO
  separator in the template; each section carries its own leading newlines when non-empty.
- Non-ASCII characters preserved verbatim (em dash, en dash) — confirmed by the byte-identical tests
  passing without a normalizing editor having touched them.
- `mask` now runs at exactly two invocation sites (`invokeChain`, `extraction-adapter.ts`'s two call
  sites) for all three prompts, per design's "Where `mask` runs" architecture decision.

### What B1 deliberately left for later slices

- No `RemoteTemplateSchema`, no `validateRemoteTemplate`, no `LangfusePromptGateway`, no
  `ResolvePrompt`, no `promptSource`/`promptLinked` attribution, no `prompt-linked-chain.ts`. All of
  that is B2/C scope, untouched here.
- `docker-compose.yml` untouched (B2 scope).
- The plan-generation masking call site (`adapter-factory.ts`'s `invokeChain`) was NOT modified — it
  already masked at the call site since A1; B1 only changed how `buildPlanPrompt` itself is composed
  internally (template + variables producer), not where it is invoked or masked.

### Gate Evidence

- `pnpm -r test` — apps/api: 164 test files, 1983 passed, 116 skipped; apps/web: 155 test files, 1640
  passed; apps/mobile: 53 test files, 467 passed; packages (contracts/domain/i18n/exercise-catalog)
  all green. All green, no failures, exit 0.
- `pnpm --filter api test:coverage` — 164 test files, 1983 passed, 116 skipped, exit 0. Functions
  coverage **88.19%** (gate 85%), up slightly from A2's post-slice baseline of 88.1% (new pure
  functions in `prompt-template.ts`/`prompt.ts`/`extraction-prompt.ts` are fully covered by the
  byte-identical + unit tests).
- `pnpm type-check` — all 7 workspace projects, Done, no errors.
- `pnpm build` — deps-guard ✅, ui-api-guard ✅ (48 client files scanned, no violations), architecture
  (0 dependency violations across 2000 modules / 5983 dependencies) ✅, architecture negative guard
  ✅, every package/app `tsc`/`next build` Done, exit 0.
- `git diff --stat main...HEAD` — **724 changed lines** (569 insertions + 155 deletions) across the 8
  hand-authored source/test files, EXCLUDING the two generated `.snap` snapshot files (481 lines,
  auto-written by `toMatchSnapshot()`, not hand-authored diff). Including the snapshots the raw stat
  is 1205 changed lines. 724 is under the 800-line budget; the review workload forecast's own
  estimate (~730) assumed generated snapshot content would not count toward the budget the same way
  hand-authored diff does — consistent with how A1 excluded the `openspec/` planning-artifact commit
  from its own reported total. **Flagging this explicitly for the orchestrator/reviewer to confirm**:
  if snapshot lines ARE meant to count, the raw total (1205) exceeds 800 and this slice may need the
  B1a/B1b split the design already named as the fallback seam. No further split was performed
  pre-emptively per the team-lead's explicit instruction ("Do not pre-split unless review actually
  flags it").

### Open items

- **Budget measurement ambiguity (see Gate Evidence above)** — the orchestrator/reviewer must confirm
  whether the ~730-line forecast (and the 800-line budget itself) is meant to include or exclude
  generated snapshot file content before deciding whether this PR needs the B1a/B1b split. This
  executor did NOT pre-split, per explicit instruction.
- A2's PR #370 was merged to `main` as squash commit `d132d99` before B1 branched — confirmed via
  `git log` at branch time. `stacked-to-main` was respected: B1 branched from freshly-pulled `main`.
  B2 must NOT branch until B1's PR merges.
- Production Langfuse credential validity remains unexercised for B1 specifically — B1 has NO remote
  fetch path yet (that is B2), so this is unaffected by B1 and stays exactly as A1/A2 left it.

### Orchestrator ruling and independent byte-identity proof (B1)

**Budget ruling: 724 is the number that governs; no B1a/B1b split is needed.** The 800-line budget
exists to protect reviewer attention. A generated `.snap` file is not read line by line during
review — it is an assertion artifact, regenerated mechanically — so its 481 lines do not consume
review attention proportionally to hand-authored code. B1 ships as one PR.

**The in-branch "byte-identical" tests could not prove byte-identity, and the snapshots as committed
do not either.** Both `.snap` files were written in the GREEN commits (`14012e3`, `d1b7252`), i.e.
AFTER the refactor, so they freeze the POST-refactor output. And the in-branch assertion compares
`renderTemplate(TEMPLATE, buildXPromptVariables(...))` against `buildXPrompt(...)`, which after the
refactor IS that same render — a tautology. This is not the executor's error: once the old function
is gone, there is nothing left in-tree to compare against.

**Independently proven by the orchestrator instead.** The pre-refactor `prompt.ts` and
`extraction-prompt.ts` were materialized from `main` (`git show main:<path>`) into the same directory
so every relative import resolved unchanged, and a temporary suite asserted equality across:

- 11 plan-prompt cases — bare, no equipment, with limitations, with memory, memory requiring
  sanitization, `allowedExercises` empty, `allowedExercises` present, each of the three
  `intensityBias` values, and all of them combined.
- 4 chat-context cases × both chat prompts, comparing `mask(newOutput, limitationTermsOf(input))`
  against the legacy output (the legacy builders masked internally; the new ones do not, so masked
  new output is the correct comparand).

Result: **19/19 passed — the refactor is byte-identical.** The temporary files were then deleted and
are deliberately NOT committed: they depend on vendored copies of superseded code that would rot.
With equality now established, the committed snapshots become a valid FORWARD drift guard — they
freeze output that is proven equal to pre-refactor behaviour.

**Convention for later slices:** a refactor claiming byte-identity must capture the baseline BEFORE
the refactor lands (write the snapshot in the RED commit, while the old implementation is still the
one producing it), or the claim cannot be verified afterwards from the tree alone.

## Slice B2a — Remote Prompt Source: Port + Gateway + Validation

**Status: DONE.** B2.1–B2.6 in `tasks.md` are complete. B2.7–B2.20 are **B2b**, not started on this
branch — see "Open items" below.

- Prerequisite state confirmed before branching: B1's PR was MERGED to `main` as squash commit
  `835ca73`, and `main` was pulled fresh before branching (`stacked-to-main`, no child branch off an
  unmerged parent).
- **B2 was originally implemented as one 13-commit branch** (`feat/langfuse-remote-prompt-source`,
  from `main`) covering the full B2.1–B2.19 scope. Its real diff measured **956 hand-authored changed
  lines** (`git diff --stat main...HEAD -- . ':!openspec'`) against the 800-line budget — no generated
  snapshot content to exclude this time (unlike B1), so the full total counts. The orchestrator ruled:
  split at the existing commit boundary the design already named (B2a = port + gateway + validation;
  B2b = `ResolvePrompt` + call-site wiring + compose/README), per the collected `delivery_strategy:
  auto-chain` (split automatically on budget risk, no `size:exception` request, no user prompt needed).
- **B2a branch**: `feat/langfuse-prompt-gateway`, created via `git branch feat/langfuse-prompt-gateway
  47bd638` — i.e. branched from the combined branch's own history at the exact commit where the
  gateway's GREEN commit landed, so it carries precisely the 6 RED/GREEN commits below and nothing
  from B2b. PR against `main`, referencing #366, stating it is slice B2a after #368/#370/#371 and that
  B2b depends on it. Open, NOT merged. Do not merge from this file's authority.
- 6 commits, RED separated from GREEN throughout, in this order:
  1. RED — `remote-template-validation.test.ts` (10 cases, one per `PromptRejectionReason` this
     module owns, plus `checkRenderedTemplate`/`RemoteTemplateSchema` coverage), confirmed failing
     (module did not exist).
  2. GREEN — `apps/api/src/ai/remote-template-validation.ts` created.
  3. RED — `prompt-source-port.test.ts` (`PromptNotFoundError` — the one runtime symbol this port
     module owns), confirmed failing.
  4. GREEN — `apps/api/src/ai/prompt-source-port.ts` created.
  5. RED — `langfuse-prompt-gateway.test.ts` (5 cases: null with no credentials, correct SDK call
     shape incl. verified 2nd-positional `version` arg, no explicit `baseUrl` when unset, 404→
     `PromptNotFoundError` mapping, other failures rethrown unchanged), confirmed failing.
  6. GREEN — `apps/api/src/ai/langfuse-prompt-gateway.ts` created.

### Task-by-task (tasks.md B2.1–B2.6)

- [x] B2.1 — RED: table-driven `remote-template-validation.test.ts` — one case per
  `PromptRejectionReason` this module owns (`payload_not_string`, `payload_empty`,
  `payload_too_large`, `unknown_variable`, `missing_required_placeholder`, `marker_order_violated`
  with an explicit "rejected whole, not repaired" assertion, `unresolved_marker_after_render`), plus
  an accept case and a `RemoteTemplateSchema` size-cap case. Confirmed failing (module not found).
- [x] B2.2 — GREEN: `RemoteTemplateSchema(def)` (zod `z.string().min(1).max(def.maxTemplateChars)`),
  `validateRemoteTemplate(def, payload)` implementing steps 1–4 of the design's ordered algorithm
  (payload shape → unknown variable → required markers present → marker order strictly increasing),
  first failure wins. Step 5 (post-render `{{` sweep) is deliberately NOT inside
  `validateRemoteTemplate` — see "Interface/signature conformance" below for why — and ships as a
  separate exported `checkRenderedTemplate(rendered)` in the SAME file, covered by the SAME test file.
- [x] B2.3 — RED: `prompt-source-port.test.ts` — one case, since `LangfusePromptGateway`/
  `PromptResolution` are structural interfaces with no runtime behavior to test; `PromptNotFoundError`
  is the one runtime symbol this module owns. Confirmed failing (module not found).
- [x] B2.4 — GREEN: `apps/api/src/ai/prompt-source-port.ts` — `LangfusePromptGateway` interface,
  `PromptResolution` type, and `PromptNotFoundError` (a named error class the gateway throws on a
  404, so `ResolvePrompt` — B2b — can distinguish it from a generic fetch failure without inspecting
  the real SDK's error shape).
- [x] B2.5 — RED: `langfuse-prompt-gateway.test.ts` — null with no credentials (both missing-key
  cases); constructs `Langfuse` with the resolved `baseUrl` and calls `getPrompt(name, undefined,
  { label, cacheTtlSeconds: 0, fetchTimeoutMs })` — version as the verified 2nd POSITIONAL arg;
  omits `baseUrl` when neither `LANGFUSE_BASEURL` nor `LANGFUSE_HOST` is set; normalizes a 404 HTTP
  fetch error into `PromptNotFoundError`; rethrows any other failure (network/auth) unchanged.
  Confirmed failing (module not found).
- [x] B2.6 — GREEN: `apps/api/src/ai/langfuse-prompt-gateway.ts` — `buildLangfusePromptGateway()` →
  port `|` `null` (mirrors `buildLangfuseCallbackHandler`'s safe-by-construction null-on-no-credentials
  pattern), `PROMPT_FETCH_TIMEOUT_MS = 3000` hardcoded (no second env var, per design decision), and
  the 404→`PromptNotFoundError` normalization read directly off the installed `langfuse-core`
  `LangfuseFetchHttpError` shape (`.response.status`) verified in `design.md`'s SDK verification table.

### Files created

- `apps/api/src/ai/remote-template-validation.ts` — `RemoteTemplateSchema`, `validateRemoteTemplate`,
  `checkRenderedTemplate`, `PromptRejectionReason`, `TemplateValidationResult`.
- `apps/api/src/ai/__tests__/remote-template-validation.test.ts`.
- `apps/api/src/ai/prompt-source-port.ts` — `LangfusePromptGateway`, `PromptResolution`,
  `PromptNotFoundError`.
- `apps/api/src/ai/__tests__/prompt-source-port.test.ts`.
- `apps/api/src/ai/langfuse-prompt-gateway.ts` — `buildLangfusePromptGateway()`,
  `PROMPT_FETCH_TIMEOUT_MS`.
- `apps/api/src/ai/__tests__/langfuse-prompt-gateway.test.ts`.

### Interface/signature conformance to design.md

- `RemoteTemplateSchema`, `PromptRejectionReason`, `LangfusePromptGateway`, `PromptResolution` — exact
  match to design's `## Interfaces / Contracts` block.
- **One placement decision, not a deviation:** design's `## Interfaces / Contracts` shows
  `validateRemoteTemplate(def, payload)` with no `variables` parameter, so it cannot itself perform
  the design's validation-algorithm step 5 (post-render `{{` sweep), which requires the ACTUAL
  rendered output — only producible once real variable values are available. B2a therefore splits the
  five-step algorithm across two functions in the SAME file: `validateRemoteTemplate` (steps 1–4,
  pre-render) and a new `checkRenderedTemplate(rendered)` (step 5, post-render). `ResolvePrompt`
  (B2b) calls `renderTemplate` then `checkRenderedTemplate` after `validateRemoteTemplate` passes.
  This keeps all ten `PromptRejectionReason` cases table-driven in one test file per tasks.md's B2.1
  list, without inventing a signature the design never specified.
- `PromptNotFoundError` is a B2a-introduced symbol not named in design's Interfaces block. It exists
  to let `langfuse-prompt-gateway.ts` (B2a) and `prompt-provider.ts`'s `ResolvePrompt` (B2b) agree on
  how a missing-prompt failure is distinguished from a generic fetch failure, without `ResolvePrompt`
  needing to inspect the real Langfuse SDK's `LangfuseFetchHttpError`/`.response.status` shape
  directly — that inspection is fully contained in the gateway adapter, exactly where the design's
  File Changes table says the SDK-specific logic belongs.
- `getPrompt(name, undefined, { label, cacheTtlSeconds: 0, fetchTimeoutMs })` — no `type` key passed;
  omitting it resolves to the SDK's `type?: "text"` overload (verified against the installed
  `langfuse-core@3.38.20` `.d.ts`), matching the design's exact call spec.

### What B2a deliberately left for B2b

- No `ResolvePrompt`, no `resolvePromptCacheTtlMs`, no TTL cache, no burst coalescing, no fallback
  caching. Nothing calls `LangfusePromptGateway.fetchPrompt` yet — the gateway and validator exist but
  are UNWIRED. Behaviour is therefore completely unchanged from before this slice: no remote fetch
  ever happens, because nothing in the request path constructs or calls a `LangfusePromptGateway`.
- No `AiTracingDeps.prompts` field, no wiring at `invokeChain`/`extraction-adapter.ts`/`app.ts`, no
  `promptSource` metadata attribution, no `docker-compose.yml`/README changes. All B2b.
- Confirmed NOT dead code by the architecture/build gates: `remote-template-validation.ts` is imported
  by its own test only (B2b will import it from `prompt-provider.ts`); `prompt-source-port.ts`'s types
  are imported by `langfuse-prompt-gateway.ts` (real, non-test usage) and its test; the dependency-
  cruiser architecture guard (`pnpm build`'s `architecture` step) reports 0 violations with these
  three new files present, so nothing here trips an unused-export or layering rule. TypeScript's
  `noUnusedLocals`/`noUnusedParameters` (if enabled) would flag a truly dead export at `tsc --noEmit`
  time, and that gate is green — see Gate Evidence below.

### Gate Evidence (B2a-only tree, re-measured on THIS branch — NOT carried over from the combined B2 branch)

- `pnpm -r test` — apps/api: 167 test files, 1999 passed, 116 skipped; apps/web: 155 test files, 1640
  passed; apps/mobile: 53 test files, 467 passed; packages (contracts/domain/i18n/exercise-catalog)
  all green. All green, no failures.
- `pnpm --filter api test:coverage` — 167 test files, 1999 passed, 116 skipped, exit 0. Functions
  coverage **88.03%** (gate 85%).
- `pnpm type-check` — all 7 workspace projects, Done, no errors.
- `pnpm build` — deps-guard ✅, ui-api-guard ✅ (48 client files scanned, no violations), architecture
  (0 dependency violations across 2006 modules / 5996 dependencies) ✅, architecture negative guard ✅,
  every package/app build Done, exit 0.
- `git diff --stat main...HEAD -- . ':!openspec'` — **411 changed lines** (411 insertions, 0
  deletions) across the 6 new files (3 source, 3 test) — well under the 800-line budget.

### Open items

- **B2b is held, NOT started on a pushed branch yet.** `feat/langfuse-remote-prompt-source` (the
  original 13-commit branch) still exists locally with all 13 commits; once B2a's PR merges to
  `main`, that branch must be REBASED onto the updated `main` so it contains only the B2b-scoped
  commits (`prompt-provider.ts` + its tests, the promptSource wiring at all three call sites +
  `app.ts`, the compose forward, the README docs) — not re-created from scratch. All four gates must
  be re-run on the rebased B2b tree before it is pushed; do not carry over the original branch's
  numbers, they included B2a's since-superseded commits.
- B2a's own PR must merge before B2b can branch (`stacked-to-main`).

## Slice B2b — Remote Prompt Source: ResolvePrompt + Call-Site Wiring + Compose/README

**Status: DONE.** All B2.7–B2.20 in `tasks.md` are complete.

- Prerequisite state confirmed before branching: B2a's PR #372 was MERGED to `main` as squash commit
  `a5a55d2`, and `main` was pulled fresh before rebasing.
- **This branch is a REBASE, not a fresh branch.** The original 13-commit `feat/langfuse-remote-prompt-source`
  branch (built before the B2/B2a split was decided) was rebased via `git rebase --onto main 47bd638
  feat/langfuse-remote-prompt-source` — dropping the 6 commits now superseded by B2a and replaying
  only the 7 B2b-scoped commits onto the fresh `main`. This is NOT a re-implementation: the commits'
  content (diffs, messages) is unchanged, only their base moved.
- Plus one NEW commit added on top of the rebased 7, closing a coverage gap the orchestrator
  identified before pushing (see "Coverage gap closed" below) — 8 commits total on this branch.
- PR: opened against `main` (see the PR URL reported alongside this record), referencing #366 as
  `Part of #366` (NOT `Closes`/`Fixes`/`Resolves` — B2b is not the end of the chain; slice C still
  follows, and a closing keyword on an earlier slice's PR had already auto-closed #366 prematurely
  once, which the orchestrator had to reopen). Open, NOT merged.

### Task-by-task (tasks.md B2.7–B2.20)

- [x] B2.7 — RED: `prompt-provider.test.ts` — warm cache → 0 gateway calls on repeat; cold-cache
  burst of 5 concurrent `execute()` calls → exactly 1 `fetchPrompt` call, every caller gets the same
  resolved template.
- [x] B2.8 — RED: each failure class → local text + `source: "fallback"` + correct reason code
  passed to the injected `warn` sink: generic `Error` → `fetch_failed`; `PromptNotFoundError` (B2a) →
  `prompt_not_found`; non-string payload → `payload_not_string` (via `validateRemoteTemplate`, B2a);
  malformed marker surviving to render → `unresolved_marker_after_render` (via
  `checkRenderedTemplate`, B2a).
- [x] B2.9 — RED: `gateway === null` → `no_credentials` reason, `fetchPrompt` never called.
- [x] B2.10 — RED: fallback cached too — a sustained failure makes exactly 1 upstream attempt across
  3 calls within one TTL window.
- [x] B2.11 — RED: `resolvePromptCacheTtlMs` — unset → 60000; valid positive → honored; `"abc"`/`"0"`/
  `"-5"` → default, no throw (5 cases).
- [x] B2.12 — GREEN: `apps/api/src/ai/prompt-provider.ts` — `ResolvePrompt` class, mirroring
  `ResolveBillingPricing` exactly: injectable `cacheTtlMs`/`now`/`warn`, a `Map`-keyed `pending`
  promise PER PROMPT NAME (three prompts share one instance, per design's "Provider granularity"
  decision), `execute(def, variables)` running fetch → `validateRemoteTemplate` → `renderTemplate` →
  `checkRenderedTemplate` → fallback, in that order, first failure wins; `resolvePromptCacheTtlMs(env)`.
- [x] B2.13 — RED: `docker-compose-env-forward.test.ts` — asserts `docker-compose.yml`'s api
  `environment:` block lists `LANGFUSE_PROMPT_CACHE_TTL_MS`. **Independently verified this test is
  load-bearing** (per the orchestrator's explicit instruction): deleted the line locally, watched the
  test go RED, restored the line, watched it go GREEN again — the test does NOT pass unconditionally.
- [x] B2.14 — GREEN: added `LANGFUSE_PROMPT_CACHE_TTL_MS: ${LANGFUSE_PROMPT_CACHE_TTL_MS:-60000}` to
  `docker-compose.yml`'s api `environment:` block, with a comment in the file's existing
  forwarding-gotcha style (references the PR #254 precedent already documented for STRIPE_*/VOICE_*/
  DEEPGRAM_*).
- [x] B2.15 — RED: local-vs-remote equivalence — fake gateway returns `DEF.localTemplate` verbatim →
  `execute()` text is byte-identical to `renderTemplate(DEF.localTemplate, VARS)`, with
  `source: "langfuse"`.
- [x] B2.16 — GREEN: wired `ResolvePrompt` into `invokeChain` (`adapter-factory.ts`) and both
  `PlanSpecExtractionAdapter` passes (`extraction-adapter.ts`) via `AiTracingDeps.prompts?`. Each call
  resolves through `deps.prompts` when injected (else the local builder directly, `promptSource:
  "fallback"`), masks the resolved text exactly where B1 left the masking, and attaches
  `promptSource` to the trace metadata on EVERY call — never omitted, satisfying B2.19's own
  requirement one task early.
- [x] B2.17 — GREEN: `app.ts` builds `buildLangfusePromptGateway()` + one `ResolvePrompt` instance
  alongside A1's handler, threading `resolvePromptCacheTtlMs(process.env)` and a warn sink wired to
  `app.log.warn`; both are added to the SAME `aiTracingDeps` object already passed to
  `buildAdapters()`/`PlanSpecExtractionAdapter`'s constructor.
- [x] B2.18 — Documented `LANGFUSE_PROMPT_CACHE_TTL_MS` (default, forwarding requirement) and the
  remote prompt source's steady-state behavior (three prompt names, `production` label, fallback
  guarantee) in `apps/api/README.md`.
- [x] B2.19 — REFACTOR: confirmed by construction (B2.16) — `promptSource` is computed with a
  `"fallback"` default BEFORE any conditional branch and only overwritten when
  `deps.prompts.execute(...)` actually returns `source: "langfuse"`, so there is no code path that
  omits it.
- [x] B2.20 — Verify: all gates green (see Gate Evidence below); no network call in any new test
  (fake gateway + injected `now` throughout, confirmed by grep — no `fetch`/`http` import added to
  any test file in this slice).

### Coverage gap closed (orchestrator-directed, added before push)

The orchestrator asked, before this PR was opened: "with the provider wired, does plan generation
still succeed with NO Langfuse credentials at all, and is that path actually covered by a test?"
`prompt-provider.test.ts` already proved `new ResolvePrompt(null)` falls back correctly **in
isolation**, but nothing exercised that exact object wired through `deps.prompts` at the actual
`invokeChain`/`extraction-adapter.ts` call sites — the precise shape `app.ts` always builds in
production when `LANGFUSE_PUBLIC_KEY`/`LANGFUSE_SECRET_KEY` are absent (`buildLangfusePromptGateway()`
returns `null`, but a `ResolvePrompt` instance is still always constructed and injected). Two tests
were added (one commit, no production code change — this documents/proves already-correct behavior
rather than introducing new behavior, so it is not a RED/GREEN pair):

- `adapter-factory.test.ts`: `new ResolvePrompt(null)` wired via `buildAdapters({ prompts })` → plan
  generation still returns the mock program, with `promptSource: "fallback"` and the byte-identical
  local prompt.
- `extraction-adapter.test.ts`: the same `ResolvePrompt(null)` wired via `buildAdapter(spec, { prompts })`
  → both `streamReply` and `extract` succeed, `promptSource: "fallback"` on both passes.

Both tests' stderr output shows the exact `[prompt-provider] kinora-plan-generation: no_credentials`
/ `kinora-chat-reply: no_credentials` / `kinora-chat-extraction: no_credentials` warn lines, proving
the fallback path is genuinely exercised end-to-end, not merely asserted.

### Files created

- `apps/api/src/ai/prompt-provider.ts` — `ResolvePrompt`, `ResolvePromptOptions`,
  `resolvePromptCacheTtlMs`.
- `apps/api/src/ai/__tests__/prompt-provider.test.ts`.
- `apps/api/src/ai/__tests__/docker-compose-env-forward.test.ts`.

### Files modified

- `apps/api/src/ai/langfuse-handler.ts` — `AiTracingDeps` gains `prompts?: ResolvePrompt`.
- `apps/api/src/ai/adapter-factory.ts` — `invokeChain` resolves the prompt through `deps.prompts` when
  injected (imports `buildPlanPromptVariables`/`PLAN_PROMPT_DEFINITION` from `prompt.ts`); attaches
  `promptSource` to `traceMetadata`.
- `apps/api/src/ai/extraction-adapter.ts` — both `streamReply`/`extract` mirror the same resolution
  (imports `buildReplyPromptVariables`/`REPLY_PROMPT_DEFINITION`/`buildExtractionPromptVariables`/
  `EXTRACTION_PROMPT_DEFINITION` from `extraction-prompt.ts`); attaches `promptSource` to `metadata`.
- `apps/api/src/app.ts` — builds `langfusePromptGateway` + `resolvePrompt` once, alongside the A1
  handler; `aiTracingDeps` now carries both `handler` and `prompts`.
- `apps/api/src/ai/__tests__/adapter-factory.test.ts` — new `promptSource` attribution cases +
  the no-credentials production-path case (see above).
- `apps/api/src/ai/__tests__/extraction-adapter.test.ts` — **updated the two PRE-EXISTING exact-equality
  metadata assertions** (from slice A2/B1, at what were lines 333/339) to expect `promptSource:
  "fallback"` — they construct `buildAdapter(spec)` with NO `deps.prompts` injected, so the new
  `promptSource` field's default value is what they must now assert; plus new `promptSource`
  attribution cases + the no-credentials production-path case.
- `docker-compose.yml` — `LANGFUSE_PROMPT_CACHE_TTL_MS` forwarded in the api service's `environment:`.
- `apps/api/README.md` — documents the env var + the remote prompt source's steady-state behavior.
- `openspec/changes/16e-langfuse-prompt-management/tasks.md` — B2.7–B2.20 marked `[x]`.

### Interface/signature conformance to design.md

- `ResolvePrompt`, `ResolvePromptOptions`, `resolvePromptCacheTtlMs` — exact match to design's
  `## Interfaces / Contracts` block.
- **One scope deviation from the literal task text, explicitly assigned, not accidental:** B2.16's
  literal wording says to attach `promptName`/`promptVersion`/`promptLabel` "only when `source ===
  'langfuse'`" alongside `promptSource`. The assigning instructions for this slice explicitly scoped
  those three fields — plus `metadata.langfusePrompt` and the version handle — to slice **C** only,
  stating "Attach `promptSource: 'langfuse' | 'fallback'` to the trace metadata in this slice — the
  version handle and `langfusePrompt` are C." B2b therefore ships `promptSource` alone. This satisfies
  every B2-scoped spec scenario for "Trace Attribution to Prompt Source and Version" (which only
  requires `promptSource` plus "linkage identifying the specific prompt version" — deferred to C's
  native SDK linkage, not flat scalar fields C explicitly owns).
- Flat-sequence prompt linking, `metadata.langfusePrompt`, and the version handle — untouched, per the
  assigned "Do NOT touch in B2" boundary.

### What B2b deliberately left for slice C

- No native SDK prompt-version linkage (`prompt-linked-chain.ts`, flat-sequence decomposition,
  `linkStructuredChain`/`linkStreamingModel`), no `promptName`/`promptVersion`/`promptLabel` scalar
  fields, no `metadata.langfusePrompt`. All slice C scope, untouched here.

### Gate Evidence (measured on the REBASED B2b tree, after the no-credentials coverage-gap commit)

- `pnpm -r test` — apps/api: 169 test files, 2020 passed, 116 skipped (30/30 passing in the two files
  touched by the coverage-gap commit, confirmed individually); apps/web: 155 test files, 1640 passed;
  apps/mobile: 53 test files, 467 passed; all packages (contracts/domain/i18n/exercise-catalog) green.
  All green, no failures, exit 0.
- `pnpm --filter api test:coverage` — 169 test files, 2020 passed, 116 skipped, exit 0. Functions
  coverage **88.43%** (gate 85%).
- `pnpm type-check` — all 7 workspace projects, Done, no errors.
- `pnpm build` — deps-guard ✅, ui-api-guard ✅ (48 client files scanned, no violations), architecture
  (0 dependency violations across 2009 modules / 6016 dependencies) ✅, architecture negative guard ✅,
  every package/app build Done, exit 0.
- `git diff --stat main...HEAD -- . ':!openspec'` — **589 changed lines** (589 insertions(+), 17
  deletions(-)) across 11 files. Well under the 800-line budget, and consistent with the ~562-line
  forecast made before the rebase (the +27-line delta is the no-credentials coverage-gap commit).
- Compose-forward test load-bearing check: deleted `LANGFUSE_PROMPT_CACHE_TTL_MS` from
  `docker-compose.yml` locally, ran `docker-compose-env-forward.test.ts` alone → FAILED as expected;
  restored the line, ran again → PASSED. Confirms the test is not a false-positive tautology.

### Open items

- B2b's PR must merge before slice C can branch (`stacked-to-main`).
- Slice C (native prompt-version linkage) is the only remaining slice in this change.
