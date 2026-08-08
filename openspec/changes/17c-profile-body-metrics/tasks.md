# Tasks: 17c — Profile Body Metrics

Implements `openspec/changes/17c-profile-body-metrics/specs/profile-body-metrics/spec.md`
(13 requirements, 33 scenarios) plus the MODIFIED deltas on `10a-v1-user-memory-structured`
(2 requirements), `08-v1-ai-plan-generation` (1 requirement) and `09c-v1-progress-dashboard-stats`
(1 requirement) — 17 requirements, 57 scenarios total — under `design.md` and the pinned decisions
of `proposal.md` (1–10 + the resolved question round; **decisions 9 and 10 carry supersession
blocks that win over the original text — one merged `sexOrGender` field, no gendered-imagery
suppression**). `design.md`'s "Corrections to the proposal" table wins over the proposal wherever
they differ — most importantly: the redaction mechanism must make the **model input and the trace
input diverge**, not mask before `invoke()` (that would remove body values from the model too).

Fixed slice order, do not resequence: **PR 1 → PR 2 → PR 3 → PR 4 → PR 5**. PR 3 depends on **both**
PR 1 and PR 2 (needs `selfDescribedSex`/`heightCm` as well as the weight series), not just PR 2 — the
design's correction to the proposal's ordering rationale. Every implementation task is preceded by
its RED test task (Strict TDD). Tests ship in the same commit as the module they cover.

**#374 composition is CLOSED, not a task.** Apply-phase confirmed #374 is still open and unchanged
from the design's reconstruction (`mask()` reads terms from `input.limitations`, so a first-mention
limitation travels unmasked in that turn). The composition table in `design.md` stands as written.
Do not create a task to re-check it.

## Review Workload Forecast

`review_budget_lines: 800`, measured on **non-test** lines. `chain_strategy: stacked-to-main` — each
PR targets the previous PR's branch or `main` in sequence. `delivery_strategy: ask-on-risk` was
already exercised during propose/design and resolved: the product owner accepted all five PRs in
full, nothing trimmed. Not re-asked here.

Re-forecast from the design's **reduced** scope (C3 gendered-imagery gone, A1 down to one merged
field) rather than the proposal's pre-correction numbers, per the design's explicit instruction:

| PR | Content | Non-test | Test | 800-line budget risk |
|----|---------|----------|------|------------------------|
| 1 | A1 — `selfDescribedSex` + `heightCm` through seven layers, migration `0027` | ~130–190 | ~130–190 | Low |
| 2 | A2 — `user_weight_entries`, migration `0028`, route + repo, web form + list, CI list line | ~180–250 | ~170–240 | Low |
| 3 | B — trace-redaction module + handler wiring + metadata types + prompt section + fail-closed backstop | ~150–220 | ~180–280 | Low (deliberately larger than the proposal's ~120–200 — see design's "Corrections to the proposal") |
| 4 | C — resolution function, volume threading (3 sites), `resolvedBodyweightKg`, first-entry notice | ~130–200 | ~180–260 | Low |
| 5 | A3 — mobile profile screen (greenfield) | ~180–250 | ~120–180 | Low |
| | **Total** | **~770–1110** | **~780–1150** | |

Every PR sits comfortably inside the 800-line non-test budget individually; the total is modestly
below the proposal's pre-correction ~780–1180, exactly as the resolved question round predicted. Do
not trim tests to fit a number — the split is on its merits, per the design.

### Dependency diagram (for chained-PR tracking; mark the current PR with 📍)

```
PR 1 (selfDescribedSex + heightCm, migration 0027, seven layers)
 └─ PR 2 (user_weight_entries, migration 0028, route + repo, web form + list, CI list line)
     └─ PR 3 (trace-redaction + handler + metadata types + prompt section + backstop — needs PR 1 AND PR 2)
         └─ PR 4 (resolution function + volume threading (3 sites) + resolvedBodyweightKg + first-entry notice)
             └─ PR 5 (mobile profile screen, greenfield — depends on nothing in PR 3 or PR 4)
```

## Repo gotchas carried into task notes (do not re-derive)

- **The migration journal hand-check is RETIRED.** `apps/api/src/db/__tests__/migration-journal.test.ts`
  (shipped by 17b) is directory-driven — it reads `apps/api/drizzle/*.sql` and `_journal.json` from
  disk and asserts every file has a `tag` with a contiguous `idx` from 0. It covers new migrations
  with no code change. The only manual step left is picking the right `idx`: **journal max is
  currently 26, verified — the new migrations are `27` and `28`.**
- **Volume is computed at THREE sites, not two:** `computeSessionVolume`
  (`packages/domain/src/offline/session-aggregation.ts:11-24`, completed-set-gated), `exerciseVolume`
  (`apps/web/src/app/(app)/plan/[id]/tracker/tracker-model.ts:116-121`, **not** completed-gated), and
  an inline reduce for the muscle-group bucket (`apps/api/src/db/repositories/workout-session.ts:1355-1358`,
  completed-gated). The design resolves this with **one resolved number carried on the record**
  (`WorkoutSessionRecord.resolvedBodyweightKg`) — task it that way, never as three parallel formula
  edits that could drift.
- **Four volume surfaces move, not one:** the Stats volume KPI, the weekly rollup (`:1161`),
  `recentSessions[].volumeKg` (`:1063`), and history trend deltas via `computeVolumeTrend`
  (`session-aggregation.ts:91`), plus the web tracker's live readout. All four ride the same
  `resolvedBodyweightKg` threading — one task family, not four.
- **Personal records must NOT move.** `computePersonalRecords`
  (`packages/domain/src/progress/personal-records.ts:24-26`) gates on
  `completed && weightKg > 0 && actualReps > 0` and reads the set's logged load directly, never a
  volume figure and never a resolved bodyweight. `PersonalRecordSetInput` has no bodyweight member
  and this design does not add one — PR 4 ships a non-regression test pinning this, not a "trust the
  convention" comment.
- **The CI false-green trap (issue #382).** Nine `apps/api` integration suites never execute because
  the real-Postgres job runs a hardcoded file list (`.github/workflows/ci-cd.yml:113-131`, currently
  exactly eight files, all `src/db/repositories/__tests__/*.integration.test.ts`). PR 2's new
  `user-weight-entry.integration.test.ts` MUST be added to that list in the **same commit** as the
  file — writing proof into a suite that never runs is the exact defect #382 describes, and is the
  mistake that shipped four unproven guarantees in 17b. `resolveBodyweightForSession` is a pure
  domain function precisely so the load-bearing resolution rule is proved by the always-run unit
  suite instead of depending on that list.
- **i18n dist staleness.** Apps resolve `@kinora/i18n` through built `dist/`, not `src`. Editing the
  catalogs (PR 1, 2, 4) without rebuilding (`pnpm build`, or root `pnpm dev` which prebuilds) silently
  serves stale messages.
- **Mobile does NOT use the shared `next-intl` catalogs.** It has its own per-screen `react-intl`
  `messages.ts` (PR 5), following `screens/tracker/messages.ts` / `screens/plan/messages.ts` /
  `screens/clients/messages.ts`.
- **`apps/mobile/src/screens/__tests__/WorkoutTrackerScreen.test.tsx` has no global
  `beforeEach(vi.clearAllMocks())`** — not touched by this change, but any new mobile test file (PR 5)
  in that directory must not assume shared-mock isolation without its own `beforeEach`.
- **Never** add a field to `WorkoutExerciseSchema`, `WorkoutSessionSchema` or `WorkoutProgramSchema`
  — they feed `.withStructuredOutput`, and #357 is the cautionary tale. Body data enters generation
  only as rendered prompt text (PR 3).
- **The Langfuse `mask` hook covers `input`/`output` only, never `metadata`.** A body value passed as
  `ObservabilityMetadata` bypasses the entire redaction capability. PR 3 closes the two trace metadata
  literals by type (`PlanTraceMetadata`) and adds a source-scan guard test — stated honestly in the
  design as "a lint, not a type", it will not catch a determined rename.
- **`gh` auth**: pushing to `kno/kInorA` / opening or merging a PR requires
  `GH_TOKEN="$(gh auth token --user kno)" gh <cmd>` — never `gh auth switch`.
- **Coverage gates**, enforced by `.githooks/pre-push`: `pnpm -r --if-present test:coverage`, apps/api
  functions ≥85%, apps/web functions ≥90%. A threshold failure is deterministic and real — never
  `--no-verify` past it.

## Three open apply-time decisions, made explicit as tasks (not silent assumptions)

1. **PR 3 — the `mask` option's interaction with slice-C prompt-version linkage.**
   `registerLangfusePrompt` operates on run parenting, not on `input`/`output` bytes, so it should be
   orthogonal to the mask — but PR 3 must assert `promptLinked` stays `true` with the redaction
   attached, rather than assume orthogonality. Task PR3.9.
2. **PR 4 — `mapWorkoutSessionRecord`'s full call-site list.** Never enumerated during design. PR 4
   must confirm every path that produces a `WorkoutSessionRecord` for a **volume** consumer receives
   the resolved weight; a missed path degrades to today's numbers (safe, but an inconsistency between
   two screens, which is its own defect). Task PR4.9.
3. **PR 4 — the offline mobile snapshot writer.** Stores `WorkoutSessionRecord`s locally. A snapshot
   taken before PR 4 has no `resolvedBodyweightKg` and degrades correctly by absence — but apply must
   confirm no snapshot schema-version assertion rejects the added optional field. Task PR4.10.

---

## Phase PR1: Web Profile Scalars — `selfDescribedSex` + `heightCm`

Start state: `user_profiles` carries `name`, `goal`, `experienceLevel` only; the profile route/repo/
web form validate and merge those three fields; migration journal max `idx` is 26. End state: two
new nullable columns exist, additive through all seven layers (schema, migration, contracts, route,
repository, web form, i18n), `prefer_not_to_say` is stored as a distinct enum member never conflated
with null, and the migration-journal guard pins the new entry. Rollback boundary: nullable, additive
columns — reverting the UI leaves them null, exactly like an unfilled profile today; the enum type
itself is forward-only once a row references a value (like `billing_tier`'s `'gym'`).

Satisfies: Body Descriptor and Height Storage; Body Descriptor and Height CRUD; SI Units Only, No
Unit Field (partial — the `heightCm` half); `10a-v1-user-memory-structured` Profile Storage
(MODIFIED); `10a-v1-user-memory-structured` Profile CRUD (MODIFIED).

### Migration + guard

- [x] PR1.1 Preflight: grep `apps/api/drizzle/meta/_journal.json`, confirm the current highest `idx`
      is 26, so the new entry is `idx: 27` with no gap
- [x] PR1.2 RED: extend `apps/api/src/db/__tests__/migration-journal.test.ts` with a pinning assertion
      that `0027_user_profile_body_metrics.sql` exists at `idx: 27` (the general contiguous-`idx`/
      matching-`tag` assertions already cover it with no edit)
- [x] PR1.3 GREEN: create `apps/api/drizzle/0027_user_profile_body_metrics.sql` —
      `CREATE TYPE "public"."self_described_sex" AS ENUM ('female', 'male', 'non_binary', 'other',
      'prefer_not_to_say');` then `ALTER TABLE "user_profiles" ADD COLUMN "self_described_sex"
      "self_described_sex";` and `ALTER TABLE "user_profiles" ADD COLUMN "height_cm" integer;`; hand-add
      the journal entry `{ idx: 27, version: "7", when: <ms>, tag: "0027_user_profile_body_metrics",
      breakpoints: true }`; add `selfDescribedSexEnum` and the two nullable columns to `userProfiles`
      in `apps/api/src/db/schema.ts:950-969`, documenting the same "row may exist with NULL, user
      chooses later" contract `goal`/`experienceLevel` already carry; confirm PR1.2 is green

### Contracts

- [x] PR1.4 RED: extend `packages/contracts/src/contracts.test.ts:61-72`'s runtime export assertion
      to prove it is **unchanged** by this diff (the additions are type-only); add a compile-time
      check that `UserProfile` carries `selfDescribedSex: SelfDescribedSex | null` and
      `heightCm: number | null`
- [x] PR1.5 GREEN: in `packages/contracts/src/index.ts` — add
      `export type SelfDescribedSex = "female" | "male" | "non_binary" | "other" |
      "prefer_not_to_say"`; add `selfDescribedSex: SelfDescribedSex | null` and
      `heightCm: number | null` to `UserProfile`; confirm PR1.4 is green and `contracts.test.ts:61-72`
      still passes unedited

### Route: validation + CRUD

- [x] PR1.6 RED: `apps/api/src/routes/__tests__/user-profile.test.ts` (Fastify `app.inject` harness) —
      PUT with a valid `selfDescribedSex` member persists and round-trips on GET; PUT with
      `"unspecified"` returns `422 { error: "invalid_self_described_sex" }` and leaves the profile
      unchanged; PUT `heightCm: 0` and `heightCm: -5` both return `422 { error: "invalid_height_cm" }`
      and leave the profile unchanged; PUT `heightCm` outside `[50, 300]` (e.g. `1` or `400`) returns
      the same 422; PUT `selfDescribedSex: null` clears a previously set value; `undefined` for either
      field preserves the existing stored value (the three-way `goal` semantics, verbatim); GET on a
      profile that never set either field returns `null` for both; a `prefer_not_to_say` write reads
      back as `"prefer_not_to_say"`, distinguishable from `null`
- [x] PR1.7 GREEN: in `apps/api/src/routes/user-profile.ts` — declare `VALID_SELF_DESCRIBED_SEX`
      beside the existing `VALID_GOALS` (`:15-25`); extend the PUT handler's three-way merge
      (undefined preserves / null unsets / value stored, per `goal`'s existing pattern at
      `:157-184`) to `selfDescribedSex`; validate `heightCm` as an integer in `[50, 300]` when
      supplied, `422 { error: "invalid_height_cm" }` otherwise; wire both fields through the DTO
      mapping on GET; confirm PR1.6 is green

### Repository

- [x] PR1.8 RED: DEVIATION — extended the existing `apps/api/src/db/repositories/__tests__/
      user-profile.test.ts` (mocked drizzle-chain unit suite) instead of creating a new
      `.integration.test.ts` file: that suite has never run against real Postgres, and a new
      integration file would not be on the real-Postgres CI job's hardcoded list (#382) — proof
      would ship in a file that never runs. Covers create, read, and upsert round-tripping
      `selfDescribedSex` and `heightCm`, including the `null`-clears and `prefer_not_to_say`-persists
      cases
- [x] PR1.9 GREEN: `apps/api/src/db/repositories/user-profile.ts` — thread the two columns through the
      read/create/upsert paths; confirm PR1.8 is green

### Web profile form

- [x] PR1.10 RED: RTL + jsdom component test for `apps/web/src/app/(app)/profile/ProfileForm.tsx` —
      renders all five `selfDescribedSex` options plus the height input; a selection round-trips
      through `profile-form-client.ts`/`actions.ts`; `prefer_not_to_say` renders as a chosen value in
      its control, not an empty one
- [x] PR1.11 GREEN: implement in `apps/web/src/app/(app)/profile/{profile-form-client.ts,actions.ts,
      ProfileForm.tsx,options.ts}` — new options list mirroring `goal`'s options shape; confirm PR1.10
      is green

### i18n

- [x] PR1.12 GREEN: add `profile.form.selfDescribedSex.*` (five option labels + field label) and
      `profile.form.heightCm` to `packages/i18n/src/messages/{en,es}.json`, both locales, neutral
      professional register; rebuild `packages/i18n` (`pnpm build`) before manual verification

### PR 1 verification

- [x] PR1.13 Verify: `pnpm -r test` green; `pnpm -r --if-present test:coverage` green (apps/api
      functions ≥85%, apps/web functions ≥90%); `pnpm type-check` clean; `pnpm build` succeeds
      (confirms `packages/i18n` rebuild)

---

## Phase PR2: Bodyweight Series — `user_weight_entries`

Start state: no bodyweight-series table, route, or repository exists; nothing renders or stores a
dated weight reading; the real-Postgres CI job's hardcoded file list has eight entries. End state: a
1:many `user_weight_entries` table with no unique index on `userId`, a `GET`/`POST /weight-entries`
route pair (`userId` from `request.authContext` only), a web entry form and a read-only
reverse-chronological list, and the new integration suite added to the CI list in the same commit as
the file. Rollback boundary: the table can be dropped; rows are user-entered and re-enterable — if PR
4 has shipped, dropping it returns bodyweight volume to zero, so coordinate revert order with PR 4.

Satisfies: Bodyweight Entry Recording; Bodyweight Entry Listing; SI Units Only, No Unit Field
(partial — the `weightKg` half).

### Migration + guard

- [x] PR2.1 Preflight: confirm the journal `idx` after PR 1 lands is 27, so this entry is `idx: 28`
- [x] PR2.2 RED: extend `apps/api/src/db/__tests__/migration-journal.test.ts` with a pinning
      assertion that `0028_user_weight_entries.sql` exists at `idx: 28`
- [x] PR2.3 GREEN: create `apps/api/drizzle/0028_user_weight_entries.sql` — the `user_weight_entries`
      table (`id uuid` PK default random, `user_id uuid` FK `ON DELETE CASCADE`, `weight_kg
      numeric(5,2)` NOT NULL, `recorded_at timestamptz` NOT NULL default now, `created_at timestamptz`
      NOT NULL default now) plus the composite `(user_id, recorded_at)` index; hand-add the journal
      entry `{ idx: 28, version: "7", when: <ms>, tag: "0028_user_weight_entries", breakpoints: true
      }`; add `userWeightEntries` to `apps/api/src/db/schema.ts` mirroring `userPreferences`'s
      cascade convention, with the "series, not 1:1 — deliberately no unique index on userId" comment;
      confirm PR2.2 is green

### Contracts

- [x] PR2.4 RED: extend `contracts.test.ts:61-72`'s runtime export assertion to stay unchanged; add a
      compile-time check for `WeightEntryDTO { id, weightKg, recordedAt }` and
      `CreateWeightEntryResponse { entry, wasFirstEntry }`
- [x] PR2.5 GREEN: add both types to `packages/contracts/src/index.ts`; confirm PR2.4 is green

### Route + repository

- [x] PR2.6 RED: `apps/api/src/routes/__tests__/user-weight-entry.test.ts` (`app.inject`) — POST
      validation matrix: `weightKg = 0`, negative, `> 500`, non-numeric all return
      `422 { error: "invalid_weight_kg" }`; `recordedAt` unparseable or in the future returns
      `422 { error: "invalid_recorded_at" }`; a first POST returns `201 { entry, wasFirstEntry: true
      }`; a second POST for the same user returns `wasFirstEntry: false`; GET returns entries newest
      `recordedAt` first, capped at 100; `userId` is read only from `request.authContext`, never the
      body
- [x] PR2.7 RED: `apps/api/src/db/repositories/__tests__/user-weight-entry.integration.test.ts` —
      two readings coexist for one user (no unique index enforced); GET returns newest-first;
      deleting the user cascades every row away; `wasFirstEntry` computed **inside the insert
      transaction** (`count(*) = 1` after insert) is `false` for a second entry inserted concurrently
      with the first (raced via `Promise.all`), proving it cannot fire twice or race a second tab
- [x] PR2.8 GREEN: create `apps/api/src/db/repositories/user-weight-entry.ts` — `list` (newest-first,
      cap 100), `insert` computing `wasFirstEntry` inside the transaction, `listAllForUser` (ASC,
      unbounded, feeds PR 4's resolution query); create `apps/api/src/routes/user-weight-entry.ts`
      as a new plugin, `preHandler: requireAuth()`, wiring both routes; register it in
      `apps/api/src/app.ts`; confirm PR2.6 and PR2.7 are green

### The CI list line

- [x] PR2.9 GREEN, same commit as PR2.7: add
      `apps/api/src/db/repositories/__tests__/user-weight-entry.integration.test.ts` to the hardcoded
      file list in `.github/workflows/ci-cd.yml:113-131`. Verify by re-reading the file after the edit
      that the new path is present alongside the existing eight entries — this is the line that keeps
      PR2.7's proof from being a false green under #382

### Web weight-entry form + list

- [x] PR2.10 RED: RTL + jsdom component test — the entry form submits `weightKg` and an optional date;
      the list renders entries newest-first; a validation error (non-positive weight) surfaces inline
      without a page reload
- [x] PR2.11 GREEN: implement the form and list on `apps/web/src/app/(app)/profile/` alongside the
      scalar fields (new sub-components; reuse `profile-form-client.ts`'s calling convention); confirm
      PR2.10 is green. **Do not render the first-entry notice here** — it ships in PR 4, gated on the
      volume-threading work it explains

### i18n

- [x] PR2.12 GREEN: add the weight-entry form labels and validation-error keys (not the `profile.
      weight.*` first-entry-notice keys — those are PR 4) to `packages/i18n/src/messages/{en,es}.json`;
      rebuild before manual verification

### PR 2 verification

- [x] PR2.13 Verify: `pnpm -r test` green; `pnpm -r --if-present test:coverage` green; `pnpm
      type-check` clean; `pnpm build` succeeds
- [x] PR2.14 Verify: confirm `user-weight-entry.integration.test.ts` actually executes in the
      real-Postgres CI job (re-read `.github/workflows/ci-cd.yml` after PR2.9, or inspect a CI run) —
      not merely present in the repo. DEVIATION: no CI run exists yet for this branch (not pushed/PR
      not opened — orchestrator's responsibility per instructions). Verified the file IS present in
      the hardcoded list (re-read after edit, confirmed at ci-cd.yml:131) and the suite is directory-
      independent of any other config — the same mechanism that already runs the other 8 files will
      run this one. Actual CI execution must be confirmed once the PR opens.

---

## Phase PR3: Trace Redaction + Prompt Seam

Start state: `mask()` (`apps/api/src/ai/mask.ts:17-29`) redacts only literal `limitations[].text`
terms, and the same masked string is both the model input and the Langfuse trace input
(`adapter-factory.ts:87, 112-116`); `PlanPromptInput` carries no body-metric field; the two trace
metadata objects are untyped inline literals. End state: a general span-redaction capability
(`TRACE_REDACTION_RULES` + `redactSpans`/`redactTracedPayload`) wired as the Langfuse `CallbackHandler`
`mask` option — separating trace bytes from model bytes for the first time — one `<body_profile>`
rule registered, an optional `bodyProfile` prompt input rendering byte-identically when absent, a
fail-closed backstop at the invoke seam, and both trace-metadata literals closed by a `PlanTraceMetadata`
type. Rollback boundary: reverting the prompt-variable additions restores today's prompt exactly;
**do not revert the redaction wiring independently** — a reverted prompt with intact redaction is
inert (no span rendered ⇒ `redactSpans` is a no-op), while the inverse (redaction removed, prompt
kept) is a leak.

Satisfies: Absent Body Values Degrade The Generation Prompt Byte-For-Byte; Body Metric Values Never
Reach Langfuse Trace Input; Body Metric Values Never Enter A Structured Output Schema; Body Metric
Values Never Passed As Observability Metadata; `08-v1-ai-plan-generation` Generation Prompt Carries
Body Metrics When Present (ADDED).

### The redaction module

- [x] PR3.1 RED: `apps/api/src/ai/__tests__/trace-redaction.test.ts` — `redactSpans` empties exactly
      the content of a registered span, leaving delimiters and surrounding text byte-identical;
      handles nested and repeated spans; an unterminated open marker redacts to end-of-string
      (**fail-closed, asserted explicitly** — a template that loses its closing marker still hides
      everything after the opener); a string with no matching span passes through unchanged;
      `redactTracedPayload` walks strings inside a string, an array, and a plain object, applying
      `redactSpans` to every string found; a non-string, non-array, non-object payload (number,
      boolean, null, undefined) passes through unchanged
- [x] PR3.2 GREEN: create `apps/api/src/ai/trace-redaction.ts` — `TraceRedactionRule { open, close }`;
      `TRACE_REDACTION_RULES: readonly TraceRedactionRule[]` with one entry,
      `{ open: "<body_profile>", close: "</body_profile>" }`; `redactSpans(text: string): string`;
      `redactTracedPayload(params: { data: unknown }): unknown` as the `MaskFunction` shape Langfuse
      expects; confirm PR3.1 is green

### Trace metadata typing

- [x] PR3.3 RED: `expectTypeOf` test — `PlanTraceMetadata` rejects an object literal carrying an
      excess `weightKg` (or any key outside its declared set) via an excess-property check
- [x] PR3.4 GREEN: create `apps/api/src/ai/trace-metadata.ts` exporting `PlanTraceMetadata` exactly as
      specified in `design.md`'s "The observability discipline requirement"; annotate the inline
      trace-metadata literal in `adapter-factory.ts:95-109` and `extraction-adapter.ts:251-263` with
      the type; confirm PR3.3 is green and both call sites still compile

### Source-scan guard

- [x] PR3.5 RED then GREEN, one commit (the guard itself is the test — no separate implementation
      step): a `migration-journal.test.ts`-style source scan over `apps/api/src/**/*.ts` that fails if
      any `metadata:` object-literal key matches
      `/^(weightKg|heightCm|selfDescribedSex|bodyweight)/i` **outside** `trace-redaction.ts` and its
      own test file; stated in the guard's own comment as a lint, not a type guarantee — it catches
      `metadata: { weightKg }` accidentally added to an existing `logEvent` call, not a determined
      rename

### Handler wiring

- [x] PR3.6 GREEN: `apps/api/src/ai/langfuse-handler.ts:69-73` — add `mask: redactTracedPayload` to
      the `CallbackHandler` constructor options. No RED needed here in isolation; covered by PR3.8's
      end-to-end proof

### The prompt seam — byte-identical degradation

- [x] PR3.7 RED: extend `apps/api/src/ai/__tests__/prompt.test.ts`'s existing byte-identity snapshot
      block (`:279`) and branch-preservation style (`:227-266`) — with `bodyProfile` absent,
      `buildPlanPrompt(spec)` equals the pre-change output exactly (extend the existing snapshot, do
      not create a parallel one); absent with an empty `bodyProfile` object renders identically; each
      of `selfDescribedSex`/`heightCm`/`bodyweightKg` present independently renders only that field's
      line; a `prefer_not_to_say`-equivalent (the type excludes it, so this asserts the mapping layer
      never passes it through) emits no line; the rendered section sits between the existing training
      profile and `{{limitationsSection}}`
- [x] PR3.8 GREEN: in `apps/api/src/ai/prompt.ts` — add `BodyProfilePromptInput
      { selfDescribedSex?: Exclude<SelfDescribedSex, "prefer_not_to_say">; heightCm?: number;
      bodyweightKg?: number }`; add `bodyProfile?: BodyProfilePromptInput` to `PlanPromptInput`; add
      the `{{bodyProfileSection}}` marker to `PLAN_PROMPT_TEMPLATE` on the existing blank line between
      the training profile and `{{limitationsSection}}`; `buildPlanPromptVariables` returns
      `bodyProfileSection: ""` when `bodyProfile` is absent or has no populated member, otherwise
      renders the `<body_profile>…</body_profile>` block with one line per populated field; add
      `"bodyProfileSection"` to `PLAN_PROMPT_DEFINITION.variables`; do **not** extend
      `requiredMarkers`/`orderedMarkers` (a remote template predating this change must not fail
      validation over a purely additive variable); confirm PR3.7 is green
- [x] PR3.9 RED then GREEN: assert `promptLinked` stays `true` on a traced generation with the `mask`
      option attached (the open apply-time decision on slice-C interaction) — extend the existing
      prompt-linkage test harness from 16e/16e-slice-C rather than assuming orthogonality

### The masking proof at the invoke boundary

- [x] PR3.10 RED: extend `apps/api/src/ai/__tests__/adapter-factory.test.ts`'s existing
      masking-payload harness — **the proof that matters**: with body values present on the spec,
      capture the payload the `CallbackHandler` observes at the `.invoke()` boundary and assert **no**
      body value survives into trace input, while the string actually handed to `.invoke()` still
      **contains** them. Assert both halves in the same test — asserting only the redaction half would
      pass for a change that accidentally also stripped the values from generation
- [x] PR3.11 GREEN: in `apps/api/src/ai/generation-service.ts` — attach `bodyProfile` beside
      `allowedExercises` (`:224-227`), mapping the user's profile row and resolved bodyweight into
      `BodyProfilePromptInput` (dropping `prefer_not_to_say` per the type's `Exclude`); confirm PR3.10
      is green

### The fail-closed backstop

- [x] PR3.12 RED: injected-renderer test — with a deliberately marker-less rendering of the body
      section (simulating a template that lost its `<body_profile>` delimiters), the prompt degrades
      to the no-body rendering (today's exact prompt) and a log event is emitted with reason code
      `body_profile_redaction_unverified`; assert the log payload contains **no** body value, ever
- [x] PR3.13 GREEN: in `apps/api/src/ai/adapter-factory.ts`, in `invokeChain`, after rendering and
      before `.invoke()` — when `bodyProfile` is present, check whether `redactSpans(maskedPrompt)`
      still contains the body section's **inner text** (the distinctive multi-line string, not bare
      numerals — so `Session duration: 68 minutes` can never false-positive); if it does, re-render
      without `bodyProfile` and log the reason code with no values; confirm PR3.12 is green

### PR 3 verification

- [x] PR3.14 Verify: `pnpm -r test` green; `pnpm -r --if-present test:coverage` green (apps/api
      functions ≥85%); `pnpm type-check` clean; `pnpm build` succeeds

---

## Phase PR4: Bodyweight Volume

Start state: `computeSessionVolume`, `exerciseVolume`, and the muscle-group bucket reduce each
compute `(weightKg ?? 0) * reps` independently, with no shared resolution rule; bodyweight sets
report zero volume unconditionally; `computePersonalRecords` reads the set's logged load directly.
End state: `resolveBodyweightForSession` is a pure, unit-tested domain function; every volume site
reads one `resolvedBodyweightKg` carried on `WorkoutSessionRecord`, resolved once at the repository
mapping boundary; personal records are pinned unaffected; the first-entry volume-shift notice renders
on `wasFirstEntry: true`. Rollback boundary: revert the threading and volume formulas back to
weight-only — nothing is stored per-set, so nothing is corrupted, the numbers simply move back; the
notice reverts with it. If PR 2 is later dropped, coordinate: dropping the table after this ships
returns bodyweight volume to zero.

Satisfies: Bodyweight Resolution For Volume; Volume Shift Is Announced At First Weight Entry;
Personal Records Remain Unaffected By Bodyweight Volume; `09c-v1-progress-dashboard-stats` Statistics
Surface (MODIFIED).

### The resolution rule (pure, unit-tested)

- [x] PR4.1 RED: `packages/domain/src/progress/__tests__/bodyweight-resolution.test.ts` — the full
      behavior table from `design.md`: zero entries → `undefined`; session after some reading → the
      latest at-or-before; session before every reading → the earliest (backstop); session exactly at
      a reading's instant → that reading (inclusive); two readings at the same instant → the
      later-inserted, by stable `recordedAt ASC, id ASC` ordering; **a later weigh-in does not rewrite
      an already-resolved older session** (the settled-history pin — a weight entry on 2026-06-01
      after a session on 2026-05-01 already resolved against a 2026-04-01 entry must not change the
      2026-05-01 session's resolution)
- [x] PR4.2 GREEN: create `packages/domain/src/progress/bodyweight-resolution.ts` exporting
      `BodyweightEntry { weightKg, recordedAt }` and
      `resolveBodyweightForSession(entries, sessionAt): number | undefined`; export it from
      `packages/domain/src/index.ts`; confirm PR4.1 is green

### Repository: batch read + resolve at mapping + the three sites

- [x] PR4.3 RED: extend `packages/contracts/src/contracts.test.ts:61-72` runtime-export assertion to
      stay unchanged; add a compile-time check that `WorkoutSessionRecord.resolvedBodyweightKg` is
      `number | undefined`
- [x] PR4.4 GREEN: add `resolvedBodyweightKg?: number` to `WorkoutSessionRecord` in
      `packages/contracts/src/index.ts`; confirm PR4.3 is green
- [x] PR4.5 RED: `apps/api/src/db/repositories/__tests__/workout-session.integration.test.ts` — a
      batched query reads all of the user's weight entries once per stats/history call (assert query
      count does not scale with session count — no N+1 across a year of sessions); each
      `WorkoutSessionRecord` produced for a volume consumer carries `resolvedBodyweightKg` resolved
      against `session.completedAt ?? session.startedAt`; the muscle-group bucket reduce
      (`:1355-1358`) uses the resolved value for a weightless set; the weekly rollup (`:1161`) and
      `recentSessions[].volumeKg` (`:1063`) both reflect it
- [x] PR4.6 GREEN: in `apps/api/src/db/repositories/workout-session.ts` — one batched query per
      stats/history call reading all of the user's weight entries ordered `recordedAt ASC`; resolve
      once per session via `resolveBodyweightForSession`, applying the identical expression
      `(set.weightKg ?? 0) > 0 ? set.weightKg! : (session.resolvedBodyweightKg ?? 0)` at every site —
      muscle-group bucket, weekly rollup, `recentSessions[].volumeKg`; confirm PR4.5 is green
- [x] PR4.7 RED: `packages/domain/src/offline/__tests__/session-aggregation.test.ts` — a
      bodyweight-only session reports `0` volume when `resolvedBodyweightKg` is absent, non-zero when
      present; a loaded set is unaffected by the field's presence; a `0 kg` **logged** set still takes
      the bodyweight fallback (the `(weightKg ?? 0) > 0` predicate, not `weightKg == null` — an
      explicitly-logged `0 kg` is indistinguishable from unlogged, and `0 × reps` is the lie this
      change exists to end); incomplete (non-`completed`) sets remain excluded, unchanged; history
      trend deltas via `computeVolumeTrend` (`:91`) reflect the resolved contribution
- [x] PR4.8 GREEN: in `packages/domain/src/offline/session-aggregation.ts` — `computeSessionVolume`
      reads `session.resolvedBodyweightKg` using the same `(weightKg ?? 0) > 0 ? … : …` expression;
      **no signature change** (it already takes the whole `WorkoutSessionRecord`, so every existing
      caller compiles and behaves unchanged when the field is absent); confirm PR4.7 is green

### Open decision — the full call-site enumeration

- [x] PR4.9 Grep-confirm every call site that constructs a `WorkoutSessionRecord` destined for a
      **volume** consumer (Stats KPI, weekly rollup, `recentSessions[].volumeKg`, `computeVolumeTrend`,
      the web tracker's live readout) and confirm each one receives the resolved weight from PR4.6.
      Record the confirmed list in the PR description; a missed path degrades safely to today's
      numbers but is an inconsistency between two screens, so state explicitly which paths were
      checked and which (if any) were found not to need the value (e.g. a PR-only consumer)

### Personal records — the non-regression pin

- [x] PR4.10 RED then GREEN, one commit (the test is the deliverable — no production code changes):
      `packages/domain/src/progress/__tests__/personal-records.test.ts` — `computePersonalRecords`
      output (`prCount`, `personalRecords`) is byte-identical across a fixture run with and without a
      resolved bodyweight attached to the same sets; the `weightKg > 0` eligibility rule
      (`isEligible`, `:24-26`) is pinned directly; confirms `openspec/specs/09c-v1-progress-dashboard-
      stats/spec.md`'s "Bodyweight and no-weight sets are excluded from 1RM PRs" scenario stands
      unchanged

### Web tracker

- [x] PR4.11 RED: `apps/web/src/app/(app)/plan/[id]/tracker/__tests__/tracker-model.test.ts` —
      `exerciseVolume` with a second `resolvedBodyweightKg?: number` argument applies the fallback for
      a weightless set; the existing no-second-argument call sites remain byte-identical
- [x] PR4.12 GREEN: `apps/web/src/app/(app)/plan/[id]/tracker/tracker-model.ts:116-121` —
      `exerciseVolume` gains the optional second parameter, threaded from the session by
      `deriveTrackerModel`; confirm PR4.11 is green

### Offline mobile snapshot — the open question

- [x] PR4.13 Confirm the offline mobile snapshot writer's schema-version assertion (if any) does not
      reject a `WorkoutSessionRecord` carrying the new optional `resolvedBodyweightKg` field, and that
      a snapshot taken before this PR (missing the field) still deserializes correctly. Record which
      file(s) were inspected and the outcome

### First-entry volume-shift notice

- [x] PR4.14 RED: RTL + jsdom component test — the notice renders on `wasFirstEntry: true`, is
      `role="status"`, does **not** steal focus (`document.activeElement` unchanged by its
      appearance), and does **not** render on a second entry (`wasFirstEntry: false`)
- [x] PR4.15 GREEN: render the notice on the web weight-entry form (from PR 2's form, now consuming
      `wasFirstEntry` from the `CreateWeightEntryResponse` PR 2 already returns) — dismissible,
      not persisted; add `profile.weight.*` keys to `packages/i18n/src/messages/{en,es}.json`, both
      locales, neutral professional Spanish; rebuild before manual verification; confirm PR4.14 is
      green

### PR 4 verification

- [x] PR4.16 Verify: `pnpm -r test` green; `pnpm -r --if-present test:coverage` green (apps/api
      functions ≥85%, apps/web functions ≥90%); `pnpm type-check` clean; `pnpm build` succeeds

---

## Phase PR5: Mobile Profile Screen (Greenfield)

Start state: zero matches for `UserProfile`/`experienceLevel` in `apps/mobile/src` — no profile
screen exists on mobile at all. End state: a new per-screen `react-intl` profile screen reading and
writing the same `selfDescribedSex`/`heightCm`/weight-entry data as web, under the same validation and
isolation rules, rendering the same first-entry notice from the same `wasFirstEntry` flag. Rollback
boundary: self-contained new screen and API clients; revert in isolation, no other PR depends on it.

Satisfies: Mobile Profile Parity.

- [x] PR5.1 RED: RN component test — `ProfileScreen.tsx` renders name, goal, experience level,
      `selfDescribedSex`, and height; round-trips every field through the mobile API client
- [x] PR5.2 GREEN: create `apps/mobile/src/api/user-profile-client.ts` (`fetchUserProfile`/
      `updateUserProfile`) and `apps/mobile/src/screens/profile/{ProfileScreen.tsx,
      ProfileScreen.styles.ts, messages.ts}` — per-screen `defineMessages`, following
      `screens/tracker/messages.ts`'s convention (mobile does **not** read the shared `next-intl`
      catalogs); confirm PR5.1 is green
- [x] PR5.3 RED: RN component test — the weight-entry field posts a new reading and the list renders
      newest-first; the first-entry notice renders once on `wasFirstEntry: true` and does not repeat
- [x] PR5.4 GREEN: create `apps/mobile/src/api/weight-entry-client.ts` (`fetchWeightEntries`/
      `createWeightEntry`); extend `ProfileScreen.tsx` with the weight-entry field, list, and notice;
      confirm PR5.3 is green
- [x] PR5.5 RED: RN component test — an invalid `selfDescribedSex` value, a non-positive `heightCm`,
      and a non-positive `weightKg` are each rejected under the same validation rules as the web
      endpoints (the client surfaces the API's 422, it does not duplicate the validation logic)
- [x] PR5.6 GREEN: wire client-side error surfacing for the three rejection cases in `ProfileScreen.tsx`;
      confirm PR5.5 is green

### PR 5 verification

- [x] PR5.7 Verify: `pnpm -r test` green; `pnpm -r --if-present test:coverage` green; `pnpm type-check`
      clean; `pnpm build` succeeds

---

## Final Verification (run once the full chain has landed)

- [x] `pnpm -r test` — full suite green, hermetic
- [x] `pnpm -r --if-present test:coverage` — apps/api functions ≥85%, apps/web functions ≥90%
- [x] `pnpm type-check` — no errors, all workspaces
- [x] `pnpm build` — CI's real gate, succeeds (also confirms `packages/i18n` rebuild picked up every
      new catalog entry across PRs 1, 2, and 4)
- [x] Grep confirms both migration journal entries (`idx: 27`, `idx: 28`) are present and contiguous
- [x] Grep confirms `user-weight-entry.integration.test.ts` is present in
      `.github/workflows/ci-cd.yml`'s hardcoded file list (line 131) — actual CI execution on the
      real-Postgres job could not be re-confirmed from this apply phase (no CI run inspected; PR5 has
      not been opened yet, per instructions that is the orchestrator's step)
- [x] Grep confirms no `WorkoutExerciseSchema`/`WorkoutSessionSchema`/`WorkoutProgramSchema` field was
      added for any body-metric value
- [x] Grep confirms no `metadata:` literal in `apps/api/src` outside `trace-redaction.ts` and the
      guard's own test fixture carries a body-metric-shaped key (the source-scan guard from PR3.5,
      re-checked manually once)
- [ ] Manual: with a test user's body fields fully absent, the generation prompt is confirmed
      byte-identical to a pre-change capture (PR3.7's automated snapshot is the durable guarantee;
      this is a one-time manual sanity check against a real generation call) — NOT performed this
      phase: no live LLM/generation call was made; requires a human or a follow-up operational check
- [ ] Manual/operational: confirm #374 is still unresolved and unchanged from the design's
      reconstruction before considering this change "done" with respect to the composition table —
      NOT re-checked this phase: no GitHub issue access from this apply context; already confirmed
      once during design/apply handoff, still needs one live re-check before archive
