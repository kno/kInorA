# Verify Report — 17c-profile-body-metrics

**Verified**: 2026-08-08, pre-merge, on branch `feat/mobile-profile-screen` (PRs 1–4 merged to
`main` at `9d793e4`; PR 5 open as **#388, not yet merged**). This working tree is the complete
5-PR chain.

**Verdict: PASS WITH WARNINGS.** No CRITICAL implementation defect found. One CRITICAL
process/tracking issue was discovered (issue #374, below) that is not fixed by editing #388's
code but should be corrected before this change is considered closed.

## Gates run (fresh, this session)

| Gate | Command | Result |
|---|---|---|
| Type-check | `pnpm type-check` | **PASS** — 7/7 workspaces clean |
| Tests + coverage | `pnpm -r --if-present test:coverage` | **PASS**, exit 0. apps/api: 181 files, 2154 passed + 135 skipped, functions **88.83%** (≥85 required). apps/web: 158 files, 1716 passed, functions **94.31%** (≥90 required). domain 320, contracts 118, i18n/exercise-catalog green. No threshold failures. |
| Build | `pnpm build` | **PASS** — all 7 workspaces + Next build (28 routes incl. `/profile`) |
| Mobile tests | `cd apps/mobile && pnpm test` | **PASS** — 57 files, 499 tests |

Every gate the team-lead requested is green, hermetic, and freshly re-run — not reused from
apply-progress's report.

## Task completion

All 7 phases (PR1–PR5) in `tasks.md` are checked, 74/74 core tasks. The two remaining unchecked
boxes are in "Final Verification" and are explicitly, correctly left unchecked as genuinely manual
items requiring a live LLM call or GitHub access — not silently skipped core work. Both are
addressed below rather than re-litigated as gaps.

## Requirement-by-requirement compliance

Legend: **E** = executed-test, **C** = code-inspection-only, **N** = not-satisfied.

### `profile-body-metrics` (new capability)

| Requirement | Evidence | Class |
|---|---|---|
| Body Descriptor and Height Storage | `user-profile.test.ts` (route), `user-profile.test.ts` (repo unit) round-trip null/`prefer_not_to_say`/set values | **E** |
| Body Descriptor and Height CRUD | Same route suite: 422 on invalid enum, 422 on non-positive/out-of-range height, null-clears, isolation | **E** |
| Bodyweight Entry Recording | `user-weight-entry.test.ts` (route) + `user-weight-entry.integration.test.ts` (repo, real Postgres) — see CI-list check below | **E** |
| Bodyweight Entry Listing | Same suites — newest-first, isolation | **E** |
| SI Units Only, No Unit Field | Covered structurally (no unit field exists in either DTO) + asserted in route tests | **E** |
| Absent Body Values Degrade The Generation Prompt Byte-For-Byte | `prompt.test.ts` extended byte-identity snapshot (`buildPlanPrompt` with `bodyProfile` absent/partial/`prefer_not_to_say`-excluded) | **E** |
| Body Metric Values Never Reach Langfuse Trace Input | `trace-redaction.test.ts` (unit) + `adapter-factory.test.ts`'s masking-payload harness asserting **both halves** (trace strips it, `.invoke()` still receives it) | **E** |
| Body Metric Values Never Enter A Structured Output Schema | Grep-confirmed: no `sexOrGender`/`heightCm`/`weightKg`/bodyweight field on `WorkoutExerciseSchema`/`WorkoutSessionSchema`/`WorkoutProgramSchema` (`packages/contracts/src/workout-program.schema.ts`) | **C** (structural absence — no test can prove a negative schema shape better than direct inspection, but nothing contradicts it) |
| Body Metric Values Never Passed As Observability Metadata | `observability-metadata-guard.test.ts` (source-scan, executes in `apps/api` suite) + `PlanTraceMetadata` excess-property compile check (`trace-metadata.ts`, `expectTypeOf` test) | **E** for the guard test; **C** for the "discipline, not guarantee" framing the design itself states — a determined rename still slips past the lint, honestly documented as such |
| Bodyweight Resolution For Volume | `bodyweight-resolution.test.ts` (pure domain, full behavior table incl. settled-history pin) + `workout-session.integration.test.ts` (batched query, no N+1) + `session-aggregation.test.ts` | **E** |
| Volume Shift Is Announced At First Weight Entry | Web: RTL component test (`role="status"`, no focus steal, no repeat). Mobile: `ProfileScreen.test.tsx` covers `wasFirstEntry` once/no-repeat | **E** |
| Personal Records Remain Unaffected By Bodyweight Volume | `personal-records.test.ts` (colocated next to `personal-records.ts`, not in a `__tests__/` subdir as tasks.md described — a path deviation, not a functional gap) — byte-identical `prCount`/`personalRecords` fixture pin with/without `resolvedBodyweightKg` | **E** |
| Mobile Profile Parity | `ProfileScreen.test.tsx` (5 tests) + `user-profile-client.test.ts` (7) + `weight-entry-client.test.ts` (4) — round-trip and rejection-surfacing cases | **E** |

### `10a-v1-user-memory-structured` (MODIFIED)

| Requirement | Evidence | Class |
|---|---|---|
| Profile Storage | Migration `0027` + schema.ts columns; covered indirectly by every route/repo test that round-trips the fields | **E** |
| Profile CRUD | `user-profile.test.ts` route suite — all 10 scenarios (read, update, body-metric update, 4× reject, isolation, loading state); loading-state scenario covered by `ProfileForm.test.tsx` | **E** |

### `08-v1-ai-plan-generation` (ADDED)

| Requirement | Evidence | Class |
|---|---|---|
| Generation Prompt Carries Body Metrics When Present | `prompt.test.ts` (rendering) + `adapter-factory.test.ts` (end-to-end masking proof covers both the wizard path and, via the shared handler, the chat extraction path) | **E** for the rendering/redaction mechanism. **See "Operational gap" below** — this requirement's *practical* fulfillment for a live wizard-triggered generation is currently **not satisfied in production**, because the resolved remote prompt template renders no `{{bodyProfileSection}}` line yet. Reclassifying: **C** (code path is correct and tested against the local `PLAN_PROMPT_TEMPLATE`; the requirement's real-world effect depends on an external, unversioned artifact this PR does not control) |

### `09c-v1-progress-dashboard-stats` (MODIFIED)

| Requirement | Evidence | Class |
|---|---|---|
| Statistics Surface (bodyweight-inclusive volume) | `session-aggregation.test.ts`, `workout-session.integration.test.ts`, `tracker-model.test.ts`, `personal-records.test.ts` non-regression pin — all scenarios (zero-entry zero-volume, non-zero after entry, KPI delta null, sparse degrade, PR exclusion) covered | **E** |

## The privacy boundary — confirmed all three mechanisms exist, are wired, and are tested

1. **SDK `mask` hook** — `apps/api/src/ai/langfuse-handler.ts:69-79` passes `mask: redactTracedPayload`
   to `CallbackHandler` construction. Verified against the installed `langfuse-core@3.38.20` source
   (`maskEventBodyInPlace`): applied to `input`/`output` only, in-process at enqueue, fails closed on
   throw (whole payload replaced). Test: `trace-redaction.test.ts` (unit, direct).
2. **Span-redaction engine** — `apps/api/src/ai/trace-redaction.ts`: `TRACE_REDACTION_RULES` (one
   entry, `<body_profile>`), `redactSpans` (fail-closed on unterminated marker — redacts to
   end-of-string, tested explicitly), `redactTracedPayload` (walks string/array/object). Test:
   `trace-redaction.test.ts`.
3. **Fail-closed backstop at the invoke seam** — `apps/api/src/ai/adapter-factory.ts:116-131`: after
   rendering, if `isRedactionVerified(maskedPrompt, innerText)` is false, re-renders without
   `bodyProfile` and logs `body_profile_redaction_unverified` with no values. Test:
   `adapter-factory-backstop.test.ts` / the injected-renderer test in `adapter-factory.test.ts`.

All three are wired in the single production path (`buildLangfuseCallbackHandler` →
`invokeChain`/`extraction-adapter.ts`'s shared handler), confirmed by reading the call sites, not
inferred from the tests alone. **E** for all three.

## Byte-for-byte degradation

`prompt.test.ts`'s extended snapshot proves `buildPlanPrompt(spec)` with `bodyProfile` absent (or
present-but-empty) equals the pre-change rendering exactly, and that `requiredMarkers`/
`orderedMarkers` in `PLAN_PROMPT_DEFINITION` were **not** extended with `bodyProfileSection` (confirmed
by direct read of `apps/api/src/ai/prompt.ts:118-135`) — this is deliberate, per design.md, so a
remote template predating this change never fails validation over a purely additive variable. **E**,
via an executing test, not prose.

## Body data never in an output schema

Grep-confirmed zero matches for `sexOrGender`/`heightCm`/`weightKg`/`bodyweight` (case-insensitive) in
`packages/contracts/src/workout-program.schema.ts`. `WorkoutSessionRecord.resolvedBodyweightKg` (a
different, internal record type feeding volume math, never `.withStructuredOutput`) is correctly kept
separate. **C** — there is no test that asserts a schema's negative shape better than direct
inspection here; nothing found contradicts the requirement.

## Body data never in an observability event

`ObservabilityMetadata` is a flat scalar bag (`Record<string, string | number | boolean | null |
undefined>`) that structurally blocks nested objects but compiles a bare `weightKg: 68` scalar
without complaint — the design states this honestly as a discipline requirement, not a type
guarantee. Two mechanisms close it:

1. **Structural (real guarantee)**: `PlanTraceMetadata` (`apps/api/src/ai/trace-metadata.ts`) is a
   closed interface annotated at both trace-metadata call sites (`adapter-factory.ts`,
   `extraction-adapter.ts`); an excess-property check makes adding `weightKg` there a compile error.
   Covered by an `expectTypeOf` test. **E**.
2. **Lint, honestly graded as a lint**: `observability-metadata-guard.test.ts` source-scans
   `apps/api/src/**/*.ts` for any `metadata:` literal key matching
   `/^(weightKg|heightCm|selfDescribedSex|bodyweight)/i` outside `trace-redaction.ts` and its own
   fixture. This executes in the `apps/api` suite (confirmed in the 181-file run above). It catches
   the plausible accidental-add mistake; it does not catch a determined rename, exactly as design.md
   states. **E** for what it actually proves; the limit is real and correctly disclosed, not a defect.

## Personal records unchanged

`isEligible` (`personal-records.ts:24-26`) still gates on `weightKg > 0`, reads the set's logged load
directly, and has no bodyweight-shaped input member — confirmed by direct read.
`packages/domain/src/progress/personal-records.test.ts` (**not** in a `__tests__/` subdirectory —
this file is colocated with its module, matching this file's pre-existing convention, a cosmetic
deviation from tasks.md's stated path, not a defect) pins `prCount`/`personalRecords` byte-identical
across a fixture with and without a resolved bodyweight attached. `09c` spec's "Bodyweight and
no-weight sets are excluded from 1RM PRs" scenario stands, re-confirmed by this same pin. **E**.

## All four volume surfaces / three computation sites → one resolved number

Confirmed by direct read: `WorkoutSessionRecord.resolvedBodyweightKg` is populated once, at the
repository mapping boundary (`workout-session.ts`, 7 occurrences of `resolvedBodyweightKg` across the
muscle-group bucket, weekly rollup, and `recentSessions[].volumeKg`), and consumed identically by
`computeSessionVolume` (`session-aggregation.ts`), the muscle-group reduce, and `exerciseVolume`
(`tracker-model.ts:126-129`, threaded via `deriveTrackerModel:195,199`) — the same
`(weightKg ?? 0) > 0 ? weightKg : (resolvedBodyweightKg ?? 0)` expression in every site, not three
independent formulas. `computeVolumeTrend` (`session-aggregation.ts:93`) consumes the same
already-resolved sessions, so it inherits the fix without its own edit. **E**, backed by
`workout-session.integration.test.ts`, `session-aggregation.test.ts`, `tracker-model.test.ts`.

## The weight resolution rule

`resolveBodyweightForSession` (`packages/domain/src/progress/bodyweight-resolution.ts`) — pure
function, `bodyweight-resolution.test.ts` proves the full table from design.md: zero entries →
`undefined`; nearest-at-or-before; earliest-as-backstop when the session predates every reading;
inclusive at-instant match; stable ordering on ties; and — the load-bearing case — a later weigh-in
does **not** rewrite an already-resolved older session's bodyweight. **E**.

## One self-described field, not two

Confirmed: no `gender` field exists anywhere in `packages/contracts/src/index.ts` or the schema — the
decision-10 supersession (single merged `sexOrGender`/`selfDescribedSex` field) was followed, not the
proposal's original two-field split. `prefer_not_to_say` is a distinct enum member
(`selfDescribedSexEnum`), never a reuse of `null`; both degrade identically per
`attachBodyProfile`'s explicit `!== "prefer_not_to_say"` check before assignment (belt-and-braces
against the type-level `Exclude`). Covered by `user-profile.test.ts` and `prompt.test.ts`. **E**.

### WARNING — enum value drift between spec and implementation

Both `profile-body-metrics/spec.md` (line 22) and the `10a` delta spec (line 8) enumerate
`sexOrGender`'s values as **exactly** `male, female, other, prefer_not_to_say` — four members. The
implementation (`schema.ts:82`, `contracts/index.ts:251`, `user-profile.ts:27`) ships **five**:
`female, male, non_binary, other, prefer_not_to_say`. `design.md` independently states the five-value
set from its first draft of "The self-described field" onward, so this is not an apply-phase
deviation — the spec simply undercounts what design and code agreed on. No test contradicts the
five-value set (the route tests validate against `VALID_SELF_DESCRIBED_SEX`, which correctly includes
`non_binary`), and no scenario is broken by the extra member — every spec-listed value still behaves
as specified. This is a documentation gap in the spec artifact, not a functional defect: the spec
should be corrected to list all five values, or the design's rationale for the fifth member should be
retrofitted into the spec's own text. **WARNING**, not CRITICAL, because nothing user-facing or
privacy-relevant is broken by it.

## The mobile screen is reachable

Commit `5b08c2a` ("register the profile screen and its entry point") adds a `Stack.Screen` for
`ProfileScreen` to `App.tsx` and a Home-screen navigation affordance (`HomeScreen.tsx`, reusing the
`appNav.profile` i18n key), each with new tests (`App.test.tsx`, `HomeScreen.test.tsx`) — both
confirmed present and passing in the 499-test mobile run. Fixes the gap the apply-progress record
(#2688) explicitly flagged as "currently unreachable from the app's nav stack." **E**.

## A known operational gap — the Langfuse-hosted prompt

Confirmed by direct read of `apps/api/src/ai/prompt.ts:118-135`: `bodyProfileSection` is in
`PLAN_PROMPT_DEFINITION.variables` but **not** in `requiredMarkers`/`orderedMarkers`. This is the
correct, deliberate choice for byte-identical degradation and for not forcing every remote-template
call onto the fallback path. Its accepted consequence is exactly what the team-lead's brief states:
the Langfuse-hosted `kinora-plan-generation` prompt has not been updated with
`{{bodyProfileSection}}`, so **today, in production, a remote-resolved template renders without body
data even when the user has fully populated their profile** — the code path is correct and tested
against the local template, but its real-world effect on a live wizard-triggered generation is
inert until the maintainer edits the hosted prompt.

**Consequence for requirements**: `08-v1-ai-plan-generation`'s "Generation Prompt Carries Body
Metrics When Present" is code-inspection-only (**C**) for the live system, not executed-test-verified
for the live system, because no test exercises the actual remote-resolved template — by design, since
that template lives outside this repository and this PR. The local-fallback path and the
`PLAN_PROMPT_TEMPLATE`-driven tests are fully **E**. This is not a defect in #388; it is a
maintainer follow-up outside this PR's remit, and whether to add `bodyProfileSection` to
`requiredMarkers` is explicitly the maintainer's call, not decided here.

## The CI false-green trap (#382) — checked against the live file

`.github/workflows/ci-cd.yml`'s hardcoded real-Postgres integration list (currently 10 files, lines
117-127) includes **both** of this change's new integration suites:
`src/db/repositories/__tests__/user-weight-entry.integration.test.ts` (PR 2) and
`src/db/repositories/__tests__/workout-session.integration.test.ts` (PR 4) — re-read directly from
the file this session, not assumed from apply-progress's record. Neither PR's proof is a false green
under #382. **E** for presence on the list; actual CI execution on this branch could not be directly
observed from this local verification (no CI run inspected), but the mechanism running the other 8
already-executing files is identical and file-list-driven, so there is no reason specific to these two
entries that would prevent execution once #388's CI runs — this matches the same reasoning
apply-progress already recorded and is not re-litigated as a new risk.

## A found issue outside the code — issue #374 was closed today, but the underlying defect is unfixed

While confirming the composition table (design.md's stated "17c does not fix #374"), I checked the
live issue: **`kno/kInorA#374` is CLOSED, `stateReason: COMPLETED`, closed 2026-08-08T08:26:20Z**,
attributed to PR #386 (17c PR 3) via `closedByPullRequestsReferences`. No closing keyword
(`Closes #374`/`Fixes #374`) exists in PR #386's body or in any commit message on `main` — PR #386's
own description states explicitly, in its own words: *"This PR does not fix #374, and a green build
here must not be read as closing it."* Confirmed against the actual code: `TRACE_REDACTION_RULES`
(`trace-redaction.ts:47-49`) still registers exactly **one** rule, `<body_profile>` — no
`<user_message>` rule was added, so first-mention limitation text still reaches the Langfuse trace
exactly as before, unchanged by this change, exactly as design.md predicted it would remain.

**This is a tracking-integrity defect, not a code defect**: the issue was closed (manually, since no
automated keyword did it) while the defect it tracks remains present and verified unfixed. Left as-is,
nobody will know to revisit #374, because the tracker now says it is done.

## Fix before merging #388

1. **Reopen `kno/kInorA#374`.** It was incorrectly closed as completed; the defect it tracks
   (first-mention limitation text reaching the Langfuse trace) is confirmed still present. This is
   independent of #388's own diff — it can be corrected with a `gh issue reopen` call and a comment
   explaining why, and does not require touching any code in this PR.
2. **Correct the `sexOrGender` enum value list in the spec artifacts.** `profile-body-metrics/spec.md`
   and the `10a` delta spec both state four values; the shipped implementation (matching design.md)
   has five, including `non_binary`. Not a code fix — a one-line edit to two spec files so the spec
   stops undercounting its own accepted design. Low priority; does not block behavior.

No other CRITICAL or blocking issue was found. Everything else in this report is either **E**
(executed and passing) or an explicitly-scoped, already-disclosed limitation (the observability
lint's known ceiling, the remote-prompt operational gap) that the design itself states honestly and
that verification confirms is accurately described, not overstated.

## Final Verification manual bullets — assessed, not re-litigated

- **Byte-identical live-generation sanity check**: not performed here either (no live LLM call from
  this context). The durable guarantee is `prompt.test.ts`'s automated snapshot, confirmed passing.
  Recommend a human runs one real generation for a body-fields-absent user before/shortly after
  #388 merges, as tasks.md already flags.
- **#374 re-check**: performed in this phase (see above) — and found a discrepancy the task's
  original "unresolved and unchanged" assumption did not anticipate: the issue is administratively
  closed even though the code-level facts (unchanged) match the original assumption exactly.
