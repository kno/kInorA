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
