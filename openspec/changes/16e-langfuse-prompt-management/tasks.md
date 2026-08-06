# Tasks: 16e — Langfuse Prompt Management

Implements `openspec/changes/16e-langfuse-prompt-management/specs/langfuse-prompt-management/spec.md`
under `design.md` and the pinned decisions of `proposal.md` (1-9 + the answered question round).
Fixed slice order, do not resequence: **A1 → A2 → B1 → B2 → C**. Every implementation task is
preceded by its RED test task (Strict TDD). Coverage gate: apps/api functions threshold **85%**
(`apps/api/vitest.config.ts:31`), current headroom ~1.8 points (~86.84%) — a slice that adds
functions without their tests can break the gate on its own, so tests ship in the SAME commit as
the module they cover, never bolted on later.

## Review Workload Forecast

| Slice | Content | Non-test / test (est.) | Changed lines (add+del, est.) | 800-line budget risk | Decision needed before apply |
|-------|---------|------------------------|--------------------------------|-----------------------|-------------------------------|
| A1 | `langfuse-handler.ts` + `buildAdapters(deps)` + `invokeChain` attachment + `app.ts` wiring/`onClose` flush + delete `OpenRouterPlanGenerator`+test + invert `adapter-factory.test.ts:135-151` + masking-payload test + README | ~130 / ~190, minus ~200 deleted | ~320 gross (net lower after deletions) | Low | No |
| A2 | Extraction-adapter `deps` + attach at `streamReply`/`extract` + tests | ~35 / ~100 | ~135 | Low | No |
| B1 | Renderer + three template constants + variables producers + `mask` relocation out of the two chat builders + byte-identical/snapshot tests | ~330 / ~400 | ~730 | **Medium-High** | Yes — split into B1a (plan prompt only) / B1b (chat prompts + mask relocation) if review measures >800 |
| B2 | Port + SDK gateway + `ResolvePrompt` + validation + wiring + `promptSource` + compose/README + tests | ~400 / ~380 | ~780 | **Medium-High** | Yes — split into B2a (port + gateway + validation) / B2b (`ResolvePrompt` + call-site wiring + compose/README) if review measures >800 |
| C | Version handle + `langfusePrompt` + `prompt-linked-chain.ts` (flat-sequence decomposition + guards) + wiring at both attachment sites + parenting/degradation/equivalence/attribution tests + follow-up issues | ~75 / ~280 | ~355 | Low | No |

`Chained PRs recommended: Yes` — B alone would measure ≈1370 lines and MUST split into B1/B2; each
lands near ~730-780, close enough to the 800 budget that either can tip over under real review (a
reviewer counting differently, or a scope creep in the tests). The design names the further split
seam for exactly this case (B1a/B1b, B2a/B2b) — these are **conditional follow-on slices**, not
speculative extra work: only cut them if review actually measures the parent slice over 800.

No slice depends on a later slice's internals: after B1 the local path is unchanged; after B2 (or
B2a) nothing is wired to version-linking yet; C is metadata/chain-shape only and never touches
B1/B2 files besides the two attachment call sites.

### Dependency diagram (for chained-PR tracking; mark the current PR with 📍)

```
A1 (handler + invokeChain attach + dead-path removal)
 └─ A2 (extraction-adapter attach)
     └─ B1 (renderer + templates + mask relocation)      [conditional: B1a → B1b]
         └─ B2 (remote source: port + gateway + provider) [conditional: B2a → B2b]
             └─ C (version linking + attribution)
```

### Chain strategy

**COLLECTED (product owner, 2026-08-06): `chain_strategy: stacked-to-main`.**

A1, A2, B1, B2 and C each target `main` in sequence and merge as soon as they are approved, so each
slice unlocks the next. No tracker branch, no draft umbrella PR. Rationale: A1 reaches production
early, which is what finally answers whether the production Langfuse credentials are valid — the
question this change cannot resolve any other way (`proposal.md` question round, answer 2).

Consequences for apply:
- Rebase each slice onto `main` after the previous one merges; do not stack a child on an unmerged
  parent branch.
- Every slice must be independently deploy-safe, which the design already guarantees: A1/A2 degrade
  to today's untraced path when the handler is `null`, B1 is behaviour byte-identical, B2 serves the
  local template until the prompts exist in Langfuse under the `production` label, and C degrades to
  flat attribution when the shape guard declines.
- `gh` operations on `kno/kInorA` require `gh auth switch --user kno` first; the default account is
  not a collaborator and the switch does not persist.

Each phase below states its own start state, end state, and rollback boundary, so it stands alone as
a PR.

## Repo gotchas carried into task notes (do not re-derive)

- `docker-compose.yml`'s `environment:` block only forwards vars explicitly listed there — a var
  read in code but absent from `environment:` is silently unset in the deployed container while
  still working under local `pnpm dev` (previously killed billing in prod, PR #254). B2 MUST add
  `LANGFUSE_PROMPT_CACHE_TTL_MS` there, with a test reading the file to assert the forward (task B2.13).
- Apps resolve workspace packages through their built `dist/`, not `src` — irrelevant here since
  this change touches no cross-package import, but keep in mind if a task needs a rebuild before a
  route/integration test picks up a package change.
- `packages/contracts` has two tests asserting the EXACT ordered list of runtime exports. This
  change does not touch `packages/contracts` per the design's File Changes table — confirmed no
  task below adds an export there. If a later task discovers otherwise, updating those two tests is
  part of the SAME task, not a follow-up.
- `gh` operations on kno/kInorA need `gh auth switch --user kno`; the default account cannot merge.
- Two follow-up GitHub issues MUST be filed in slice C (task C.16): (1) the accepted first-mention
  limitation masking gap now that a real trace channel exists (proposal answer 4); (2) re-run
  `prompt-linked-chain` tests on any `@langchain/*`/`@langchain/core` bump, since a shape change
  degrades silently and safely but stops populating the native columns (`promptLinked: false`).
- Open questions carried as explicit gates, not silent assumptions: the three prompts must exist in
  the Langfuse project under the `production` label before B2 has anything to fetch — until then
  `prompt_not_found` → local template is the tested steady state (task B2.9), not a bug; confirm
  during A1 RED that nothing outside `openrouter-generator.test.ts` constructs
  `OpenRouterPlanGenerator` (task A1.1); confirm out of band, once, after C deploys, that the
  Langfuse Prompt tab actually populates (task C.17, not a test — an operational checklist item).

---

## Phase A1: Tracing Channel + Dead-Path Removal

Start state: no `CallbackHandler` is ever constructed; `OpenRouterPlanGenerator` is an unwired
duplicate prompt/mask/invoke path; `adapter-factory.test.ts:135-151` asserts NO callbacks are
attached. End state: `invokeChain` traces through an injectable, nullable handler; the duplicate
path is gone; the "no callbacks" assertion is inverted to "attaches the injected handler". Rollback
boundary: unset `LANGFUSE_PUBLIC_KEY`/`LANGFUSE_SECRET_KEY` reverts A1 wiring to today's behaviour
with no code change; deleting `OpenRouterPlanGenerator` is independent and does not need reverting
(nothing constructs it).

Satisfies: Safe-By-Construction Tracing Handler; Langfuse Base URL Resolution; Masking Invariant on
Trace Payloads (input half); No Untraced Duplicate Prompt Path Remains; Prompt Tests Run Offline.

- [x] A1.1 Pre-flight: grep confirms no test outside `apps/api/src/ai/__tests__/openrouter-generator.test.ts`
      constructs `OpenRouterPlanGenerator` (design Open Question, `app.ts:21` imports only
      `warnIfAiConfigMissing`)
- [x] A1.2 RED: `langfuse-handler.test.ts` — `buildLangfuseCallbackHandler()` returns `null` when
      either `LANGFUSE_PUBLIC_KEY` or `LANGFUSE_SECRET_KEY` is missing from injected `env`
- [x] A1.3 RED: returns `null` (+ exactly one warn call) when construction throws — hoisted
      `vi.mock("langfuse-langchain")` with a throwing/recording constructor, no real client, no
      network, no credentials
- [x] A1.4 RED: `baseUrl` precedence `LANGFUSE_BASEURL ?? LANGFUSE_HOST` — only `LANGFUSE_HOST` set
      (current production shape); both set (BASEURL wins); neither set → no explicit `baseUrl` key
      passed to the constructor
- [x] A1.5 GREEN: create `apps/api/src/ai/langfuse-handler.ts` — `TracingHandler` interface
      (`{ readonly name: string; flushAsync(): Promise<unknown> }`), `resolveLangfuseBaseUrl(env)`,
      `buildLangfuseCallbackHandler(opts?: { env?, warn? })` → handler `|` `null`, try/catch around
      construction, warn sink carries reason code + `error.name` only, never a credential
- [x] A1.6 RED: `adapter-factory.test.ts:135-151` **inverted** — rename to "attaches the injected
      tracing handler"; `buildAdapters({ handler })` → `mockInvoke.mock.calls[0][1]` DOES contain
      `callbacks: [handler]`; a second case with `buildAdapters()` (no deps) asserts the config still
      has NO `callbacks` key; `beforeEach` additionally deletes `LANGFUSE_PUBLIC_KEY`/`LANGFUSE_SECRET_KEY`
- [x] A1.7 GREEN: `buildAdapters(deps?: AiTracingDeps)` in `apps/api/src/ai/adapter-factory.ts` —
      `invokeChain` spreads `...(handler ? { callbacks: [handler] } : {})` conditionally so the
      no-handler config is byte-identical to today's; rewrite the superseded "no callback attached"
      comment at `adapter-factory.ts:28-35` to document why A1 supersedes it (masked input, schema-shaped
      output, masking test) rather than deleting the reasoning
- [x] A1.8 RED: masking-payload test — `limitations: [{ text: "osteoporosis" }]`; assert the invoke
      input contains `[REDACTED]` and NOT `osteoporosis`, AND `JSON.stringify([invokeInput,
      resolvedProgram])` does not contain the raw term (extends the existing fake-chain harness)
- [x] A1.9 GREEN: confirmed passing via A1.7's conditional-spread wiring — masking already runs at the
      `invokeChain` call site before `.invoke`; no additional production code needed for this test
      beyond A1.7 (document if it turns out otherwise)
- [x] A1.10 RED: delete `apps/api/src/ai/__tests__/openrouter-generator.test.ts` first, confirm the
      suite fails to resolve the module it deleted-tested (i.e. confirm the file is really gone from
      the run, not skipped)
- [x] A1.11 GREEN: delete `OpenRouterPlanGenerator` from `apps/api/src/ai/openrouter-generator.ts`;
      keep `warnIfAiConfigMissing`; drop now-unused imports; confirm
      `apps/api/src/ai/__tests__/startup-warning.test.ts` still covers `warnIfAiConfigMissing`
- [x] A1.12 GREEN: wire `buildLangfuseCallbackHandler()` once in `apps/api/src/app.ts`, pass `deps` to
      `buildAdapters`; register a Fastify `onClose` hook calling `handler.flushAsync()` best-effort
      (never throws, never blocks shutdown); fix the stale Langfuse-related comments at `app.ts:132`
      and `app.ts:224`
- [x] A1.13 Document `LANGFUSE_BASEURL`/`LANGFUSE_HOST` precedence in `apps/api/README.md`
- [x] A1.14 REFACTOR: re-read `adapter-factory.ts` diff for dead code / stale comments; confirm the
      no-handler invoke config is byte-identical (assert via A1.6's second case)
- [x] A1.15 Verify: `pnpm --filter api test` green; `pnpm --filter api test:coverage` green at the
      85% functions threshold; `pnpm --filter api exec tsc --noEmit` clean

**A1 status: DONE.** PR: https://github.com/kno/kInorA/pull/368 (branch
`feat/langfuse-tracing-handler`, from `main`, not yet merged). All A1 tasks complete; gates green
(see apply-progress topic key for exact evidence). Not started: A2, B1, B2, C.

## Phase A2: Extraction-Adapter Tracing

Start state: `PlanSpecExtractionAdapter.streamReply`/`extract` pass no `callbacks`. End state: both
passes attach the same injectable handler, conditionally, exactly like A1's `invokeChain`. Rollback
boundary: remove the `deps` constructor arg and the two `...(handler ? …)` spreads — no other file
changes.

Satisfies: Safe-By-Construction Tracing Handler (extended to chat); Masking Invariant on Trace
Payloads (chat half); Prompt Tests Run Offline.

- [x] A2.1 RED: `extraction-adapter.test.ts` — `streamReply` passes `callbacks: [handler]` when a
      handler is injected via the third constructor arg, and omits the `callbacks` key entirely when
      not (existing fake `ExtractionChatModel` records call options)
- [x] A2.2 RED: same two cases for `extract`
- [x] A2.3 RED: both payloads masked for a KNOWN limitation (extends A1.8's harness style to the two
      chat call sites); `signal`/`runName`/`metadata` unchanged by the new `deps` arg
- [x] A2.4 GREEN: add third constructor arg `deps?: AiTracingDeps` to
      `apps/api/src/ai/extraction-adapter.ts`; apply the conditional `callbacks` spread at both
      `streamReply` and `extract`; rewrite the stale masking/observability docstring at lines ~41-49
- [x] A2.5 GREEN: wire the same handler instance from `app.ts` into `PlanSpecExtractionAdapter`'s
      constructor call site
- [x] A2.6 REFACTOR: confirm `invokeChain` and the extraction adapter now share the identical
      conditional-spread idiom (no divergence between the two attachment sites)
- [x] A2.7 Verify: `pnpm --filter api test` green; `pnpm --filter api test:coverage` green; no
      regression in `app.test.ts` or route suites with no credentials set (handler is `null`)

**A2 status: DONE.** PR: https://github.com/kno/kInorA/pull/370 (branch
`feat/langfuse-extraction-adapter-tracing`, from `main`, not yet merged). All A2 tasks complete;
gates green (see apply-progress topic key for exact evidence). Not started: B1, B2, C.

## Phase B1: Shared Renderer + Template Extraction

Start state: `buildPlanPrompt`/`buildReplyPrompt`/`buildExtractionPrompt` are single functions that
interpolate directly; `mask()` runs INSIDE the two chat builders (asymmetric with the plan path).
End state: each builder splits into a variables producer + the shared `renderTemplate` over an
exported template constant; `mask()` moved OUT of both chat builders to the call site (A2's
attachment points), matching the plan path's existing call-site masking. Rollback boundary: revert
the provider/renderer files; the builders keep producing today's output (no B2/C dependency yet).

Satisfies: Local and Remote Templates Share One Renderer With Byte-Identical Output; Masking
Invariant on Trace Payloads (relocation half); Prompt Tests Run Offline.

**Conditional split gate:** if review measures this slice over 800 lines, cut here into B1a (plan
prompt only: `prompt.ts` + renderer + its tests) and B1b (the two chat prompts + the `mask`
relocation). Do not pre-split unless review actually flags it.

- [x] B1.1 RED: `prompt-template.test.ts` — substitution, repeated variable, empty-string variable,
      unknown `{{x}}` left intact (so validation step 5 catches it later), no-variable template (pure,
      no I/O)
- [x] B1.2 GREEN: create `apps/api/src/ai/prompt-template.ts` — `renderTemplate(template, variables)`,
      `templateVariablesOf(template)`, `PromptDefinition` interface (`name`, `localTemplate`,
      `variables`, `requiredMarkers`, `orderedMarkers`, `maxTemplateChars: 20_000`),
      `TEMPLATE_MARKER_OPEN`
- [x] B1.3 RED: byte-identical snapshot — `renderTemplate(PLAN_PROMPT_TEMPLATE,
      buildPlanPromptVariables(spec))` `===` the pre-refactor `buildPlanPrompt(spec)` output, across:
      no memory / with memory / `allowedExercises` empty / non-empty / each `intensityBias` value
- [x] B1.4 GREEN: extract `PLAN_PROMPT_TEMPLATE` as an exported constant capturing today's exact
      wording in `apps/api/src/ai/prompt.ts`; add `buildPlanPromptVariables(spec)` and
      `PLAN_PROMPT_DEFINITION` (variables/markers per design's variable-sets table); `buildPlanPrompt`
      becomes the local-template wrapper over `renderTemplate` — preserve the #352 ordering contract
      (`{{limitationsSection}}` → `{{memorySection}}` → `{{vocabularySection}}` → `TASK:` →
      `{{taskExerciseRule}}`)
- [x] B1.5 Plus `toMatchSnapshot()` on B1.3's cases to freeze wording against future drift
- [x] B1.6 RED: same byte-identical + snapshot pair for `buildReplyPrompt` (`REPLY_PROMPT_TEMPLATE`)
      and `buildExtractionPrompt` (`EXTRACTION_PROMPT_TEMPLATE`) against
      `extraction-prompt.test.ts`'s existing content assertions, which must stay green unchanged
- [x] B1.7 GREEN: extract `REPLY_PROMPT_TEMPLATE`/`EXTRACTION_PROMPT_TEMPLATE` +
      `REPLY_PROMPT_DEFINITION`/`EXTRACTION_PROMPT_DEFINITION` in
      `apps/api/src/ai/extraction-prompt.ts`; export `limitationTermsOf`
- [x] B1.8 RED: masking relocation — `buildReplyPrompt`/`buildExtractionPrompt` now return UNMASKED
      text (move the existing in-builder masking assertions OUT to `extraction-adapter.test.ts`,
      proving A2's call-site masking is what actually reaches the model/callback)
- [x] B1.9 GREEN: remove the `mask(...)` call from inside both chat builders; the call-site masking
      added in A2 already covers the now-unmasked output — confirm no other caller of
      `buildReplyPrompt`/`buildExtractionPrompt` relied on the in-builder masking (grep before removing)
- [x] B1.10 REFACTOR: confirm `mask` now runs at exactly two invocation sites total (`invokeChain`,
      extraction-adapter) for all three prompts — the masking-payload test surface designed in A1/A2
- [x] B1.11 Verify: `pnpm --filter api test` green; `pnpm --filter api test:coverage` green at 85%
      functions threshold; existing `prompt.test.ts`/`extraction-prompt.test.ts` content assertions
      still pass unchanged

## Phase B2: Remote Prompt Source + Validation

Start state: only the local template exists; no gateway, no provider, no TTL cache. End state: a
`ResolvePrompt` use case resolves each of the three prompts through a narrow
`LangfusePromptGateway` port with mandatory local fallback, TTL cache + burst coalescing, boundary
validation, and `promptSource` attribution wired at both call sites; `LANGFUSE_PROMPT_CACHE_TTL_MS`
forwarded in compose. Rollback boundary: revert the provider wiring at the two call sites; B1's
local template constants remain untouched and the builders keep producing today's output; unsetting
or unlabelling the Langfuse prompt operationally forces the fallback path with no deploy.

**Conditional split gate:** if review measures this slice over 800 lines, cut here into B2a (port +
gateway + validation) and B2b (`ResolvePrompt` + call-site wiring + compose/README). Do not
pre-split unless review actually flags it.

Satisfies: Fixed Production Label Is the Only Promotion Gate; Prompt Cache TTL Is
Environment-Configurable With a 60-Second Default; Prompt Cache TTL Env Var Is Forwarded in
Compose; Remote Prompt Fetch With Mandatory Local Fallback; TTL Cache With Concurrent-Burst
Coalescing; Fallback Result Is Cached Too; Untrusted Remote Template Validation Fails Closed;
Trace Attribution to Prompt Source and Version (the `promptSource` half); Prompt Tests Run Offline.

- [x] B2.1 RED: `remote-template-validation.test.ts` — table-driven, one case per
      `PromptRejectionReason`: `payload_not_string`, `payload_empty`, `payload_too_large`;
      `unknown_variable` (`{{nope}}`); `missing_required_placeholder` (vocabulary placeholder
      dropped); `marker_order_violated` (vocabulary block moved AFTER `TASK:` — rejected whole, NOT
      repaired); `unresolved_marker_after_render`
- [x] B2.2 GREEN: create `apps/api/src/ai/remote-template-validation.ts` — `RemoteTemplateSchema`
      (zod: `z.string().min(1).max(def.maxTemplateChars)`), `validateRemoteTemplate(def, payload)` →
      `{ ok: true, template } | { ok: false, reason }`, `PromptRejectionReason` union; validation
      order per design (payload shape → unknown variable → required markers present → marker order
      strictly increasing via `indexOf` → post-render `{{` sweep), first failure wins
- [x] B2.3 RED: `prompt-source-port.test.ts` (if the port needs its own test) or fold into B2.5 —
      confirm `LangfusePromptGateway.fetchPrompt(name, label)` shape: `Promise<{ template: unknown;
      version: number }>`
- [x] B2.4 GREEN: create `apps/api/src/ai/prompt-source-port.ts` — `LangfusePromptGateway` interface,
      `PromptResolution` type (`{ text, source: "langfuse" | "fallback", name?, version? }`)
- [x] B2.5 RED: gateway adapter test — `buildLangfusePromptGateway()` returns `null` with no
      credentials; with a mocked `Langfuse` client (re-exported by `langfuse-langchain`, no new
      dependency), calls `getPrompt(name, version, { label: "production", cacheTtlSeconds: 0,
      fetchTimeoutMs: 3000 })` — note `version` is the verified 2nd POSITIONAL SDK arg, not an
      options key
- [x] B2.6 GREEN: create `apps/api/src/ai/langfuse-prompt-gateway.ts` — SDK adapter,
      `buildLangfusePromptGateway()` → port `|` `null`, hardcoded `PROMPT_FETCH_TIMEOUT_MS = 3000`
- [x] B2.7 RED: `prompt-provider.test.ts` (template: `billing-pricing.test.ts`) — warm cache → 0
      gateway calls; cold-cache burst of N concurrent `execute()` → exactly 1 `fetchPrompt` call,
      every concurrent caller gets the same resolved template
- [x] B2.8 RED: each failure class (network, auth, missing prompt, malformed template) → local text +
      `source: "fallback"` + the correct reason code passed to the injected `warn` sink
- [x] B2.9 RED: `gateway === null` (no credentials) → `no_credentials` reason with no gateway call at
      all — confirms the tested steady state while the three prompts don't yet exist in Langfuse
      under `production`
- [x] B2.10 RED: fallback is cached too — a second call within the same TTL window makes 0 further
      gateway calls even though the first call failed; TTL expiry retries after the window elapses
- [x] B2.11 RED: `resolvePromptCacheTtlMs(env)` — unset → 60000 default; valid positive integer →
      honored; unparseable string (e.g. `"abc"`) → default, no throw; `0` → default, no throw;
      negative (e.g. `-5`) → default, no throw
- [x] B2.12 GREEN: create `apps/api/src/ai/prompt-provider.ts` — `ResolvePrompt` class (gateway,
      `{ cacheTtlMs?, now?, warn? }`), `execute(def, variables)` → fetch → zod validate → render →
      post-render check → fallback, single `pending` promise per prompt name coalescing a cold-cache
      burst (mirrors `ResolveBillingPricing`, `billing-pricing.ts:69-136`); export
      `resolvePromptCacheTtlMs(env)`
- [x] B2.13 RED: compose-forward test — read `docker-compose.yml` in-test, assert the api service's
      `environment:` block lists `LANGFUSE_PROMPT_CACHE_TTL_MS` (mirrors the existing env-forwarding
      guard style; PR #254 gotcha)
- [x] B2.14 GREEN: add `LANGFUSE_PROMPT_CACHE_TTL_MS: ${LANGFUSE_PROMPT_CACHE_TTL_MS:-60000}` to
      `docker-compose.yml`'s api `environment:` block with the forwarding-gotcha comment in house
      style
- [x] B2.15 RED: local-vs-remote equivalence — fake gateway returns EXACTLY `PLAN_PROMPT_TEMPLATE` →
      `execute()` text is byte-identical to the local path, with `source: "langfuse"`
- [x] B2.16 GREEN: wire `ResolvePrompt` into `invokeChain` (`adapter-factory.ts`) and
      `PlanSpecExtractionAdapter` (`streamReply`/`extract`) via the shared `AiTracingDeps.prompts?`
      field; resolve prompt → mask rendered text (B1's call-site masking, unchanged) → attach
      `promptSource` to invoke/stream metadata. **Deviation from the literal text above:**
      `promptName`/`promptVersion`/`promptLabel` are NOT attached in this slice — the assigning
      instructions scoped those (plus `metadata.langfusePrompt` and the version handle) to slice C
      only; B2 ships `promptSource` alone, which is what every B2 spec scenario for "Trace
      Attribution to Prompt Source and Version" requires.
- [x] B2.17 GREEN: build the gateway + `ResolvePrompt` once in `app.ts` alongside A1's handler; pass
      through the same `deps` bag
- [x] B2.18 Document `LANGFUSE_PROMPT_CACHE_TTL_MS`, the three prompt names
      (`kinora-plan-generation`, `kinora-chat-reply`, `kinora-chat-extraction`) and the `production`
      label in `apps/api/README.md`
- [x] B2.19 REFACTOR: confirm attribution is NEVER attached without a source marker — B2 ships
      `promptSource` on every call, satisfying the design's "never let a remote-sourced trace exist
      without a source marker, not even for one slice" split
- [x] B2.20 Verify: `pnpm --filter api test` green; `pnpm --filter api test:coverage` green at 85%
      functions threshold; no network call in any new test (fake gateway + injected `now` throughout)

**B2b status: DONE.** All B2.7–B2.20 tasks complete; see apply-progress.md's B2b section for the
rebase history, gate evidence, and the added no-credentials production-path coverage.

**B2 split (orchestrator decision, review-measured): B2.1–B2.6 shipped as slice B2a** (PR against
`main`, branch `feat/langfuse-prompt-gateway`, branched at commit `47bd638` of the original combined
B2 branch). The combined B2 slice measured 956 hand-authored changed lines against the 800-line
budget; B2a (port + gateway + validation) measures 411, comfortably under. **B2.7–B2.20 remain B2b**,
held on `feat/langfuse-remote-prompt-source` pending B2a's merge (`stacked-to-main` forbids a child
branch off an unmerged parent) — see apply-progress.md's B2a section for the full record.

## Phase C: Native Prompt-Version Linkage

Start state: attribution is flat metadata only (`promptSource` from B2); no native SDK
prompt-version linkage. End state: the invocation chain reparents the model run under the
prompt-serving step on the happy path so the SDK's native linkage precondition holds, with a
per-call shape guard degrading safely to flat attribution when it doesn't. Rollback boundary:
revert `prompt-linked-chain.ts` and the two call-site wiring lines — B2's flat `promptSource`
attribution survives independently; this slice is metadata/chain-shape only.

Satisfies: Native Prompt-Version Linkage Populates on the Happy Path; Graceful Degradation to Flat
Attribution When Native Linkage Cannot Be Established; Masking Invariant Holds Across the
Restructured Invocation Chain; Output Equivalence Under Chain Restructuring; Native Linkage
Behaviour Is Verifiable Offline; Trace Attribution to Prompt Source and Version (the version-handle
half); Prompt Tests Run Offline.

- [ ] C.1 RED: `prompt-linked-chain.test.ts` **run-parenting** — a fake callback handler (a plain
      object with `handleChainStart`/`handleChatModelStart`, passed via `callbacks`) records
      `(runId, parentRunId, metadata)` per event, using a REAL `RunnableSequence`/`RunnableLambda`
      from `@langchain/core` plus a ~15-line offline `BaseChatModel` subclass whose `_generate`
      returns a canned `AIMessage`. Assert: outer sequence starts with `parentRunId === undefined`;
      `promptStep` starts with a defined `parentRunId === X` AND received the inherited
      `metadata.langfusePrompt`; the MODEL step starts with the same `parentRunId === X` — the lookup
      key the SDK uses is the key the prompt was registered under. No network, no credentials, no SDK
      mock.
- [ ] C.2 GREEN: create `apps/api/src/ai/prompt-linked-chain.ts` — `promptStep()` returns a
      `RunnableLambda` identity over the already-rendered, already-MASKED string (never a
      `ChatPromptTemplate` — would reinterpret the JSON braces in the output-format block);
      `PromptLinkedChain<T>` interface (`{ chain: T; linked: boolean }`)
- [ ] C.3 RED: **guard degradation** — `linkStructuredChain(plainObjectWithInvoke)` returns
      `{ chain: sameReference, linked: false }`; same for `null`/`undefined` (no throw, despite
      `isRunnableSequence` dereferencing `.middle`); an `includeRaw`-shaped `RunnableMap`-first
      sequence is NOT reparented; a declined call still carries full metadata attribution with
      `promptLinked: false` and still generates successfully (table-driven; reuses the existing
      plain-object fake models, which are exactly the declined shape)
- [ ] C.4 GREEN: implement `linkStructuredChain<T>(structured)` — reparent
      `RunnableSequence.from([promptStep(), ...structured.steps])` only when
      `RunnableSequence.isRunnableSequence(thing)` (guard the `null` check FIRST, since it dereferences
      `.middle`) or `Runnable.isRunnable(thing)` (cross-realm safe, via `isRunnableInterface`) confirm
      the shape; otherwise degrade to the original runnable untouched; never throws
- [ ] C.5 RED: same degradation table for `linkStreamingModel` (bare chat model wrapped as
      `[promptStep, model]` when it matches; degrades otherwise)
- [ ] C.6 GREEN: implement `linkStreamingModel<T>(model)`
- [ ] C.7 RED: **output equivalence** — for the same input, the reparented flat sequence and the
      untouched `withStructuredOutput` sequence produce an identical parsed result, and
      `WorkoutProgramSchema.parse` still succeeds (offline `BaseChatModel` subclass returning a canned
      `WorkoutProgram` JSON; deep equality before/after)
- [ ] C.8 GREEN: confirmed by C.4's step-object reuse (`structured.steps` passed through unchanged,
      preserving the `withConfig` tool binding) — no additional production code expected; document if
      otherwise
- [ ] C.9 RED: attribution — remote path → metadata has `promptSource: "langfuse"`, `promptLinked`,
      `promptName`, `promptVersion`, `promptLabel: "production"`, `langfusePrompt: {name, version,
      isFallback: false}`; fallback path → `promptSource: "fallback"` and NO `promptName`/
      `promptVersion`/`langfusePrompt` key (assert the recorded invoke/stream options at both
      attachment sites)
- [ ] C.10 GREEN: wire `linkStructuredChain`/`linkStreamingModel` into `invokeChain`
      (`adapter-factory.ts`) before `.invoke`, and into `extraction-adapter.ts` — `linkStreamingModel`
      for `streamReply`, `linkStructuredChain` for `extract`; attach `metadata.langfusePrompt =
      { name, version, isFallback: false }` only when `promptSource === "langfuse"` (the SDK drops it
      via `isFallback` anyway, but omit it entirely to keep the fallback branch simple); attach
      `promptLinked` from each linker's returned `linked` boolean
- [ ] C.11 RED: **masking invariant across the restructured chain** — the callback observes the
      already-rendered, already-masked prompt string at every run in the reparented sequence (extends
      C.1's fake-handler harness to assert the payload, not just parentage)
- [ ] C.12 GREEN: confirmed by construction — `promptStep()` wraps the value AFTER B1/B2's
      render+mask pipeline runs, never re-touching the string; no additional production code expected
- [ ] C.13 REFACTOR: confirm the per-call shape guard covers all five plan-generation providers
      (`openrouter`, `openai`, `anthropic`, `google`, `opencode-go`) — none construct a differently
      shaped chain that the guard would mis-handle
- [ ] C.14 Verify: `pnpm --filter api test` green; `pnpm --filter api test:coverage` green at 85%
      functions threshold; `pnpm --filter api exec tsc --noEmit` clean; `pnpm architecture` (dep-cruiser)
      0 violations if it covers `apps/api/src/ai/*`
- [ ] C.15 Full-chain regression: `app.test.ts` and existing route suites keep passing with no
      credentials set (handler `null`, gateway `null`, prompts resolve locally) — no behavioural
      change end-to-end when Langfuse is absent
- [ ] C.16 File two follow-up GitHub issues on kno/kInorA (`gh auth switch --user kno` first): (1)
      first-mention limitation masking gap now that a real trace channel exists (proposal answer 4);
      (2) re-run `prompt-linked-chain` tests on any `@langchain/openai`/`@langchain/anthropic`/
      `@langchain/google-genai`/`@langchain/core` bump — a shape change degrades silently and safely
      but stops populating the native columns, visible as `promptLinked: false`
- [ ] C.17 Operational, not a test: after C deploys, confirm out of band, once, that the Langfuse
      Prompt tab actually populates against the live project. If it does not,
      `promptLinked: true` in the traces localizes the remaining gap to the SDK rather than to this
      repo's wiring.

## Final Verification (run once the full chain has landed)

- [ ] `pnpm --filter api test` — full suite green, hermetic (no network, no credentials)
- [ ] `pnpm --filter api test:coverage` — apps/api functions threshold ≥85% (`apps/api/vitest.config.ts:31`)
- [ ] `pnpm --filter api exec tsc --noEmit` — no errors
- [ ] `pnpm architecture` — 0 dependency violations
- [ ] `pnpm build` — CI's real gate, must succeed
- [ ] Grep confirms no `OpenRouterPlanGenerator` class or its dedicated test file exists anywhere
- [ ] Grep confirms all five plan-generation provider factories funnel through `invokeChain` with no
      alternate prompt/mask/invoke path
