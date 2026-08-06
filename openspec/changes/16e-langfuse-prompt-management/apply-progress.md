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
