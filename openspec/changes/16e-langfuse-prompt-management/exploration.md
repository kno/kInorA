# Exploration — langfuse-prompt-management (serve LLM prompts from Langfuse instead of the image)

GitHub issue: #366 (`enhancement`, `status:approved`). Real implementation change. Scope A (open the
tracing channel) is a hard prerequisite for scope B (remote prompts with local fallback) and scope C
(link traces to the prompt version that produced them).

## Goal

Move three compiled-in prompt builders behind a runtime prompt source hosted in Langfuse, so a prompt
change stops requiring a code change, a PR, a CI run, a build and a deploy — without ever letting an
unreachable prompt service break plan generation, and without breaking the masking invariant that
keeps limitation text out of trace payloads.

## 1. Issue premise verdict — CONFIRMED: prepared, not connected

The issue's own correction to its premise holds. Evidence:

- `apps/api/package.json:31` — `"langfuse-langchain": "^3.38.20"` is a declared dependency.
- `docker-compose.yml:81-83` forwards `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_HOST`;
  `apps/api/README.md:30-32` marks them required in production.
- **Zero live `CallbackHandler` construction anywhere in source.** A case-insensitive repo grep for
  `langfuse` / `CallbackHandler` over `apps/api/src` excluding `__tests__` returns only comments:
  `extraction-prompt.ts:36`, `openrouter-generator.ts:74`, `mask.ts:4`, `adapter-factory.ts:183`.
  Plus `scripts/deps-guard.mjs:67` (a `/langfuse/i` allowlist pattern — a gate, not usage).
- `apps/api/src/ai/__tests__/adapter-factory.test.ts:51-52` deletes `LANGFUSE_BASEURL` and
  `LANGFUSE_HOST` in `beforeEach`, implying `adapter-factory.ts` once read them. It does not today:
  it imports only `@langchain/openai`, `@langchain/anthropic`, `@langchain/google-genai`.
- `invokeChain` (`adapter-factory.ts:36-56`) and the extraction adapter pass only
  `{ runName, metadata: { feature, provider, model } }` to `.invoke`/`.stream` — no `callbacks` key.
  `adapter-factory.test.ts:135-151` asserts `expect.not.objectContaining({ callbacks: ... })`.

So tracing is not running either, and the masking machinery in `mask.ts` currently guards a channel
that is closed.

### New finding not in the issue: `LANGFUSE_BASEURL` vs `LANGFUSE_HOST`

`docker-compose.yml` forwards `LANGFUSE_HOST` but **not** `LANGFUSE_BASEURL`. The Langfuse JS/TS SDK's
primary env var is `LANGFUSE_BASEURL` (`LANGFUSE_HOST` is the Python-SDK name). If scope A constructs
`new CallbackHandler()` with no explicit `baseUrl`, it may silently ignore the host configured in
production. The proposal must resolve this explicitly — either forward `LANGFUSE_BASEURL` or pass
`baseUrl` from `LANGFUSE_HOST` — and must not assume the existing forwarding is sufficient.

## 2. Composition point — `apps/api/src/ai/adapter-factory.ts`

- `buildAdapters()` (`adapter-factory.ts:185-193`) returns five factories keyed by provider
  (`openrouter`, `openai`, `anthropic`, `google`, `opencode-go`), each `(model: string) => PlanGenerator`.
- Each factory constructs a fresh LangChain chat model, reading its API key from `process.env` at
  factory-call time (not module load): `OPENROUTER_API_KEY` (65), `OPENAI_API_KEY` (92),
  `ANTHROPIC_API_KEY` (112), `GOOGLE_GENERATIVE_AI_API_KEY` (132), `OPENCODE_GO_API_KEY` (158), then
  `.withStructuredOutput(WorkoutProgramSchema, ...)`.
- All five funnel through the shared `invokeChain` (36-56): build prompt via `buildPlanPrompt` → `mask`
  → `chain.invoke(maskedPrompt, { runName: "plan-generation", metadata: {...} })` →
  `WorkoutProgramSchema.parse(raw)`. **One choke point for both the callback handler and the remote
  prompt.**
- Consumed by `DynamicPlanGenerator` (`dynamic-generator.ts`), which reads the active provider/model
  from the DB on every call (no caching) and falls back to `openrouter` + `OPENROUTER_MODEL`. Injected
  via `buildApp()` (`app.ts:228+`).
- **Possible duplicate path:** `apps/api/src/ai/openrouter-generator.ts` holds an
  `OpenRouterPlanGenerator` class duplicating the same prompt/mask/invoke/parse sequence; only its
  `warnIfAiConfigMissing()` helper is still imported (`app.ts:21`). Confirm whether the class is dead
  before wiring only one of the two paths — otherwise they silently diverge.

## 3. In-scope prompts

- **`buildPlanPrompt(spec: PlanPromptInput)`** — `apps/api/src/ai/prompt.ts:46`. Pure, no I/O.
  `PlanPromptInput = PlanSpec & { memoryContext?, allowedExercises? }`. Interpolates goal,
  `daysPerWeek`, `sessionDurationMinutes`, location, equipment, preference scores, the 14b intensity
  bias section, limitations, and a sanitized memory section guarded by `UNSAFE_MEMORY_PATTERNS`.
  - **#352 slice B vocabulary section (lines 80-89):** when `allowedExercises.length > 0`, injects the
    `ALLOWED EXERCISES — CLOSED VOCABULARY` block demanding verbatim exercise names, positioned after
    the profile and before the task block *on purpose* — task rule 2 references it back. With no
    `allowedExercises` the prompt is byte-identical to pre-#352. Any remote-prompt mechanism must
    preserve this interpolation contract **and** the section placement.
- **`buildReplyPrompt(input: ChatExtractInput)`** — `extraction-prompt.ts:106`.
- **`buildExtractionPrompt(input, assistantReply)`** — `extraction-prompt.ts:150`.
  Both share `buildContextSections()` (known / missing / memory) and `limitationTermsOf()`, and both
  mask *inside* the builder (`return mask(rawPrompt, limitationTermsOf(input))`) — unlike
  `buildPlanPrompt`, where masking happens at the call site. That asymmetry matters for where a remote
  template can safely be substituted.

## 4. Masking invariant and the test gap

- `mask(text, limitations)` (`mask.ts:17-29`) is pure and literal (non-regex `split().join("[REDACTED]")`
  per term); an empty array is a no-op.
- Call sites: inside `buildReplyPrompt` / `buildExtractionPrompt`, and at the call site in `invokeChain`
  and `OpenRouterPlanGenerator.generate`, always before `.invoke`.
- **No test today exercises a trace payload** — impossible, since no handler exists to receive one. The
  nearest proxy is `adapter-factory.test.ts:135-151` ("does not attach callbacks to raw model output").
  Once scope A attaches a callback, that test must be extended (or a sibling added) asserting the
  callback only ever observes the already-masked prompt string.
- **Pre-existing accepted gap:** a limitation mentioned for the first time in `message` is not masked in
  that turn's prompt, by design — the extractor must see it once to populate `limitations` (documented
  in `extraction-prompt.ts` docstrings). Scope A makes this gap visible in a real observability backend
  for the first time. Treat it as a risk to explicitly accept or tighten, not as a new bug.

## 5. Test setup, offline strategy, coverage gate

- Vitest: `"test": "vitest run"`, `"test:coverage": "vitest run --coverage"` (`apps/api/package.json`).
  CI and pre-push run `test:coverage` with an apps/api functions threshold of 85% (repo default 100, web 90); plain `test` does not
  enforce it. Any new module needs tests in its first commit, not bolted on later.
- Network avoidance: every LangChain client is class-mocked with hoisted `vi.mock(...)` before
  `await import("../adapter-factory.js")` (`adapter-factory.test.ts:1-27`).
  `MockPlanGenerator` / `MockSpeechTranscriber` / `MockSpeechSynthesizer` are `BuildAppOptions`
  injectables so route tests avoid real LLM calls.
- Prompt unit tests (`prompt.test.ts`, `extraction-prompt.test.ts`) call the pure builders directly and
  are genuinely offline — issue #366 requires this stays true with no network and no credentials.
- No Langfuse fake or fixture exists anywhere. Scope A introduces the first one: either an injectable
  factory (mirroring `ExtractionModelFactory`) or a construction pattern tests never need to stub.

## 6. Reusable repo patterns (do not invent new ones)

- **TTL cache + safe fallback + burst coalescing — the template for scope B:**
  `apps/api/src/billing/billing-pricing.ts`, `ResolveBillingPricing` (69-136). Injectable `cacheTtlMs`
  (default 5 min) and `now: () => number` for tests; a single `private pending: Promise<...> | null`
  coalesces a concurrent burst on a cold/expired cache into one upstream call (an already-reviewed fix
  per its docstring); on any failure it falls back, warns through an injectable `warn` sink carrying no
  secret or id, and caches the fallback too so a brownout does not hammer upstream.
  `billing-pricing.test.ts` is the ready-made test template for the injectable-clock / fake-gateway style.
- **Fetch-with-fallback + typed result union:**
  `apps/web/src/app/(app)/exercises/exercise-catalog-client.ts` (`fetchExerciseCatalogList`,
  `fetchExerciseCatalogFacets`) — never throws; `{kind:"error", message:"api_unreachable"}` on transport
  failure, `{kind:"error", message:"invalid_response"}` on a zod `safeParse` mismatch, `{kind:"ok"}`
  otherwise.
- **Untrusted-input validation:** zod is the house style (`WorkoutProgramSchema.parse`,
  `PlanSpecDraftSchema.parse`, `ExerciseCatalogListResponseSchema.safeParse`). A remote-fetched template
  is untrusted input and gets the same boundary validation.

## 7. Approach options for scope B

### Option 1 — call the Langfuse SDK `getPrompt(name, { label, cacheTtlSeconds })` inline

- Pros: minimal new code; the SDK ships its own cache (60s default TTL).
- Cons: the vendor cache is opaque and cannot be unit-tested independently — doubles would have to fake
  the whole SDK client, unlike this repo's `vi.mock` style; the issue's "record the fallback"
  requirement needs a wrapper anyway, because `getPrompt` emits no such signal; TTL and eviction are
  not repo-controlled.

### Option 2 (recommended) — repo-owned prompt provider mirroring `ResolveBillingPricing`

A `PromptProvider` / `ResolveRemotePrompt` class over a narrow `LangfusePromptGateway` port
(`fetchPrompt(name, label): Promise<{ template, version }>`), falling back to the compiled-in
`buildPlanPrompt` / `buildReplyPrompt` / `buildExtractionPrompt` template on any gateway failure —
structurally identical to `pricingFromStripePrices` falling back to `buildBillingPricing(fallbackEnv)`.

- Pros: reuses an already-reviewed, already-tested pattern; fully unit-testable with a fake gateway and
  no SDK mocking; the fallback is an explicit, loggable event; the returned `{ template, version }`
  gives scope C a first-class version handle.
- Cons: more code (port + adapter + use case) than one SDK call — the same tradeoff already accepted for
  Stripe pricing.
- The options are not exclusive: the gateway adapter can call the SDK's `getPrompt` with
  `cacheTtlSeconds: 0`, leaving the repo-owned TTL as the single cache.

### Scope C — linking a trace to a prompt version

The JS `CallbackHandler` accepts prompt-linking metadata carrying the linked prompt/version. **The exact
key must be verified against the installed `langfuse-langchain@^3.38.20` TypeScript types** — do not
assume the Python-SDK shape, and note that a `@langfuse/langchain` v4 line exists with different
ergonomics. Linking only applies when the prompt actually came from Langfuse; a fallback-served prompt
should instead carry an explicit `promptSource: "fallback"` metadata flag, so a fallback trace is
visibly distinguishable rather than silently attributed to the current remote version. The proposal must
decide this explicitly.

## 8. Risks and open questions for the proposal

1. `LANGFUSE_BASEURL` vs `LANGFUSE_HOST` mismatch (new finding) — confirm which var the installed SDK
   reads; compose forwards only `LANGFUSE_HOST`.
2. **Production credential validity is genuinely unknown.** They have been set for a long time with
   nothing reading them. There is no way to verify them from this repo without either shipping scope A
   (then checking the Langfuse project for a real trace or an auth-failure log line) or having the
   operator test them in the Langfuse UI out of band. No secret is ever printed or logged to check this.
3. `OpenRouterPlanGenerator` may be dead/duplicate code — confirm before wiring only one of the two
   prompt/mask/invoke paths.
4. The exact prompt-version-linking metadata key must be verified against the installed SDK types.
5. The apps/api 85% functions coverage gate (currently ~86.84% — thin headroom) requires tests shipped with the first commit of any new module.
6. Scope A surfaces the pre-existing first-mention limitation masking gap into a real observability
   backend for the first time — explicitly accept or tighten it now that it has an audience.
7. Callback-attachment scope: decide exactly where the handler attaches (`invokeChain`, and/or the
   extraction adapter's `streamReply` / `extract`), and extend the existing "no callbacks on raw output"
   test to assert the callback only ever sees the already-masked prompt.

## Recommendation

Take scope A, B and C in that order, with Option 2 for scope B. Scope A is small and independently
valuable: it settles credential validity and turns `mask.ts` into load-bearing code with a test that
proves it. Delivery is `auto-chain` at an 800-line review budget, so the natural slices are A (wire the
handler + masking test), B (prompt provider + fallback + validation), C (version linking + fallback
attribution).
