# Langfuse Prompt Management Specification

## Purpose

Move the three compiled-in prompt builders (`buildPlanPrompt`, `buildReplyPrompt`,
`buildExtractionPrompt`) behind a runtime prompt source hosted in Langfuse, so a prompt edit
takes effect on the next generation with no code change, PR, CI run, build or deploy. Every plan
generation and chat call is traced and attributable to the exact prompt version that produced it.
An unreachable, unauthenticated or malformed prompt service degrades to the compiled-in prompt
with a visible signal, never to a failed plan generation or chat turn.

Delivery note (non-normative): capabilities are introduced in slice order plan-generation tracing
(A1), chat tracing (A2), remote prompt source (B1), remote-source hardening (B2), then
version-linking attribution (C). This ordering constrains delivery sequencing only; every
requirement below is independently testable regardless of slice.

## Requirements

### Requirement: Safe-By-Construction Tracing Handler

The system MUST construct a Langfuse `CallbackHandler` only when both public and secret Langfuse
credentials are present, and MUST return `null` when credentials are absent or when construction
fails. Handler construction, trace emission and flush MUST NEVER reject or delay the request path:
plan generation and chat MUST succeed with byte-identical prompt output whether or not a handler
was attached. Any construction, emission or flush failure MUST emit exactly one structured,
secret-free log line through the existing observability logger, carrying a reason code and never a
credential or template body.

#### Scenario: Absent credentials produce no handler and no error

- GIVEN `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` are both unset
- WHEN a plan generation or chat call runs
- THEN no `CallbackHandler` is constructed
- AND the call succeeds with the same prompt content as if tracing did not exist
- AND no log line is emitted for this case (no handler was ever attempted)

#### Scenario: Invalid credentials degrade to untraced success with one log line

- GIVEN `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` are set to invalid or unreachable values
- WHEN a plan generation or chat call runs and handler construction, trace emission, or flush fails
- THEN the call succeeds with a byte-identical prompt
- AND exactly one structured, secret-free log line is emitted carrying a reason code
- AND the log line contains no credential and no template or prompt body

#### Scenario: Trace emission or flush failure never rejects the request

- GIVEN a constructed handler whose trace emission or flush call fails at runtime (network drop,
  timeout, 5xx)
- WHEN a plan generation or chat call is in flight
- THEN the plan generation or chat response is returned to the caller unaffected
- AND exactly one secret-free failure log line is emitted

### Requirement: Langfuse Base URL Resolution

The system MUST resolve the Langfuse base URL by explicitly passing `baseUrl` to the handler
factory with precedence `LANGFUSE_BASEURL ?? LANGFUSE_HOST`, and MUST NOT rely on the SDK's
implicit environment pickup of `LANGFUSE_BASEURL` alone.

#### Scenario: Only LANGFUSE_HOST is set (current production shape)

- GIVEN `LANGFUSE_HOST` is set and `LANGFUSE_BASEURL` is unset
- WHEN the handler factory resolves the base URL
- THEN the resolved `baseUrl` equals the value of `LANGFUSE_HOST`

#### Scenario: Both are set

- GIVEN both `LANGFUSE_BASEURL` and `LANGFUSE_HOST` are set to different values
- WHEN the handler factory resolves the base URL
- THEN the resolved `baseUrl` equals the value of `LANGFUSE_BASEURL`

#### Scenario: Neither is set

- GIVEN neither `LANGFUSE_BASEURL` nor `LANGFUSE_HOST` is set
- WHEN the handler factory resolves the base URL
- THEN no explicit `baseUrl` is passed and handler construction proceeds under the SDK default (or
  fails safely per the Safe-By-Construction requirement if credentials are also absent)

### Requirement: Fixed Production Label Is the Only Promotion Gate

The system MUST always request Langfuse prompts under the fixed label `production`. No
environment variable, deploy, or promotion-time smoke check MUST gate a promoted prompt version
from taking effect; promotion in the Langfuse UI is the sole and sufficient gate.

#### Scenario: Promoting a new production prompt version changes the next generation

- GIVEN a new prompt version is promoted to the `production` label in Langfuse
- WHEN the next plan generation or chat call runs after the cache TTL elapses
- THEN the new template content is used
- AND no deploy, env change, or code change was required

#### Scenario: No smoke check blocks a bad promoted edit

- GIVEN a prompt version promoted to `production` in Langfuse
- WHEN that version is fetched and passes boundary validation
- THEN it is served to every subsequent request with no additional runtime quality gate

### Requirement: Prompt Cache TTL Is Environment-Configurable With a 60-Second Default

The system MUST read the prompt cache TTL from an environment variable, defaulting to 60000
milliseconds (60 seconds) when the variable is unset. An unparseable or non-positive value MUST
fall back to the 60-second default rather than throwing at startup.

#### Scenario: TTL env var unset uses the 60-second default

- GIVEN the TTL environment variable is unset
- WHEN the prompt provider is constructed
- THEN the effective cache TTL is 60000 ms

#### Scenario: TTL env var set to a valid positive value is honored

- GIVEN the TTL environment variable is set to a valid positive integer expressing milliseconds
- WHEN the prompt provider is constructed
- THEN the effective cache TTL equals that value

#### Scenario: Unparseable TTL value falls back to the default without throwing

- GIVEN the TTL environment variable is set to a non-numeric or otherwise unparseable string
- WHEN the prompt provider is constructed
- THEN startup does not throw
- AND the effective cache TTL is 60000 ms

#### Scenario: Non-positive TTL value falls back to the default without throwing

- GIVEN the TTL environment variable is set to zero or a negative number
- WHEN the prompt provider is constructed
- THEN startup does not throw
- AND the effective cache TTL is 60000 ms

### Requirement: Prompt Cache TTL Env Var Is Forwarded in Compose

The new prompt cache TTL environment variable MUST be listed in `docker-compose.yml`'s
`environment:` block for the API service, in addition to being read in code with a safe default.
Docker Compose forwards only variables explicitly listed there; a variable read in code but absent
from `environment:` is silently unset in the deployed container while still appearing to work
under local `pnpm dev` (which reads the process environment directly).

#### Scenario: Compose forwards the new TTL variable

- GIVEN `docker-compose.yml`'s API service `environment:` block
- WHEN the file is inspected
- THEN it lists the new prompt cache TTL environment variable name
- AND setting that variable in the deployment environment changes the effective TTL in the running
  container without a code change

### Requirement: Remote Prompt Fetch With Mandatory Local Fallback

The system MUST attempt to fetch each of the three in-scope prompt templates (plan, reply,
extraction) from Langfuse under the `production` label, and MUST fall back to the compiled-in
local template on every failure class: network failure, authentication failure, missing prompt (no
prompt registered under that name/label), and malformed template (fails boundary validation). No
failure class MUST ever surface as a request-path error.

#### Scenario: Successful remote fetch is used

- GIVEN Langfuse returns a valid template for a requested prompt name under `production`
- WHEN the prompt provider resolves that prompt
- THEN the returned template is used to render the prompt
- AND the request succeeds

#### Scenario: Network failure falls back to the local template

- GIVEN a network-level failure (timeout, connection refused, DNS failure) when fetching a prompt
- WHEN the prompt provider resolves that prompt
- THEN the compiled-in local template is used
- AND the request succeeds

#### Scenario: Authentication failure falls back to the local template

- GIVEN Langfuse rejects the fetch with an authentication or authorization error
- WHEN the prompt provider resolves that prompt
- THEN the compiled-in local template is used
- AND the request succeeds

#### Scenario: Missing prompt falls back to the local template

- GIVEN no prompt is registered under the requested name and `production` label
- WHEN the prompt provider resolves that prompt
- THEN the compiled-in local template is used
- AND the request succeeds

#### Scenario: Malformed template falls back to the local template

- GIVEN a fetched template fails boundary validation (see Untrusted Remote Template Validation)
- WHEN the prompt provider resolves that prompt
- THEN the compiled-in local template is used
- AND the request succeeds

### Requirement: TTL Cache With Concurrent-Burst Coalescing

The prompt provider MUST cache a resolved prompt (remote or fallback) for the configured TTL, and
MUST coalesce concurrent requests that arrive while the cache is cold or expired into a single
upstream Langfuse call, mirroring `ResolveBillingPricing`'s `pending` promise pattern.

#### Scenario: A cold-cache burst of concurrent requests makes one upstream call

- GIVEN the prompt cache is empty or expired for a given prompt name
- WHEN multiple concurrent requests ask for that prompt at the same time
- THEN exactly one upstream Langfuse fetch is made
- AND every concurrent caller receives the same resolved template

#### Scenario: A warm cache serves without an upstream call

- GIVEN a prompt was resolved less than the TTL ago
- WHEN a subsequent request asks for the same prompt within the TTL window
- THEN no upstream Langfuse call is made
- AND the cached template is returned

### Requirement: Fallback Result Is Cached Too

The provider MUST cache a fallback resolution (produced after any failure class) for the same TTL
as a successful remote resolution, so that a sustained Langfuse outage does not cause an upstream
call on every request.

#### Scenario: Repeated requests during an ongoing outage make at most one upstream attempt per TTL window

- GIVEN Langfuse is unreachable for longer than one TTL window
- WHEN multiple sequential requests for the same prompt arrive within a single TTL window after the
  first failure
- THEN only the first request in that window attempts the upstream call
- AND subsequent requests in the same window are served the cached fallback with no upstream call

### Requirement: Untrusted Remote Template Validation Fails Closed

A template fetched from Langfuse MUST be validated as untrusted input before use, and MUST be
rejected in favor of the compiled-in local template when any of the following holds: the payload is
not a string, is empty, or exceeds the size cap; the template references any `{{variable}}` not in
the variable set supplied for that prompt; the template is missing a required placeholder,
specifically the `buildPlanPrompt` #352 `ALLOWED EXERCISES — CLOSED VOCABULARY` section
placeholder; the template relocates the `ALLOWED EXERCISES — CLOSED VOCABULARY` section so that the
task-block reference which points back to it (`prompt.ts:80-89`, task rule 2) no longer resolves
correctly; or the rendered output still contains an unresolved `{{` sequence. Every rejection MUST
log a reason code and MUST NEVER log the template body or a credential.

#### Scenario: Non-string, empty, or over-size payload is rejected

- GIVEN a fetched template payload that is not a string, is an empty string, or exceeds the
  configured size cap
- WHEN the template is validated
- THEN it is rejected
- AND the compiled-in local template is served
- AND a reason-code log line is emitted with no template body

#### Scenario: Unknown variable reference is rejected

- GIVEN a fetched template that references a `{{variable}}` not present in the variable set
  supplied for that prompt
- WHEN the template is validated
- THEN it is rejected
- AND the compiled-in local template is served

#### Scenario: Missing required closed-vocabulary placeholder is rejected

- GIVEN a fetched `buildPlanPrompt` template that omits the `ALLOWED EXERCISES — CLOSED
  VOCABULARY` section placeholder
- WHEN the template is validated
- THEN it is rejected
- AND the compiled-in local template is served

#### Scenario: Relocated closed-vocabulary section is rejected, not repaired

- GIVEN a fetched `buildPlanPrompt` template that includes the closed-vocabulary section but moves
  it so the task-block reference to it (task rule 2) no longer resolves against its expected
  placement
- WHEN the template is validated
- THEN it is rejected as a whole
- AND the system does NOT attempt to repair or relocate the section
- AND the compiled-in local template is served

#### Scenario: Unresolved template markers in the rendered output are rejected

- GIVEN a fetched template that renders to a string still containing an unresolved `{{` sequence
- WHEN the rendered result is validated
- THEN it is rejected
- AND the compiled-in local template is served

### Requirement: Local and Remote Templates Share One Renderer With Byte-Identical Output

Each prompt builder MUST be split into a variables producer (context sections, the #352 allowed-
exercise block, the sanitized memory section) and a pure renderer that runs identically over the
local compiled-in template and any validated remote template. When the remote template's text is
equal to the local template's text, the rendered output MUST be byte-identical to today's output.

#### Scenario: Remote template equal to local template renders identically

- GIVEN a validated remote template whose text is exactly equal to the compiled-in local template
- WHEN both are rendered with the same variables
- THEN the two rendered outputs are byte-identical

#### Scenario: Masking runs on the rendered string regardless of template source

- GIVEN a rendered prompt produced from either the local or a validated remote template
- WHEN the prompt is masked before being sent to the model or attached to a trace
- THEN masking is applied to the rendered string at the same call site used today, so no remote
  template can bypass masking

### Requirement: Masking Invariant on Trace Payloads

No unmasked limitation (health) term MUST reach any Langfuse trace payload, in either the input or
the output of a traced call.

#### Scenario: Masked input reaches the trace, not raw limitation text

- GIVEN a plan generation or chat call whose prompt contains known limitation terms
- WHEN the callback handler observes the input payload
- THEN every known limitation term appears only as its masked replacement, never in raw form

#### Scenario: Output payload carries no limitation-bearing field

- GIVEN a plan generation call whose traced output is a `WorkoutProgramSchema`-shaped program
- WHEN the callback handler observes the output payload
- THEN the output contains no limitation-bearing field and no unmasked limitation term

### Requirement: First-Mention Limitation Masking Gap Is Accepted, Not Fixed

A limitation mentioned for the first time in a chat `message` is, by design, not yet present in
`input.limitations` and therefore travels unmasked in that single turn's traced prompt, because the
extractor must see the raw term once to populate `limitations`. This change MUST NOT introduce any
requirement that masks a first-mention limitation term, and this behavior MUST NOT be treated as a
defect of the Masking Invariant requirement above. A follow-up issue tracks whether to tighten it
later.

#### Scenario: First-mention limitation term is traced unmasked in that one turn

- GIVEN a chat turn where the user states a limitation for the first time in `message`
- WHEN that turn's prompt is traced
- THEN the traced input for that turn contains the limitation term unmasked
- AND this is accepted behavior, not a failure of the masking invariant
- AND no requirement in this specification is violated by this occurrence

#### Scenario: Second and later mentions of the same limitation are masked

- GIVEN a limitation term that was extracted into `input.limitations` after its first-mention turn
- WHEN a subsequent turn's prompt containing that same limitation term is traced
- THEN the term appears masked in the traced payload

### Requirement: Trace Attribution to Prompt Source and Version

Every trace produced by a call whose prompt came from a validated remote (Langfuse) template MUST
carry `promptSource: "langfuse"` together with prompt/version linkage identifying the exact prompt
version used, resolved through the tracing SDK's native prompt-version linking on the happy path.
Every trace produced by a call that used the compiled-in local template — whether because no remote
fetch was attempted, the fetch failed, or validation rejected the remote template — MUST carry
`promptSource: "fallback"` and MUST NOT carry any version linkage.

#### Scenario: Remote-sourced prompt trace carries langfuse attribution and version linkage

- GIVEN a call whose prompt was successfully fetched from Langfuse and passed validation
- WHEN the call is traced
- THEN the trace carries `promptSource: "langfuse"`
- AND the trace carries linkage identifying the specific prompt version used

#### Scenario: Fallback-sourced prompt trace carries fallback attribution with no version link

- GIVEN a call whose prompt used the compiled-in local template for any reason (no credentials, no
  handler, fetch failure, or validation rejection)
- WHEN the call is traced
- THEN the trace carries `promptSource: "fallback"`
- AND the trace carries no prompt/version linkage

### Requirement: Native Prompt-Version Linkage Populates on the Happy Path

When a prompt was served from Langfuse and tracing is enabled, the invocation chain MUST register
the model run under the same run as the prompt-serving step, so that the tracing SDK's native
prompt-version linking precondition is satisfied and the emitted generation carries native
prompt-version linkage — not flat metadata alone. This requirement is behaviour-level: it
constrains run parentage as observed by the tracing callback, not any particular internal runnable
shape or SDK field name.

#### Scenario: Model run and prompt step share a run so native linkage resolves

- GIVEN a plan generation or chat call whose prompt was served from a validated Langfuse template
  and whose tracing handler is attached
- WHEN the call executes
- THEN the callback observes the model's run registered under the same parent run as the
  prompt-serving step
- AND the resulting generation carries the tracing SDK's native prompt-version linkage, not only
  flat `promptName`/`promptVersion` metadata

### Requirement: Graceful Degradation to Flat Attribution When Native Linkage Cannot Be Established

If the invocation chain for a given call cannot be restructured to satisfy the native linking
precondition — including a provider whose runnable shape differs, or a structured-output shape that
requests raw output alongside the parsed result — the system MUST fall back to flat-scalar
attribution (`promptSource`, `promptName`, `promptVersion`, `promptLabel`) instead of native
linkage, and the plan generation or chat call MUST still succeed unchanged. Losing native linkage
MUST NEVER fail or degrade the generation itself.

#### Scenario: Non-decomposable chain falls back to flat attribution without failing the call

- GIVEN a call whose structured-output runnable is not a decomposable sequence (a differently
  shaped provider chain, or a chain configured to return raw output alongside the parsed result)
- WHEN the call is traced
- THEN the trace carries flat `promptSource`, `promptName`, `promptVersion`, and `promptLabel`
  attribution instead of native SDK linkage
- AND the plan generation or chat call succeeds exactly as it would without tracing

### Requirement: Masking Invariant Holds Across the Restructured Invocation Chain

Reparenting the model run under the prompt-serving step MUST NOT change where the rendered prompt
string is masked: the prompt entering the chain MUST already be rendered and already masked before
any run in the chain begins, so no callback ever observes unmasked limitation text as a result of
the restructure.

#### Scenario: Restructured chain still only ever exposes a masked prompt to the callback

- GIVEN a call using the restructured, flattened invocation chain that enables native prompt-version
  linkage
- WHEN the callback handler observes the input payload at any run in that chain
- THEN the observed prompt string is already rendered and already masked
- AND no unmasked limitation term is observable at any point in the restructured chain

### Requirement: Output Equivalence Under Chain Restructuring

Reparenting the structured-output sequence's steps to enable native prompt-version linkage MUST NOT
change the parsed program produced by a plan generation call: the structured output before and
after the restructure MUST be equivalent, and `WorkoutProgramSchema` validation at the call site
MUST be unchanged.

#### Scenario: Restructured chain produces an equivalent parsed program

- GIVEN the same model response processed through the pre-restructure chain shape and the
  restructured, flattened chain shape
- WHEN each is parsed against `WorkoutProgramSchema`
- THEN the two parsed programs are equivalent
- AND `WorkoutProgramSchema` validation behaves identically at the call site in both cases

### Requirement: Native Linkage Behaviour Is Verifiable Offline

The native prompt-version linkage requirement, its graceful-degradation fallback, and the
masking-invariant scenario above MUST all be verifiable with no network access and no Langfuse
credentials, using a fake callback handler that records observed run parentage and payloads.

#### Scenario: A fake callback handler proves run parentage with no network or credentials

- GIVEN a test double for the tracing callback handler that records the parent/child run
  relationship and the observed input payload for each run
- WHEN the restructured chain is exercised with no network access and no Langfuse credentials
- THEN the recorded run parentage shows the model run under the same parent run as the
  prompt-serving step
- AND the recorded input payload contains no unmasked limitation term

### Requirement: Prompt Tests Run Offline With No Network or Credentials

Every test covering prompt builders, the renderer, the handler factory, and the prompt provider
MUST run with no network access and no Langfuse credentials present, and `test:coverage` MUST stay
green at the existing apps/api functions coverage threshold of 85% (`apps/api/vitest.config.ts:31`).

#### Scenario: Prompt builder and renderer tests run offline

- GIVEN the test suite for prompt builders and the shared renderer
- WHEN it is run with no network access and no Langfuse credentials set
- THEN all tests pass

#### Scenario: Handler factory tests construct no real client under test

- GIVEN the test suite for the handler factory
- WHEN it is run with no credentials present
- THEN the factory returns `null` and no Langfuse client is constructed

#### Scenario: Prompt provider tests use a fake gateway and injected clock

- GIVEN the test suite for the prompt provider's TTL cache, coalescing, and fallback behavior
- WHEN it is run
- THEN it exercises a fake gateway and an injected clock, with no real network call

#### Scenario: Coverage gate remains green

- GIVEN the full addition of new modules for this change
- WHEN `test:coverage` runs
- THEN the apps/api functions coverage threshold of 85% (`apps/api/vitest.config.ts:31`) is met or exceeded

### Requirement: No Untraced Duplicate Prompt Path Remains

The `OpenRouterPlanGenerator` class and its dedicated test MUST be removed, since it duplicates the
prompt/mask/invoke sequence outside the traced `invokeChain` choke point and would otherwise
silently diverge from the traced and remotely-sourced path. The `warnIfAiConfigMissing` helper MUST
remain, since it is independently used and tested.

#### Scenario: OpenRouterPlanGenerator no longer exists

- GIVEN the completed change
- WHEN the codebase is inspected
- THEN no `OpenRouterPlanGenerator` class or its dedicated test file exists
- AND `warnIfAiConfigMissing` still exists and is still imported where it was before

#### Scenario: All plan generation funnels through the traced choke point

- GIVEN any of the five plan-generation provider factories
- WHEN a plan is generated
- THEN the call passes through `invokeChain`, the single traced and remote-prompt-aware choke point,
  with no alternate prompt/mask/invoke path available
