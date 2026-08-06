# Proposal: langfuse-prompt-management (serve LLM prompts from Langfuse instead of the image)

GitHub #366 (`enhancement`, `status:approved`). Real implementation. Scope A (open the tracing channel)
is a hard prerequisite for scope B (remote prompts with mandatory local fallback) and scope C (link a
trace to the prompt version that produced it). Builds on
`openspec/changes/16e-langfuse-prompt-management/exploration.md` — do not re-derive its evidence.

## Intent

Three prompt builders are compiled into the image: `buildPlanPrompt` (`apps/api/src/ai/prompt.ts:46`),
`buildReplyPrompt` and `buildExtractionPrompt` (`apps/api/src/ai/extraction-prompt.ts:106,150`). Today a
one-word prompt change costs a code change, a PR, a CI run, a build and a deploy, which makes prompt
iteration slower than the product needs it to be.

`langfuse-langchain` is a declared dependency (`apps/api/package.json:31`), credentials are forwarded in
production (`docker-compose.yml:81-83`) and documented as required (`apps/api/README.md:30-32`), but
**nothing in `apps/api/src` constructs a `CallbackHandler`** — only comments mention Langfuse. So no
trace has ever been emitted, the masking machinery in `mask.ts` guards a channel that is closed, and the
production credentials have never been exercised.

Success: a prompt version is promoted in Langfuse and takes effect on the next generation with no deploy;
every generation and chat call is traced and attributable to the exact prompt version that produced it;
and an unreachable, unauthenticated or malformed prompt service degrades to the compiled-in prompt with a
visible signal, never to a failed plan generation.

## Scope

### In Scope

- **A. Tracing channel.** A `buildLangfuseCallbackHandler()` factory that returns `null` when credentials
  are absent or construction fails, attached at `invokeChain` (`adapter-factory.ts:36-56`) and at the
  extraction adapter's `streamReply` / `extract`.
- **A. Safe-by-construction failure.** Handler construction, trace emission and flush never reject the
  request path; an auth or transport failure emits one structured, secret-free log line through the
  existing observability logger.
- **A. Dead-path removal.** Delete the unwired `OpenRouterPlanGenerator` class (and its test) so a second,
  untraced prompt/mask/invoke path cannot silently diverge from the traced one.
- **A. Masking test.** A test that fails if unmasked limitation text reaches any callback payload.
- **B. Remote prompt source.** A repo-owned prompt provider over a narrow Langfuse gateway port, serving
  the three in-scope prompts under the fixed `production` label, with the compiled-in template as
  mandatory fallback, a repo-owned TTL cache and burst coalescing.
- **B. Untrusted-template validation** at the boundary, failing closed to the local template.
- **C. Version linking.** Prompt/version linkage on the traces produced by a remote template, and explicit
  `promptSource: "fallback"` attribution when the local template was used.
- Env resolution decision (below), `apps/api/README.md` env documentation, tests shipped in the same
  commit as each new module.

### Out of Scope

- Prompt A/B testing infrastructure; an evaluation harness; self-hosting Langfuse; any prompt other than
  `buildPlanPrompt`, `buildReplyPrompt`, `buildExtractionPrompt`.
- A label-selection env var (see decision 3). Prompt authoring/editorial workflow in the Langfuse UI.
- Tightening the pre-existing first-mention limitation masking gap (accepted risk, follow-up).
- Any change to `WorkoutProgramSchema`, plan domain logic, or the AI provider admin config.

## Capabilities

### New Capabilities

- `langfuse-prompt-management`: runtime prompt delivery from Langfuse under the `production` label with a
  mandatory compiled-in fallback, plus LLM tracing with prompt-version attribution.

### Modified Capabilities

- Plan generation and chat extraction gain a traced, remotely-sourced prompt path. Behaviour with no
  Langfuse credentials, or with invalid ones, must be byte-identical to today's prompts.

## Approach & Pinned Decisions

**1. `LANGFUSE_BASEURL` vs `LANGFUSE_HOST` → pass `baseUrl` explicitly in code, precedence
`LANGFUSE_BASEURL ?? LANGFUSE_HOST`. No new compose var required.** The JS SDK reads `LANGFUSE_BASEURL`;
compose forwards only `LANGFUSE_HOST` (`docker-compose.yml:81-83`). Relying on implicit SDK env pickup
would silently ignore the configured production host. Relying on a *new* forwarded var repeats a known
production failure mode in this repo: compose forwards only what is listed in `environment:`, and a
missing forward is invisible in local `pnpm dev`. Reading both in code means the already-set production
`LANGFUSE_HOST` works with zero env or deploy change, while `LANGFUSE_BASEURL` keeps working for local dev
and SDK convention. Both names get documented in `apps/api/README.md`.

**2. `OpenRouterPlanGenerator` is dead production code → delete the class; keep
`warnIfAiConfigMissing`.** Verified: `apps/api/src/app.ts:21` imports only `warnIfAiConfigMissing`; the
class is constructed nowhere in `apps/api/src` except `__tests__/openrouter-generator.test.ts`. `app.ts:132`
and `app.ts:224` mention it in stale comments only. Consequence of leaving it: a second prompt/mask/invoke
path that scope A would not trace and scope B would not update — guaranteed silent divergence. Slice A1
deletes the class and its test, updates the stale comments, and leaves `warnIfAiConfigMissing` where it is
(covered by `__tests__/startup-warning.test.ts`); an optional mechanical rename of the module is a nicety,
not a requirement.

**3. Fixed `production` label.** The code always requests the `production` label. Promotion happens in
Langfuse; no env var, no deploy. No label-selection knob is designed.

**4. Callback attachment → `invokeChain` AND the extraction adapter, and this deliberately reverses a
documented decision.** `invokeChain` (`adapter-factory.ts:36-56`) is the single choke point for all five
plan providers, so one attachment traces them all; the extraction adapter's `streamReply`/`extract` must
be attached too, otherwise the two chat prompts in scope B and C get no trace and no version linkage.
`adapter-factory.ts:28-35` and `openrouter-generator.ts:31-34` currently state that **no** callback is
attached, because callbacks observe raw structured model output before this boundary can validate or
redact it. Scope A supersedes that rationale explicitly, with three compensating controls: (a) limitation
text is masked on the way in, before `.invoke`; (b) the traced output is a `WorkoutProgramSchema`-shaped
program with no limitation-bearing field; (c) the masking test in A1 asserts every payload the callback
observes — input *and* output — is free of unmasked limitation terms. The superseded comments are rewritten
rather than deleted, so the reasoning stays discoverable. `adapter-factory.test.ts:135-151`
(`expect.not.objectContaining({ callbacks })`) is intentionally inverted by this change.

**5. Scope B → ADOPT the repo-owned provider (exploration Option 2), REJECT bare SDK `getPrompt`.**
Mirror `ResolveBillingPricing` (`apps/api/src/billing/billing-pricing.ts:69-136`): injectable
`cacheTtlMs` and `now: () => number`, a single `pending` promise coalescing a cold-cache burst into one
upstream call, fallback on any failure through an injectable secret-free `warn` sink, and the fallback
cached too so a Langfuse brownout does not hammer upstream. Rationale: the vendor cache is opaque and
untestable in this repo's `vi.mock` style; the issue's "record the fallback" requirement needs a wrapper
regardless, because `getPrompt` emits no such signal; and `{ template, version }` gives scope C a
first-class version handle. The gateway adapter calls the SDK's `getPrompt(name, { label: "production",
cacheTtlSeconds: 0 })`, leaving the repo-owned TTL as the single cache. Cost accepted: a port + adapter +
use case instead of one SDK call — the same tradeoff already accepted for Stripe pricing.

**6. Template shape → extract the local template, share one renderer.** Each builder is split into a
variables producer (context sections, the #352 allowed-exercise block, the sanitized memory section) and a
pure renderer over a `{{variable}}` template. The current wording becomes an exported local template
constant, so the local and remote paths run through the *same* renderer and a snapshot test proves output
is byte-identical when the remote template equals the local one. `mask` runs on the **rendered** string, at
the same call sites as today, so a remote template can never bypass masking.

**7. Untrusted remote template validation → fail closed to the local template.** Boundary validation in
house zod style, rejecting: a non-string, empty or over-size-cap payload; any `{{variable}}` not in the
variable set we supply; a missing required placeholder — specifically the #352
`ALLOWED EXERCISES — CLOSED VOCABULARY` section placeholder and the task-block reference that points back
to it (`prompt.ts:80-89`); a rendered result still containing unresolved `{{`. Section *placement* is part
of the contract, not decoration: task rule 2 references the vocabulary block back, so a template that
moves or drops it is rejected, not repaired. Any rejection logs a reason code (never the template body,
never a credential) and serves the local template.

**8. Fallback attribution → `promptSource: "langfuse" | "fallback"` on every trace.** Prompt/version
linking metadata is attached **only** when the template actually came from Langfuse. A fallback-served
prompt carries `promptSource: "fallback"` and no version link, so it is visibly distinguishable and never
silently attributed to the current remote version. The exact linking key must be verified against the
installed `langfuse-langchain@^3.38.20` TypeScript types during design — the Python-SDK shape and the
`@langfuse/langchain` v4 ergonomics both differ and must not be assumed. This proposal does not pin the
key; it pins the behaviour.

**9. Offline, credential-free tests are non-negotiable.** Prompt tests call the pure builders/renderer
directly; the handler factory returns `null` with no credentials, so no client is constructed under test;
provider tests use a fake gateway and an injected clock. CI and pre-push run `test:coverage` with an apps/api
functions coverage threshold of 85% (`apps/api/vitest.config.ts:31`; repo default is 100, apps/web overrides to 90), so every new module ships tests in its first commit.

### PR slicing (auto-chain, 800 changed-line budget)

| PR | Content | Budget shape |
|----|---------|--------------|
| A1 | Handler factory + env resolution + attach at `invokeChain` + masking-payload test + delete `OpenRouterPlanGenerator` (class + test) + invert `adapter-factory.test.ts:135-151` + README env docs | small; net may be negative after deletions |
| A2 | Attach the handler in the extraction adapter (`streamReply`, `extract`) + its masking-payload test | small |
| B | Renderer + local template constants for all three prompts + `PromptProvider` over `LangfusePromptGateway` + TTL/coalescing/fallback + template validation + tests | largest slice; keep under budget by splitting per prompt if it grows |
| C | Version linking metadata + `promptSource` attribution + tests | small |

A1 is independently valuable: it settles credential validity in production and turns `mask.ts` into
load-bearing code with a test that proves it.

## Risks

| Risk | Likelihood | Mitigation |
|------|-----------|-----------|
| Production Langfuse credentials are invalid (never exercised) | Med | Slice A1 IS the test: first real trace, or one secret-free auth-failure log line, answers it. A1 must be safe to deploy against invalid credentials |
| A Langfuse outage or auth failure breaks plan generation | Low | Handler is `null`-able; construction, emit and flush errors are caught; fallback template always available; no throw on the request path |
| Trace payload leaks limitation (health) text | Low | Input masked before `.invoke`; masking-payload test fails on any unmasked term in input or output |
| Pre-existing first-mention limitation gap now has a real audience | Med | ACCEPTED for this change: the extractor must see the term once to populate `limitations` (`extraction-prompt.ts` docstrings). Tightening it would break extraction. Propose a follow-up issue; note Langfuse project access is the compensating control |
| A remote template silently degrades prompt quality (e.g. drops the #352 closed vocabulary) | Med | Decision 7 validation fails closed; snapshot test pins local-vs-remote equivalence |
| Prompt-version linking key wrong for the installed SDK version | Med | Verify against installed `langfuse-langchain@^3.38.20` types in design; behaviour is pinned, key is not |
| apps/api 85% functions coverage gate blocks the chain (current ~86.84%, thin headroom) | Med | Tests ship in the same commit as each new module (decision 9) |
| Wiring only one of two prompt paths | Low | Resolved by decision 2 — the second path is deleted |

## Rollback Plan

- A1/A2: remove the `callbacks` key at the attachment sites, or simply unset the Langfuse credentials —
  the factory returns `null` and behaviour reverts to today's untraced path with no code change. The
  `OpenRouterPlanGenerator` deletion is independent and does not need reverting (nothing constructs it).
- B: revert the provider wiring; the local template constants remain and the builders keep producing
  today's output. Operationally, deleting or unlabelling the Langfuse prompt forces the fallback path
  with no deploy.
- C: metadata-only; revert in isolation.

## Success Criteria

- [ ] With valid credentials, a plan generation and a chat turn each appear as a trace in Langfuse.
- [ ] With absent or invalid credentials, plan generation and chat succeed unchanged, and exactly one
      secret-free failure log line is emitted (no secret ever logged).
- [ ] Promoting a new `production` prompt version in Langfuse changes the next generation's prompt with no
      deploy and no env change.
- [ ] A remote template that omits or relocates the #352 closed-vocabulary section, or references an
      unsupplied variable, is rejected and the local template is served.
- [ ] A test fails if unmasked limitation text can reach a trace payload.
- [ ] A fallback-served prompt is traced with `promptSource: "fallback"` and no version link.
- [ ] Prompt unit tests pass offline with no network and no credentials; `test:coverage` stays green at
      the apps/api 85% functions threshold (`apps/api/vitest.config.ts:31`).
- [ ] `OpenRouterPlanGenerator` no longer exists; no untraced duplicate prompt path remains.

## Proposal question round — ANSWERED (product owner, 2026-08-06)

These answers are binding on the spec, design and tasks phases.

1. **Prompt-edit blast radius → CONFIRMED as intended.** Promotion in Langfuse is the only gate. A bad
   edit reaching every user on the next generation is accepted product behaviour. The decision-7
   boundary validation is the guardrail; no promotion-time smoke check is designed.
2. **Staleness tolerance → minimum TTL, configurable by env var, default 60 seconds.** The product owner
   intends to run prompt experiments, so a promoted version must reach production fast. This overrides the
   5-minute `ResolveBillingPricing` default: the TTL is read from an env var (default 60s) and passed as
   the injectable `cacheTtlMs`. **Consequence — the new env var MUST be added to `docker-compose.yml`
   `environment:`.** Compose forwards only what is listed there, and a missing forward is invisible under
   local `pnpm dev`; this exact omission previously killed billing in production (PR #254). An
   unparseable or non-positive value falls back to the 60s default rather than throwing at startup.
3. **Fallback visibility → structured log line only.** No new admin/ops UI, no `/admin/logs` work in this
   change. The log line carries a reason code and never a credential or template body.
4. **First-mention limitation gap → ACCEPT and document, with a follow-up issue.** The exposure: `mask()`
   reads the terms to scrub from `input.limitations`, so a limitation the user states for the *first* time
   in `message` is not yet known and travels unmasked in that turn's prompt — by design, because the
   extractor must see it once to populate `limitations`. Today that is inert (no trace channel is open);
   once scope A attaches the handler, that single turn is persisted as a trace in a third-party
   observability backend. Accepted for this change because tightening it would break extraction;
   compensating controls are controlled access to the Langfuse project and the bounded blast radius (one
   turn, first mention only). **File a follow-up issue.** If the product owner later elects to tighten it,
   the options recorded here are: exclude the first-mention turn from the trace payload, or trace that
   turn with a redacted input while the model still receives the raw text.
5. **Slice order → plan generation first (A1), chat immediately after (A2).** Confirmed as the logical
   order.
