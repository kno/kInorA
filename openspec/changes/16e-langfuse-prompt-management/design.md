# Design: langfuse-prompt-management

Implements `openspec/changes/16e-langfuse-prompt-management/specs/langfuse-prompt-management/spec.md`
under the pinned decisions of `proposal.md` (1-9 + the answered question round). Evidence for the
current code shape comes from `exploration.md`; every SDK claim below was verified against the
installed declarations (see **Installed SDK Verification**).

## Technical Approach

Three seams, no new architectural pattern:

1. **Tracing seam** — `ai/langfuse-handler.ts` exports `buildLangfuseCallbackHandler()`, returning
   `TracingHandler | null` (`null` when either credential is absent or construction throws). It is
   built ONCE per app in `app.ts` and injected into `buildAdapters(deps)` (which threads it to the
   single `invokeChain` choke point, `adapter-factory.ts:36-56`) and into
   `PlanSpecExtractionAdapter` (`streamReply`/`extract`). Both attachment sites spread the key
   conditionally — `...(handler ? { callbacks: [handler] } : {})` — so the no-handler config is
   byte-identical to today's.
2. **Renderer seam** — each builder splits into a *variables producer* (`build*PromptVariables`) and
   a *pure renderer* (`renderTemplate(template, variables)`) over a `{{variable}}` template. Today's
   wording becomes an exported template constant (`PLAN_PROMPT_TEMPLATE`, `REPLY_PROMPT_TEMPLATE`,
   `EXTRACTION_PROMPT_TEMPLATE`), so local and remote run through the SAME renderer. `mask()` moves
   OUT of `buildReplyPrompt`/`buildExtractionPrompt` and runs on the RENDERED string at the
   invocation sites, exactly as `invokeChain` already does — one masking rule, no remote bypass.
3. **Prompt-source seam** — `ResolvePrompt` (`ai/prompt-provider.ts`) mirrors `ResolveBillingPricing`
   (`billing/billing-pricing.ts:69-136`): injectable `cacheTtlMs` + `now`, one `pending` promise per
   prompt name coalescing a cold-cache burst, fallback-on-any-failure through an injectable
   secret-free warn sink, fallback cached too. It owns fetch → zod validation → render →
   post-render check → fallback, and returns `{ text, source, name?, version? }`. The gateway
   adapter (`ai/langfuse-prompt-gateway.ts`) calls the SDK with `cacheTtlSeconds: 0`, leaving the
   repo-owned TTL as the single cache.

Attribution (`promptSource`, and the version handle) travels only as flat scalar trace metadata
produced by `ResolvePrompt` — the template body never leaves the provider.

## Installed SDK Verification (proposal decision 4/8)

Read directly from `node_modules/.pnpm/langfuse-langchain@3.38.20_.../node_modules/langfuse-langchain/lib/`
(`index.d.ts`, `index.cjs.js`) and `.../langfuse-core@3.38.20/.../langfuse-core/lib/`
(`index.d.ts`, `index.cjs.js`).

| Question | Verified answer | Evidence |
|---|---|---|
| Construction | `new CallbackHandler(params)` where `params = (RootParams \| KeyParams) & {userId?, version?, sessionId?, metadata?, tags?, updateRoot?}`; `KeyParams = {publicKey?, secretKey?} & LangfuseOptions` (which carries `baseUrl`) | `langfuse-langchain/lib/index.d.ts:21-54` |
| Prompt-linking key | `metadata.langfusePrompt` — the ONLY mechanism. Registered in `handleChainStart` and consumed in `handleGenerationStart` | `index.cjs.js:108, 141-151, 263-277`; declaration shows both methods `private` (`index.d.ts:74-75`) |
| Value shape required | Duck-typed `{ name, version, isFallback }`. `generationStateless` maps it to `promptName`/`promptVersion` and DROPS it entirely when `isFallback` is truthy | `langfuse-core/lib/index.cjs.js:993-1003`, `1033-1041`; typed as `LangfusePromptRecord \| LangfusePromptClient` (`langfuse-core/lib/index.d.ts:7097-7099, 7129-7131`) |
| `langfuse*` metadata keys leak? | No — `joinTagsAndMetaData` strips `["langfusePrompt","langfuseUserId","langfuseSessionId"]` before upload | `langfuse-langchain/lib/index.cjs.js:581-587` |
| `getPrompt` signature | `getPrompt(name, version?: number, options?: { label?, cacheTtlSeconds?, fallback?, maxRetries?, type?: "text", fetchTimeoutMs? })` — **`version` is the 2nd POSITIONAL arg**, so `proposal.md` decision 5's `getPrompt(name, {label…})` sketch is wrong for this version | `langfuse-core/lib/index.d.ts:7484-7499` |
| `cacheTtlSeconds: 0` | Forces a live fetch every call and, with no `fallback` option supplied, RE-THROWS on failure — precisely the "repo-owned TTL is the only cache, provider owns fallback" contract | `langfuse-core/lib/index.cjs.js:1983-2028` |

**Linking precondition — identified, and MET by design (flat-sequence decomposition).**
`registerLangfusePrompt` only records the prompt when `handleChainStart` fires with a **truthy
`parentRunId`**, and `handleGenerationStart` looks the prompt up under the model run's OWN
`parentRunId` (`index.cjs.js:148, 263`). That requires a chain-start sibling *inside the same
sequence as the model, running before it* — Langfuse's documented pattern, where a
`ChatPromptTemplate` is the first step. Neither of our shapes produces it as written:

- `withStructuredOutput(schema, …)` without `includeRaw` returns `llm.pipe(outputParser)`
  (`@langchain/openai@0.6.17/dist/chat_models.js:1020-1022`, where `llm` is
  `this.withConfig({tools, tool_choice, ls_structured_output_format, …})`), i.e. a
  `RunnableSequence` whose FIRST step is the model. The only chain-start is the sequence itself,
  with `parentRunId === undefined` → nothing is registered; the model's lookup key (the sequence run
  id) misses.
- `model.stream(prompt, …)` in `streamReply` is a bare chat model: `parentRunId === undefined`, so
  the lookup falls back to the literal `"root"` key, which nothing ever writes.
- Merely *piping* a step in front does not fix it: neither `Runnable.pipe` nor
  `RunnableSequence.from` flattens a nested sequence
  (`@langchain/core@1.2.1/dist/runnables/base.js:911-918, 1039-1049`), so the model's parent would
  stay the inner sequence.

**The fix — decompose and rebuild ONE FLAT sequence** whose first step is our own prompt step:

```ts
const structured = model.withStructuredOutput(schema, opts);      // RunnableSequence [boundLlm, parser]
const chain = RunnableSequence.from([promptStep, ...structured.steps]);
```

`steps` is a PUBLIC getter returning `[first, ...middle, last]`
(`@langchain/core@1.2.1/dist/runnables/base.js:919-925`), and reusing those exact step objects
preserves the `withConfig` tool binding untouched. The run-id mechanics then satisfy the
precondition exactly (all verified in the installed core):

1. The outer sequence's own `handleChainStart` passes `config.runId` with the handler receiving
   `this._parentRunId === undefined` (`base.js:928`; `callbacks/manager.js:334`) → registers
   nothing, which is correct.
2. Each step is invoked with `patchConfig(config, { callbacks: runManager.getChild(…) })`
   (`base.js:934, 936`), and `getChild` builds `new CallbackManager(this.runId)` carrying the
   inheritable metadata (`callbacks/manager.js:155-162`). So `promptStep` — a `RunnableLambda`,
   whose `_callWithConfig` emits `handleChainStart` (`base.js:156-158`) — reaches the handler with
   `parentRunId = X` (the outer sequence's run id) AND the invoke-time
   `metadata.langfusePrompt` inherited intact (`manager.js:334` forwards `this.metadata`).
   `registerLangfusePrompt` stores the handle under `X`.
3. The model starts as a sibling child of the same sequence run, so `handleGenerationStart` sees
   `parentRunId = X` and `promptToParentRunMap.get(X)` **HITS** (`index.cjs.js:263-277`). The
   native `promptName`/`promptVersion` columns populate.

`streamReply` needs no decomposition — the model is not a sequence — so it wraps flat:
`RunnableSequence.from([promptStep, model])` and `.stream()` is called on the sequence
(`RunnableSequence._streamIterator`, `base.js:969-975`, emits the same chain-start/`getChild`
shape and still honours `config.signal` via `raceWithSignal`).

Three constraints this carries:

- **`promptStep` is a `RunnableLambda` identity over the ALREADY-RENDERED, ALREADY-MASKED string**
  (`RunnableLambda.from((prompt: string) => prompt)`), never a `ChatPromptTemplate` — LangChain
  templating would reinterpret the JSON braces in the output-format block, which is the same reason
  the `{{variable}}` renderer was chosen over it. Masking is therefore unaffected:
  `mask()` still runs on the rendered string BEFORE the value is handed to `.invoke`/`.stream`, so
  the prompt step, the sequence trace input and the model input are all the masked text and the
  callback never observes anything else.
- **Per-call shape guard, not a per-build assumption.** All five providers share this path and a
  provider (or a future `@langchain/*` bump) may hand back a different shape — notably
  `includeRaw: true` returns `RunnableSequence.from([{ raw: llm }, parserAssign])`, whose first step
  is a `RunnableMap` (`chat_models.js:1023-1034`), so blindly reparenting would be wrong. Each call
  therefore checks the shape with the duck-typed public statics
  `RunnableSequence.isRunnableSequence(thing)` (`base.js:1036-1038` — note it dereferences
  `thing.middle`, so a `null` check must precede it) and `Runnable.isRunnable(thing)`
  (`base.js:518-520`, via `isRunnableInterface`, so it is cross-realm safe unlike `instanceof`).
  A non-matching shape DEGRADES to the original runnable, untouched.
- **Output equivalence.** The rebuilt sequence returns its last step's output, i.e. the same parser
  output as before, so `WorkoutProgramSchema.parse(raw)` at the call site is unchanged.

**Degradation path (guard did not match).** The call still ships flat, scalar trace metadata that is
guaranteed to reach the trace and is filterable in the Langfuse UI: `promptSource: "langfuse" |
"fallback"`, plus `promptName`, `promptVersion`, `promptLabel: "production"` when and only when
`promptSource === "langfuse"`, plus `promptLinked: boolean` so a degraded call is visible rather
than mysterious. This alone satisfies every spec scenario for "Trace Attribution to Prompt Source
and Version"; the native columns are the bonus the happy path now earns.
`metadata.langfusePrompt = { name, version, isFallback: false }` is attached whenever the template
came from Langfuse (it is stripped from the uploaded metadata bag and carries no template body) and
omitted entirely on the fallback path — the SDK would drop it anyway via `isFallback`.

Consequence to state plainly in the PR and in `README`: on the happy path the Langfuse **Prompt tab
metrics** DO populate, because the flat-sequence decomposition satisfies the linking precondition.
When the shape guard declines, the call degrades to trace-level attribution only, flagged by
`promptLinked: false`, and generation/chat is unaffected either way.

## Architecture Decisions

| Decision | Choice | Rejected | Rationale |
|---|---|---|---|
| Handler lifetime | ONE handler per app instance, built in `app.ts`, injected | Per-call construction; module-level global | Per-call construction pays client setup per generation and multiplies auth failures; a module global is untestable. One instance also gives a single `flushAsync()` on Fastify `onClose`. |
| Handler injection | `buildAdapters(deps?)` + `PlanSpecExtractionAdapter(configRepo, factory, deps?)`, both optional | Reading env inside `invokeChain` | Matches the repo's injectable-factory style (`ExtractionModelFactory`, `BuildAppOptions`); existing `buildAdapters()` call sites and tests keep compiling. |
| Null-handler degradation | Conditional spread of `callbacks` | Always passing `callbacks: []` | Keeps the invoke config byte-identical to today when tracing is off, so no unrelated test or provider behaviour shifts. |
| Where `mask` runs | On the RENDERED string at the invocation sites for ALL THREE prompts. `mask` LEAVES `buildReplyPrompt`/`buildExtractionPrompt`; `limitationTermsOf` becomes exported | Masking inside the renderer; masking inside the provider | Resolves the documented asymmetry (`exploration.md` §3) at the only two places a payload can reach a callback, so the masking-payload test has exactly two targets. Keeps the renderer pure and synchronous while prompt *resolution* becomes async. |
| Template dialect | `{{variable}}` literal substitution only — no conditionals, no loops, no partials | Mustache/Handlebars; LangChain `PromptTemplate` | All conditional wording already collapses into pre-composed section strings (`memorySection`, `vocabularySection`, `taskExerciseRule`), so the renderer stays ~15 lines and provably total. LangChain templating would also reinterpret the JSON braces in the output-format block. |
| Validation | zod boundary schema + marker presence + marker ORDER + post-render `{{` sweep; reject whole template, never repair | Repairing a relocated section; warn-and-use | `spec.md` "Relocated closed-vocabulary section is rejected, not repaired". Order is contract: task rule 2 refers back to the vocabulary block. |
| Fetch timeout | Hardcoded `PROMPT_FETCH_TIMEOUT_MS = 3000` passed as `fetchTimeoutMs` | A second env var | A hung Langfuse must not stall generation; a second env var would need another compose forward for no operational benefit. |
| TTL env var | `LANGFUSE_PROMPT_CACHE_TTL_MS`, milliseconds, default `60000`; unparseable/non-positive → default, never throws | Seconds; `*_TTL` without unit | Units in the name are unambiguous and feed `cacheTtlMs` directly. MUST be added to `docker-compose.yml` `environment:` (PR #254 lesson). |
| Prompt names | `kinora-plan-generation`, `kinora-chat-reply`, `kinora-chat-extraction` | Slash-namespaced names | Flat, URL-safe, no encoding questions; one name per in-scope prompt. |
| Provider granularity | ONE `ResolvePrompt` instance, cache + `pending` keyed BY PROMPT NAME | One instance per prompt | Three names share one TTL policy and one warn sink; a `Map` keyed by name is fewer moving parts than three wired singletons. |
| Attribution split | `promptSource` ships in B2 with the remote path; the version handle + `langfusePrompt` in C | All attribution in C | Never let a remote-sourced trace exist without a source marker, not even for one slice. |
| Native version linking | Decompose `withStructuredOutput`'s sequence via its PUBLIC `steps` getter and rebuild ONE FLAT `RunnableSequence.from([promptStep, ...steps])`; wrap the bare streaming model as `[promptStep, model]`. Shape checked PER CALL with `RunnableSequence.isRunnableSequence` / `Runnable.isRunnable`; a non-matching shape degrades to the original runnable + metadata-only attribution | Piping a step in front (no flattening, so the model's parent stays the inner sequence); a `ChatPromptTemplate` first step (would reinterpret the JSON braces in the output-format block); accepting metadata-only attribution; upgrading to `@langfuse/langchain` v4 | This is the ONLY mechanism the installed SDK offers, and the flat shape is what makes its `parentRunId` precondition hold (see **Installed SDK Verification**). Reusing the exact step objects preserves the tool binding. The per-call guard matters because five providers share the path and `includeRaw: true` yields a `RunnableMap`-first shape; losing the native columns must never break generation. |

## Data Flow

    plan generation (invokeChain, adapter-factory.ts)
      buildPlanPromptVariables(spec)                      → Record<string,string>
      ResolvePrompt.execute(PLAN_PROMPT_DEFINITION, vars)
          cache hit (< TTL)                               → cached { text, source, name?, version? }
          cold / expired → pending? await it : start one:
              gateway === null (no credentials)           → local, reason "no_credentials"
              gateway.fetchPrompt(name, "production")
                  throw                                   → local, reason "fetch_failed" | "prompt_not_found"
                  ok → RemoteTemplateSchema.safeParse     → reject → local, reason <code>
              renderTemplate(template, vars)
                  residual "{{"                           → local, reason "unresolved_marker_after_render"
          cache the outcome (remote OR fallback) for cacheTtlMs
      mask(text, spec.limitations.map(l => l.text))       ← the ONLY masking point
      linkPromptStep(structuredChain)                     ← slice C, per-call shape guard
          isRunnableSequence → RunnableSequence.from([promptStep, ...structured.steps]), linked=true
          otherwise          → the original runnable unchanged,                          linked=false
      chain.invoke(maskedText, {
        runName: "plan-generation",
        metadata: { feature, provider, model, promptSource, promptLinked,
                    promptName?, promptVersion?, promptLabel?, langfusePrompt? },
        ...(handler ? { callbacks: [handler] } : {}) })
      WorkoutProgramSchema.parse(raw)                     ← unchanged by the restructure

    chat turn (extraction-adapter.ts) — identical, twice per turn
      streamReply : REPLY_PROMPT_DEFINITION      → render → mask → linkPromptStep(model) → .stream(...)
      extract     : EXTRACTION_PROMPT_DEFINITION → render → mask → linkPromptStep(structured) → .invoke(...)
      both carry { signal, runName, metadata, ...(handler ? { callbacks: [handler] } : {}) }

    why the link resolves (slice C)
      outer sequence start : parentRunId undefined                     → registers nothing
      promptStep start     : parentRunId = X, inherits langfusePrompt  → registered under X
      model start          : parentRunId = X                           → lookup HITS → promptName/promptVersion

    every fallback / handler failure
      observability.recordEvent({ level:"warn", event:"ai.prompt.fallback" | "ai.trace.handler_failed",
                                  outcome:<reasonCode>, metadata:{ promptName, errorName } })
      — scalar-only, PII-free (event-logger.ts:19-27); never a template body, never a credential

## File Changes

| File | Action | Description |
|---|---|---|
| `apps/api/src/ai/langfuse-handler.ts` | Create | `TracingHandler` type, `resolveLangfuseBaseUrl(env)`, `buildLangfuseCallbackHandler(opts)` → handler \| `null`; try/catch around construction; warn sink |
| `apps/api/src/ai/prompt-template.ts` | Create | `renderTemplate`, `templateVariablesOf`, `PromptDefinition`, `TEMPLATE_MARKER_OPEN` |
| `apps/api/src/ai/remote-template-validation.ts` | Create | `RemoteTemplateSchema` (zod), `validateRemoteTemplate(def, payload)` → `{ok:true,template} \| {ok:false,reason}`, `PromptRejectionReason` union |
| `apps/api/src/ai/prompt-source-port.ts` | Create | `LangfusePromptGateway` port: `fetchPrompt(name, label) → Promise<{ template: unknown; version: number }>`; `PromptResolution` type |
| `apps/api/src/ai/langfuse-prompt-gateway.ts` | Create | SDK adapter over `Langfuse` (re-exported by `langfuse-langchain`, so no new dependency); `buildLangfusePromptGateway()` → port \| `null` |
| `apps/api/src/ai/prompt-provider.ts` | Create | `ResolvePrompt` — TTL cache + per-name `pending` coalescing + validate + render + fallback + reason-coded warn |
| `apps/api/src/ai/prompt-linked-chain.ts` | Create (slice C) | `promptStep()`, `linkStructuredChain(structured)`, `linkStreamingModel(model)` — flat-sequence decomposition behind the per-call `isRunnableSequence` / `isRunnable` guards; each returns `{ chain, linked }` and never throws |
| `apps/api/src/ai/prompt.ts` | Modify | Export `PLAN_PROMPT_TEMPLATE`, `PLAN_PROMPT_DEFINITION`, `buildPlanPromptVariables`; `buildPlanPrompt` becomes the local-template wrapper over `renderTemplate` |
| `apps/api/src/ai/extraction-prompt.ts` | Modify | Same split for reply + extraction; `mask` call REMOVED from both builders; `limitationTermsOf` exported |
| `apps/api/src/ai/adapter-factory.ts` | Modify | `buildAdapters(deps?)`; `invokeChain(chain, spec, metadata, deps)` — resolve prompt, mask rendered text, conditional `callbacks`, attribution metadata; in C, route the chain through `linkStructuredChain` before `.invoke`; rewrite the superseded comment at 28-35 |
| `apps/api/src/ai/extraction-adapter.ts` | Modify | Third constructor arg `deps?`; both passes resolve → render → mask → attach; in C, `linkStreamingModel` for `streamReply` and `linkStructuredChain` for `extract` (the `ExtractionChatModel` interface gains no member — the wrapper is applied at the call site and the fake-model shape is exactly what the guard declines); rewrite the masking/observability docstring at 41-49 |
| `apps/api/src/ai/openrouter-generator.ts` | Modify | DELETE `OpenRouterPlanGenerator`; keep `warnIfAiConfigMissing`; drop now-unused imports |
| `apps/api/src/ai/__tests__/openrouter-generator.test.ts` | Delete | Class-only test (`warnIfAiConfigMissing` stays covered by `__tests__/startup-warning.test.ts`) |
| `apps/api/src/app.ts` | Modify | Build handler + gateway + `ResolvePrompt` once; pass `deps` to `buildAdapters` and `PlanSpecExtractionAdapter`; `onClose` best-effort `flushAsync()`; fix the stale comments at ~132 / ~224 |
| `docker-compose.yml` | Modify | Add `LANGFUSE_PROMPT_CACHE_TTL_MS: ${LANGFUSE_PROMPT_CACHE_TTL_MS:-60000}` to the api `environment:` with the forwarding-gotcha comment in house style |
| `apps/api/README.md` | Modify | Document `LANGFUSE_BASEURL` / `LANGFUSE_HOST` precedence, `LANGFUSE_PROMPT_CACHE_TTL_MS`, the three prompt names + the `production` label, and the Prompt-tab-metrics limitation |
| `apps/api/src/ai/__tests__/*` | Create/Modify | Per **Testing Strategy** |

No migration, no schema change, no new dependency (`langfuse-langchain` is already declared and
already allow-listed in `scripts/deps-guard.mjs:67`).

## Interfaces / Contracts

```ts
// ai/prompt-template.ts
export interface PromptDefinition {
  name: string;                    // "kinora-plan-generation" | "kinora-chat-reply" | "kinora-chat-extraction"
  localTemplate: string;           // the exported compiled-in constant
  variables: readonly string[];    // the CLOSED variable set the producer supplies
  requiredMarkers: readonly string[];   // must be present, e.g. "{{vocabularySection}}", "TASK:"
  orderedMarkers: readonly string[];    // must appear in THIS relative order
  maxTemplateChars: number;             // 20_000
}
export function renderTemplate(template: string, variables: Record<string, string>): string;

// ai/remote-template-validation.ts
export type PromptRejectionReason =
  | "no_credentials" | "fetch_failed" | "prompt_not_found"
  | "payload_not_string" | "payload_empty" | "payload_too_large"
  | "unknown_variable" | "missing_required_placeholder" | "marker_order_violated"
  | "unresolved_marker_after_render";

// ai/prompt-source-port.ts
export interface LangfusePromptGateway {
  fetchPrompt(name: string, label: string): Promise<{ template: unknown; version: number }>;
}
export interface PromptResolution {
  text: string;                                 // rendered, NOT masked
  source: "langfuse" | "fallback";
  name?: string;                                // present only when source === "langfuse"
  version?: number;                             // present only when source === "langfuse"
}

// ai/prompt-provider.ts
export class ResolvePrompt {
  constructor(gateway: LangfusePromptGateway | null, options?: {
    cacheTtlMs?: number;            // default resolvePromptCacheTtlMs(process.env) === 60_000
    now?: () => number;             // default Date.now
    warn?: (reason: PromptRejectionReason, promptName: string, errorName?: string) => void;
  });
  execute(def: PromptDefinition, variables: Record<string, string>): Promise<PromptResolution>;
}
export function resolvePromptCacheTtlMs(env: Record<string, string | undefined>): number;

// ai/langfuse-handler.ts — structural, so no test ever needs the real class
export interface TracingHandler { readonly name: string; flushAsync(): Promise<unknown>; }
export function buildLangfuseCallbackHandler(opts?: {
  env?: Record<string, string | undefined>;
  warn?: (errorName: string) => void;
}): TracingHandler | null;

// shared injection bag for both attachment sites
export interface AiTracingDeps { handler?: TracingHandler | null; prompts?: ResolvePrompt }

// ai/prompt-linked-chain.ts (slice C) — never throws; `linked` drives metadata.promptLinked
export interface PromptLinkedChain<T> { chain: T; linked: boolean }
/** Identity over the already-rendered, already-MASKED prompt string. Never a ChatPromptTemplate. */
export function promptStep(): Runnable<string, string>;
/** Reparents [boundLlm, parser] under one flat sequence: [promptStep, ...structured.steps]. */
export function linkStructuredChain<T extends { invoke: (i: string, o?: unknown) => Promise<unknown> }>(
  structured: T,
): PromptLinkedChain<T | Runnable<string, unknown>>;
/** Wraps a bare streaming chat model as a flat [promptStep, model] sequence. */
export function linkStreamingModel<T extends { stream: (i: string, o?: unknown) => Promise<unknown> }>(
  model: T,
): PromptLinkedChain<T | Runnable<string, unknown>>;
```

### Variable sets (exact, closed)

| Prompt | Variables | `requiredMarkers` | `orderedMarkers` |
|---|---|---|---|
| `kinora-plan-generation` | `goal`, `daysPerWeek`, `sessionDurationMinutes`, `location`, `equipmentList`, `preferenceStrength`, `preferenceHypertrophy`, `preferenceEndurance`, `preferenceMobility`, `intensityBiasSection`, `limitationsSection`, `memorySection`, `vocabularySection`, `taskExerciseRule` | `{{limitationsSection}}`, `{{memorySection}}`, `{{vocabularySection}}`, `TASK:`, `{{taskExerciseRule}}` | `{{limitationsSection}}` → `{{memorySection}}` → `{{vocabularySection}}` → `TASK:` → `{{taskExerciseRule}}` |
| `kinora-chat-reply` | `knownSection`, `missingSection`, `message`, `memorySection` | all four | `{{knownSection}}` → `{{missingSection}}` → `{{message}}` |
| `kinora-chat-extraction` | `knownSection`, `missingSection`, `assistantReply`, `message`, `memorySection` | all five | `{{knownSection}}` → `{{missingSection}}` → `{{assistantReply}}` → `{{message}}` |

`vocabularySection` and `taskExerciseRule` carry the #352 contract: the producer emits `""` for
both when `allowedExercises` is empty (byte-identical to pre-#352, `prompt.ts:80-89, 115-119`) and
the block + the back-reference together when it is not. The ORDER constraint is what makes task
rule 2's reference resolve; a template that moves or drops either marker is rejected whole.

### Validation algorithm (in order, first failure wins)

1. `RemoteTemplateSchema = z.string().min(1).max(def.maxTemplateChars)` → `payload_not_string` /
   `payload_empty` / `payload_too_large` (discriminated from the zod issue).
2. `templateVariablesOf(template) ⊆ def.variables` → else `unknown_variable`.
3. every `def.requiredMarkers` present → else `missing_required_placeholder`.
4. `indexOf` of each `def.orderedMarkers` is strictly increasing → else `marker_order_violated`.
5. after `renderTemplate`, `text.includes("{{")` → `unresolved_marker_after_render`.

Every rejection returns the local template AND emits one warn line carrying the reason code, the
prompt name and (for gateway failures) `error.name` — never the body, never a credential.

## Testing Strategy

Tests ship in the SAME commit as their module (apps/api functions threshold 85% via `test:coverage`; current headroom is thin, ~86.84%).

| Slice | Layer | What | Approach |
|---|---|---|---|
| A1 | Unit `langfuse-handler.test.ts` | `null` when either key missing; `null` (+1 warn) when construction throws; `baseUrl` precedence `LANGFUSE_BASEURL ?? LANGFUSE_HOST`; neither set → no explicit `baseUrl` | Injected `env` record; `vi.mock("langfuse-langchain")` with a throwing/recording ctor — no real client, no network, no credentials |
| A1 | Unit `adapter-factory.test.ts:135-151` **inverted** | Rename to "attaches the injected tracing handler"; `buildAdapters({ handler })` → `mockInvoke.mock.calls[0][1]` **does** contain `callbacks: [handler]`; a second case with `buildAdapters()` asserts the config still has NO `callbacks` key | Same hoisted `vi.mock` setup; `beforeEach` additionally deletes `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` |
| A1 | Unit **masking payload** | `limitations: [{text:"osteoporosis"}]`; assert the invoke input contains `[REDACTED]` and NOT `osteoporosis`, AND `JSON.stringify([invokeInput, resolvedProgram])` does not contain the term. Documented proxy: with a mocked chain the callback observes exactly this input plus the returned program | Extends the existing fake-chain harness |
| A2 | Unit `extraction-adapter.test.ts` | `streamReply` and `extract` each pass `callbacks:[handler]` when injected and omit the key when not; both payloads masked for a KNOWN limitation; `signal`/`runName`/`metadata` unchanged | Existing fake `ExtractionChatModel` records call options |
| B1 | Unit `prompt-template.test.ts` | substitution, repeated variable, empty-string variable, unknown `{{x}}` left intact (so step 5 catches it), no-variable template | Pure |
| B1 | Unit **byte-identical snapshot** | `renderTemplate(PLAN_PROMPT_TEMPLATE, buildPlanPromptVariables(spec))` `===` the pre-refactor `buildPlanPrompt(spec)` output, for: no memory / memory / `allowedExercises` empty / non-empty / each `intensityBias`. Same for both chat prompts. Plus `toMatchSnapshot()` to freeze wording against future drift | Extends `prompt.test.ts`, `extraction-prompt.test.ts`; existing content assertions stay green unchanged |
| B1 | Unit masking relocation | `buildReplyPrompt`/`buildExtractionPrompt` now return UNMASKED text; the adapter tests from A2 prove the masked value is what reaches the model/callback | Moves the existing in-builder masking assertions to `extraction-adapter.test.ts` |
| B2 | Unit `remote-template-validation.test.ts` | one case per reason code, including: vocabulary placeholder dropped; vocabulary block moved AFTER `TASK:` → `marker_order_violated` and NOT repaired; `{{nope}}` → `unknown_variable`; over-cap payload; non-string; empty | Pure, table-driven |
| B2 | Unit `prompt-provider.test.ts` (template: `billing-pricing.test.ts`) | warm cache → 0 gateway calls; cold-cache burst of N concurrent `execute` → exactly 1 `fetchPrompt`; each failure class → local text + `source:"fallback"` + the right reason code; fallback cached (2nd call in window → 0 calls); TTL expiry retries; `gateway === null` → `no_credentials` with no call; `resolvePromptCacheTtlMs` for unset / valid / `"abc"` / `0` / `-5` | Fake gateway + injected `now` + spy warn sink; no network |
| B2 | Unit local-vs-remote equivalence | fake gateway returns EXACTLY `PLAN_PROMPT_TEMPLATE` → `execute()` text is byte-identical to the local path, with `source:"langfuse"` | Fake gateway |
| B2 | Unit compose forward | Assert `docker-compose.yml` api `environment:` lists `LANGFUSE_PROMPT_CACHE_TTL_MS` | Read the file in-test (mirrors the existing env-forwarding guard style) |
| C | Unit attribution | remote → metadata has `promptSource:"langfuse"`, `promptLinked`, `promptName`, `promptVersion`, `promptLabel:"production"`, `langfusePrompt:{name,version,isFallback:false}`; fallback → `promptSource:"fallback"` and NO `promptName`/`promptVersion`/`langfusePrompt` key | Assert the recorded invoke/stream options at both attachment sites |
| C | Unit **run-parenting** `prompt-linked-chain.test.ts` | A fake callback handler (a plain object with `handleChainStart` / `handleChatModelStart`, passed via `callbacks`) records `(runId, parentRunId, metadata)` per event. Assert: the outer sequence starts with `parentRunId === undefined`; `promptStep` starts with a defined `parentRunId === X` AND received the inherited `metadata.langfusePrompt`; the MODEL step starts with the same `parentRunId === X` — i.e. the lookup key the SDK uses is the key the prompt was registered under | Real `RunnableSequence`/`RunnableLambda` from `@langchain/core` plus a ~15-line offline `BaseChatModel` subclass whose `_generate` returns a canned `AIMessage`, so the assertion lands on a genuine `handleChatModelStart`. No network, no credentials, no SDK mock (`@langchain/core@1.2.1` ships no exported test fakes, hence the local subclass) |
| C | Unit **guard degradation** | `linkStructuredChain(plainObjectWithInvoke)` returns `{ chain: sameReference, linked: false }`; same for `null`/`undefined` (no throw, despite `isRunnableSequence` dereferencing `.middle`); an `includeRaw`-shaped `RunnableMap`-first sequence is NOT reparented; a declined call still carries full metadata attribution with `promptLinked: false` and still generates successfully | Table-driven; reuses the existing plain-object fake models, which are exactly the declined shape |
| C | Unit **output equivalence** | For the same input, the reparented flat sequence and the untouched `withStructuredOutput` sequence produce an identical parsed result, and `WorkoutProgramSchema.parse` still succeeds | Offline `BaseChatModel` subclass returning a canned `WorkoutProgram` JSON; assert deep equality before/after the restructure |
| all | Existing suites | `app.test.ts` and route suites keep passing with no credentials (handler is `null`, provider gateway is `null`, prompts resolve locally) | No change |

## Threat Matrix

| Boundary | Risk | Control |
|---|---|---|
| Remote template (untrusted third-party input) | Prompt injection / silent quality regression / dropped closed vocabulary | Closed variable set, required + ORDERED markers, size cap, post-render sweep, reject-never-repair, fail closed to local (`remote-template-validation.ts`) |
| Outbound trace payload | Health/limitation text reaching a third party | `mask()` on the rendered string at both attachment sites; masking-payload tests; traced output is `WorkoutProgramSchema`-shaped with no limitation-bearing field; first-mention gap explicitly ACCEPTED (`spec.md`) with a follow-up issue |
| Log lines | Credential or template body leakage | Reason codes + `error.name` only, through `ObservabilityLogger` whose metadata type is scalar-only (`event-logger.ts:19-27, 33-36`) |
| Request path | Langfuse outage/auth failure breaking generation or chat | Handler nullable and never awaited on the hot path; 3 s `fetchTimeoutMs`; provider catches every failure class; fallback cached; TTL parse never throws at startup |
| Credentials | Wrong host silently used | Explicit `baseUrl` with `LANGFUSE_BASEURL ?? LANGFUSE_HOST` precedence, never implicit SDK pickup |
| Chain restructure (slice C) | Reparenting provider internals breaks generation for one of five providers | Per-call duck-typed shape guard degrades to the untouched runnable; step objects are reused so the tool binding is preserved; output-equivalence and degradation tests; `config.signal` still honoured by `RunnableSequence` (`base.js:934`); `mask()` runs BEFORE the value enters the sequence, so the added span observes only masked text |

No subprocess, VCS automation, executable-file classification or routing-shell boundary.

## Migration / Rollout

No schema change, no migration, no new dependency. `LANGFUSE_PROMPT_CACHE_TTL_MS` is optional
everywhere (safe default in code + a defaulted compose forward), so deploying B needs no `.env`
edit on the VPS. A1 is deliberately deploy-safe against INVALID production credentials: it either
produces the first real trace or exactly one secret-free warn line, which is how credential
validity finally gets answered. Rollback follows `proposal.md`: unset the credentials (handler →
`null`, gateway → `null`) reverts to today's behaviour with no code change; unlabelling the prompt
in Langfuse forces the fallback path with no deploy; C is metadata-only.

## Task Slice Estimate

Budget: 800 changed lines per PR, auto-chain.

| PR | Content | Non-test / test (est.) | Budget risk |
|---|---|---|---|
| A1 | `langfuse-handler.ts` + `buildAdapters(deps)` + `invokeChain` attachment + `app.ts` wiring & `onClose` flush + delete `OpenRouterPlanGenerator` (+ its test) + invert `adapter-factory.test.ts:135-151` + masking-payload test + README | ~130 / ~190, minus ~200 deleted | Low |
| A2 | Extraction-adapter `deps` + attach at `streamReply`/`extract` + tests | ~35 / ~100 | Low |
| B1 | Renderer + the three template constants + variables producers + `mask` relocation + byte-identical/snapshot tests | ~330 / ~400 | **Medium-High** |
| B2 | Port + SDK gateway + `ResolvePrompt` + validation + wiring + `promptSource` + compose/README + tests | ~400 / ~380 | **Medium-High** |
| C | Version handle + `langfusePrompt` + `prompt-linked-chain.ts` (flat-sequence decomposition + guards) + wiring at both attachment sites + attribution/parenting/degradation/equivalence tests | ~75 / ~280 | Low |

**C still fits the 800-line budget comfortably.** The amendment grows C from ~160 to ~355 changed
lines (~75 non-test: `prompt-linked-chain.ts` ≈45 including the guards and docstring, ~15 at the two
plan/extraction call sites, ~15 of attribution metadata; ~280 test, dominated by the offline
`BaseChatModel` subclass and the four new cases). That is under half the budget, so C stays one PR
and needs no further split.

`Chained PRs recommended: Yes` — the proposal's single B slice measures ≈1370 lines and MUST split
into B1 (renderer, no network path, behaviour byte-identical) and B2 (remote source). B1 and B2 each
land near ~730; if review measures either over 800, split further along the seam already present in
the code: **B1a** = plan prompt only (`prompt.ts` + renderer + its tests), **B1b** = the two chat
prompts + the `mask` relocation; **B2a** = port + gateway + validation, **B2b** = `ResolvePrompt` +
call-site wiring + compose/README. No slice depends on a later one's internals: after B1 the local
path is unchanged, after B2a nothing is wired yet.

## Open Questions

- [ ] The three prompts must exist in the Langfuse project under the `production` label as TEXT
      prompts before B2 has anything to fetch. Until then B2's shipped behaviour is
      `prompt_not_found` → local template, which is a valid (and tested) steady state, not a bug.
- [ ] Confirm during RED that no test outside `openrouter-generator.test.ts` constructs
      `OpenRouterPlanGenerator` (grep clean at design time; `app.ts:21` imports only
      `warnIfAiConfigMissing`).
- [ ] Follow-up issue to file (proposal answer 4): first-mention limitation masking gap, now that a
      real trace channel exists.
- [ ] Native `promptName`/`promptVersion` linkage no longer needs a follow-up for the reason first
      recorded here — the flat-sequence decomposition in C satisfies the SDK's precondition. What
      DOES need confirming once, out of band, is that the Prompt tab actually populates against the
      live project after C deploys; if it does not, `promptLinked: true` in the traces localizes the
      remaining gap to the SDK rather than to our wiring. A `@langfuse/langchain` v4 migration
      remains optional and unrelated to this change.
- [ ] The C guard couples us to `withStructuredOutput` returning a two-step sequence. Re-run the
      `prompt-linked-chain` tests on any `@langchain/openai`, `@langchain/anthropic`,
      `@langchain/google-genai` or `@langchain/core` bump: a shape change degrades silently and
      safely (by design) but would quietly stop populating the native columns, visible as
      `promptLinked: false`.
