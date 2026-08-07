# Design: 17c-profile-body-metrics

Implements the pinned decisions of `openspec/changes/17c-profile-body-metrics/proposal.md` (1-10 plus
the resolved question round) over the evidence in `exploration.md`. This document owns the HOW: the
trace-redaction capability, the prompt seam, the enum, the weight table and its resolution rule, the
volume threading, the mobile shape, and the PR seams. It does not restate the product decisions and
does not reopen them.

Scope reductions carried in from the resolved question round and applied throughout: **C3
(gendered-imagery suppression) is out of scope entirely**, the 29/4 catalog spot-check is not run,
sex and gender are **one** self-described field, and volume-shift communication is **first weight
entry only** with no persistent Stats note.

Every claim marked **verified** was checked by opening the file named beside it during this phase.
Four of the proposal's working assumptions did not survive that check. They are called out in
**Corrections to the proposal**, and one of them changes the central mechanism of the change.

## Technical Approach

Five seams, one genuinely new capability:

1. **A trace-redaction capability at the Langfuse SDK boundary** (`apps/api/src/ai/trace-redaction.ts`),
   wired as the `mask` option of the `CallbackHandler`. This is the only place in the stack where the
   model input and the trace input can diverge — and divergence is exactly what scope B needs. It is
   written as a general span-redaction rule list, not a body-metrics special case.
2. **An optional prompt input field**, `bodyProfile`, on `PlanPromptInput` — mirroring
   `allowedExercises` (#352) line for line, including its absent-is-empty-string rendering, so
   byte-identical degradation is structural rather than tested-for.
3. **A new 1:many table** `user_weight_entries` with a **pure domain resolution function**, so the
   rule that decides which reading applies to which session is unit-testable and runs in CI.
4. **One resolved bodyweight, carried on `WorkoutSessionRecord`**, resolved once at the repository
   boundary and consumed by every volume formula. This is what stops the three existing volume
   implementations from drifting apart.
5. **A greenfield mobile profile screen**, following the existing per-screen `react-intl` convention.

Everything else is a consequence.

## Corrections to the proposal

| Proposal claim | Verified reality | Consequence for this design |
|---|---|---|
| Decision 3: "extend the existing redaction step to cover body-metric values **before `invoke()`**" | **Self-contradictory as written.** `mask()` rewrites the string that is handed to `.invoke()`, and that same string is both the model input and the trace input (`adapter-factory.ts:87, 112-116` — verified). Masking body values before `invoke()` therefore removes them from the **model**, which is the entire point of scope B. You cannot mask before `invoke` and still feed generation | The mechanism must make the model input and the trace input **diverge**. See **The trace-redaction capability**. The pinned *intent* — one redaction seam, no change to trace coverage, values never reach Langfuse — is honoured exactly; only the hook moves |
| Exploration §4: volume is computed "in `tracker-model.ts` and in the API stats aggregation" — two sites | **Three sites, verified.** (a) `computeSessionVolume` (`packages/domain/src/offline/session-aggregation.ts:11-24`), completed-set-gated; (b) `exerciseVolume` (`apps/web/.../tracker-model.ts:116-121`), **not** completed-gated; (c) an inline reduce for the muscle-group bucket (`apps/api/.../workout-session.ts:1355-1358`), completed-gated | The "one shared rule, not two" mitigation is more urgent than the proposal knew. Resolved by carrying **one** resolved number on the record — see **Bodyweight volume** |
| Orchestrator brief: "the blast radius is only the Stats volume KPI" | **Too narrow.** `computeSessionVolume` also feeds the weekly rollup (`:1161`), the progress route's `recentSessions[].volumeKg` (`:1063`), and — since 17b — history trend deltas via `computeVolumeTrend` (`session-aggregation.ts:91`). The web tracker's live volume readout is a fourth surface | Every volume surface moves, not one. What **is** confirmed is the PR claim: see the row below. All four are the same class of number and all four are covered by the same threading |
| Risk table: "Drizzle journal entry omitted — hand-verify the journal `idx`" | **Already automated.** `apps/api/src/db/__tests__/migration-journal.test.ts` (shipped by 17b) asserts every `drizzle/*.sql` has a journal `tag` and that `idx` is contiguous from 0. **Confirmed it covers new migrations automatically** — both assertions are directory-driven, not a hardcoded list | The hand-check is retired. The only manual step left is picking the right `idx` (27 and 28 — journal max is currently 26, verified) |

**Confirmed unchanged, exactly as the proposal states:** `computePersonalRecords`
(`personal-records.ts:24-26`) gates on `set.completed && (weightKg ?? 0) > 0 && (actualReps ?? 0) > 0`
and computes Epley from that load alone; it never reads a volume figure. This design makes that
invariant **structural** — see **Why PRs cannot move**.

## Architecture Decisions

| Decision | Choice | Rejected | Rationale |
|---|---|---|---|
| Where body values are withheld from Langfuse | The SDK's own `mask` hook, supplied at `CallbackHandler` construction (`langfuse-handler.ts:69-73`) | Masking before `.invoke()`; a per-request `CallbackHandler`; an `AsyncLocalStorage` value registry | The `mask` hook is the **only** point where trace bytes and model bytes are separable. Verified present in the installed `langfuse-core@3.38.20` (`LangfuseCoreOptions.mask?: MaskFunction`), applied in `maskEventBodyInPlace` at **enqueue**, in-process, before any network call. A per-request handler would fragment the single-handler flush lifecycle 16e built. `AsyncLocalStorage` fails **open** if context is ever lost, which is unacceptable for a privacy control |
| Redaction rule shape | **Delimited spans**, not literal values: an ordered `TRACE_REDACTION_RULES` list of `{ open, close }` markers. 17c registers one rule (`<body_profile>`) | A value list threaded from the request | A global hook cannot know per-request values without async context. A span rule needs no context at all, is a pure string transform, and is the general capability the proposal asked for: #374's recorded option (b) — "trace that turn with a redacted input while the model still receives the raw text" — is the **same** mechanism pointed at a different span |
| Marker syntax | XML-ish `<body_profile>…</body_profile>` inside the rendered section | Zero-width or control characters; comment syntax | The model sees the markers. XML-ish tags read as structure to every current model and are standard prompt practice, so they cost nothing in generation quality and are legible in a trace as `<body_profile>[REDACTED]</body_profile>` — a reviewer can see that redaction *happened*, which an invisible delimiter would hide |
| Fail-closed backstop | A value-level check at the invoke seam: if applying the redaction to the rendered prompt leaves the body section's text intact, **omit the section** and generate with today's prompt, logging a secret-free reason code | Throwing; trusting the span rule alone | The span rule fails **open** on its own (a template that loses its markers leaks). The check runs where the values actually are, needs no async context, and degrades to a *worse plan* rather than a *leak*. Generation never fails for a privacy bug |
| Body data on the prompt input | `bodyProfile?: BodyProfilePromptInput` on `PlanPromptInput` (`prompt.ts:5-17`), attached in `generation-service.ts` beside `allowedExercises` (`:224-227`) | A field on `PlanSpec`; a field on any workout schema | `PlanSpec` is the wizard's captured artifact and is persisted; body metrics are durable profile state read at generation time, exactly like `memoryContext`. `allowedExercises` is the proven precedent for "optional, server-attached, absent ⇒ byte-identical". Decision 2's hard boundary (no `WorkoutExerciseSchema`/`WorkoutSessionSchema`/`WorkoutProgramSchema` field) is untouched |
| Which prompts carry body data | **Plan generation only** (`PLAN_PROMPT_TEMPLATE`). Not the chat reply prompt, not the extraction prompt | Rendering body metrics into the chat prompts too | Extraction turns a conversation into a `PlanSpecDraft`; physiology does not help it, and adding it would widen exposure for no gain. **Both paths are still covered** because the wizard and the chat converge on the same `invokeChain` for the actual generation, and — decisively — the redaction hook lives on the **shared handler**, so `streamReply`/`extract` (`extraction-adapter.ts:264, 332`) inherit the capability whether or not they ever carry a span |
| Sex/gender field | **One** nullable pgEnum `self_described_sex`, values `female \| male \| non_binary \| other \| prefer_not_to_say` | Two fields; free text; a boolean | Decision 9. Free text cannot be validated at the route boundary the way `goal`/`experienceLevel` are (`user-profile.ts:15-25`) and would be a far worse thing to send to a vendor. `prefer_not_to_say` is a positive member, distinct from `NULL`, per decision 8 |
| Resolution rule home | A pure function `resolveBodyweightForSession(entries, sessionDate)` in `packages/domain/src/progress/` | Inline SQL (`DISTINCT ON`) in the repository | The rule is the part most likely to be got wrong and it is the part that decides whether history is stable. A pure function is unit-tested by `pnpm -r test` on every push; a SQL-only rule is provable **only** in an integration suite, and nine of those never execute in CI (#382 — see **Testing strategy**) |
| Resolved bodyweight transport | An optional `resolvedBodyweightKg?: number` on `WorkoutSessionRecord`, populated at the repository mapping boundary | Passing a weight series to each formula; three independent resolutions | One resolution per session, one number, three consumers. Every formula becomes `(weightKg ?? 0) > 0 ? weightKg * reps : (resolvedBodyweightKg ?? 0) * reps` — the same expression in three places, over a value none of them computes. The web tracker gets it for free through the record it already fetches |
| Weight-series read | One batched query per stats/history call: all of the user's entries, ordered `recordedAt ASC`, resolved in memory per session | A correlated subquery or a per-session lookup | A user's weight series is small and unbounded only in theory. One query keeps the existing bounded query-count shape of `getStatsSummary` and avoids N+1 across a year of sessions |
| Volume-shift notice | Rendered on the **web weight-entry form** when the POST response reports it was the user's first entry; server-authoritative via a `wasFirstEntry: boolean` on the create response | Client-side "is the list empty" inference; a persistent Stats banner | Client inference races a second tab and re-fires after a delete. The server knows, in the same transaction that inserts. The persistent Stats note was explicitly dropped by the resolved question round |

## The trace-redaction capability

This is the highest-stakes item in the change, and the proposal's stated hook does not work. Here is
the mechanism, the composition with #374, and what it costs.

### Why the model and the trace must diverge

Verified call shape (`adapter-factory.ts:87, 112-116`):

```ts
const maskedPrompt = mask(rawPrompt, limitationTerms);
const raw = await (linkedChain as typeof chain).invoke(maskedPrompt, {
  runName: "plan-generation",
  metadata: traceMetadata,
  ...(handler ? { callbacks: [handler] } : {}),
});
```

One string, two consumers. For **limitations** that is acceptable: the model losing a limitation term
to `[REDACTED]` degrades the plan, and the product accepted that trade long ago. For **body metrics**
it is not: scope B exists to put those values in front of the model. Extending `mask()` would ship a
change whose entire purpose is cancelled by its own privacy control.

### The hook

`langfuse-core@3.38.20` exposes `mask?: MaskFunction` on `LangfuseCoreOptions`, and applies it in
`maskEventBodyInPlace` (verified in the installed package):

```js
maskEventBodyInPlace(body) {
  if (!this.mask) return;
  const maskableKeys = ["input", "output"];
  for (const key of maskableKeys) {
    if (key in body) {
      try { body[key] = this.mask({ data: body[key] }); }
      catch (e) { body[key] = "<fully masked due to failed mask function>"; }
    }
  }
}
```

Three properties that make this the right seam, all verified from that source:

- It runs at **enqueue**, in-process, before the event is queued for transport. Nothing unredacted is
  ever buffered for the network.
- It **fails closed on a throw**: a rule that raises replaces the whole payload with
  `"<fully masked due to failed mask function>"`. A bug in our redaction cannot become a leak.
- It touches `input` and `output` **only**. Trace `metadata` is **not** masked. This is a hard
  constraint the design must respect, and it is why the metadata discipline below is typed rather
  than trusted.

### The module

```ts
// apps/api/src/ai/trace-redaction.ts — NEW
/** One span of prompt text that must never leave the process inside a trace. */
export interface TraceRedactionRule {
  /** Opening delimiter, rendered verbatim into the prompt. */
  readonly open: string;
  /** Closing delimiter. */
  readonly close: string;
}

/**
 * Ordered redaction rules applied to every Langfuse trace input/output.
 *
 * GENERAL BY DESIGN: a rule names a span, never a value. Adding a new class of
 * sensitive prompt content is one entry here plus the matching delimiters in
 * whichever prompt renders it — no change to this function, to the handler, or
 * to any adapter. #374 (first-mention limitation text) is exactly one further
 * entry when the product elects to take it.
 */
export const TRACE_REDACTION_RULES: readonly TraceRedactionRule[] = [
  { open: "<body_profile>", close: "</body_profile>" },
];

/** Replace every rule's span content with `[REDACTED]`, leaving the delimiters. */
export function redactSpans(text: string): string;

/**
 * `MaskFunction` for the Langfuse `CallbackHandler`. Walks strings inside
 * `data` (string, array or object) and applies `redactSpans` to each. Pure.
 */
export function redactTracedPayload(params: { data: unknown }): unknown;
```

Wired in one place:

```ts
// langfuse-handler.ts:69-73
return new CallbackHandler({
  publicKey,
  secretKey,
  mask: redactTracedPayload,
  ...(baseUrl ? { baseUrl } : {}),
}) as TracingHandler;
```

That single wiring covers **both paths**: `invokeChain` (wizard generation) and
`PlanSpecExtractionAdapter.streamReply` / `.extract` (chat create-plan) attach the *same* injected
handler (`extraction-adapter.ts:264, 332` — verified), so neither adapter changes at all for
redaction purposes.

### The fail-closed backstop

The span rule alone fails open: a remote Langfuse template edited to drop the markers would render
body values untagged. Slice B2's template validation (`requiredMarkers`) cannot help, because the
markers live **inside** the `{{bodyProfileSection}}` value, not in the template — they have to, or
the absent case could not render as an empty string (see **Byte-for-byte degradation**).

So the invoke seam checks its own work, where the raw values are in scope:

```
buildBodyProfileSection(bodyProfile) -> { text, innerText }   // "" and "" when absent

in invokeChain, after rendering and before `.invoke`:
  if bodyProfile present:
      if redactSpans(maskedPrompt) still contains innerText:
          → re-render WITHOUT bodyProfile   (today's exact prompt)
          → log { reason: "body_profile_redaction_unverified" }   // no values, ever
```

The check is on the section's **inner text** — a distinctive multi-line string — not on bare
numerals, so `Session duration: 68 minutes` can never trigger a false degrade. The failure mode is a
plan generated without body context plus one greppable log line. The failure mode it replaces is
health data at a third-party vendor.

### Composition with #374 — stated explicitly, as required

I could not re-read #374 directly: **this phase has no shell tool, so `gh issue view 374` could not be
run.** I reconstructed its content from the archived 16e artifacts that filed it, which record both
the defect and the two options the issue carries (`proposal.md:210-219`, `apply-progress.md:880-882`,
`archive-report.md:81` — all verified):

> `mask()` reads the terms to scrub from `input.limitations`, so a limitation the user states for the
> *first* time in `message` is not yet known and travels unmasked in that turn's prompt — by design,
> because the extractor must see it once to populate `limitations`. Recorded options: **(a)** exclude
> the first-mention turn from the trace payload, or **(b)** trace that turn with a redacted input
> while the model still receives the raw text.

Apply should confirm this against the live issue before implementing; if #374 has since been
re-scoped, the composition below is what needs re-checking, not the mechanism.

How they compose:

| | 17c (body metrics) | #374 (first-mention limitations) |
|---|---|---|
| Model must see the raw value | **Yes** — generation depends on it | **Yes** — extraction depends on it |
| Trace must not | Yes | Yes |
| Therefore needs | Model/trace divergence | Model/trace divergence |
| Mechanism | `TRACE_REDACTION_RULES` + `<body_profile>` span | `TRACE_REDACTION_RULES` + a `<user_message>` span in `extraction-prompt.ts` |

They are the **same shape**, which is why the proposal predicted this seam would make #374 cheaper —
and it does: #374 becomes one rule entry plus delimiters around the user message, with no new module,
no new wiring, and no second seam. They cannot collide, because they are two entries in one ordered
list operating on disjoint delimiters, applied by one function.

**17c does not fix #374.** No rule delimits the user message here, so first-mention limitation text
still reaches the trace exactly as it does today. Stated so nobody reads a green 17c as closing it.

### What is lost, and why that is acceptable

Redacting a value from the trace also removes it from what a debugger can see. Concretely: when a
generated plan prescribes an implausible load, an engineer reading the Langfuse trace will see
`<body_profile>[REDACTED]</body_profile>` and cannot tell whether the model was told the user weighs
52 kg or 152 kg. That is a real cost, paid on every body-metrics generation bug.

It is acceptable for three reasons. The values remain in the app's own database, readable by anyone
authorised to debug the account, so the information is *relocated* rather than destroyed. The
delimiters survive redaction, so a trace still shows *whether* body context was supplied — which
separates "the model ignored the data" from "the data never arrived", the more common failure. And
the alternative is not "a better debugging experience"; it is health data at a vendor, which is the
one outcome decision 3 exists to prevent.

## Byte-for-byte degradation (decision 7)

The guarantee must be structural. It is, by copying `allowedExercises` exactly.

`PLAN_PROMPT_TEMPLATE` gains **one** marker, placed on the existing blank line between the training
profile and `{{limitationsSection}}`:

```
- Training emphasis (0–1 weights): strength={{preferenceStrength}}, …{{intensityBiasSection}}{{bodyProfileSection}}

{{limitationsSection}}
```

`buildPlanPromptVariables` returns `bodyProfileSection: ""` whenever `spec.bodyProfile` is absent or
has no populated member. `renderTemplate` substitutes the empty string, and the template around it is
unchanged — so the rendered output is byte-identical to today's by **construction**, in the same way
`intensityBiasSection` (`prompt.ts:141-146`) and `vocabularySection` (`:162-171`) already are. There
is no `if` in the template, no trailing whitespace to trim, and no way to render a section header with
nothing under it.

Populated, it renders:

```

<body_profile>
USER BODY PROFILE (self-reported):
- Sex/gender: female
- Height: 172 cm
- Bodyweight: 68 kg
</body_profile>
```

Each line is emitted only for a populated value, so a user with only a height gets one line. A
`prefer_not_to_say` sex emits **no** line — it is absent for generation purposes (decision 8), and
differs from `NULL` only in whether the product may ask again.

`PLAN_PROMPT_DEFINITION.variables` gains `"bodyProfileSection"`. `requiredMarkers` and
`orderedMarkers` are **not** extended: a remote template predating this change would then fail
validation and force the fallback path on every call, which is a self-inflicted outage for a purely
additive variable.

Test shape mirrors `prompt.test.ts`'s existing branch-preservation style
(`describe("buildPlanPrompt — closed exercise vocabulary (#352 slice B)")`, `:227-266`) plus the
existing byte-identity snapshot block at `:279`.

## The self-described field

```sql
CREATE TYPE "public"."self_described_sex" AS ENUM (
  'female', 'male', 'non_binary', 'other', 'prefer_not_to_say'
);
ALTER TABLE "user_profiles" ADD COLUMN "self_described_sex" "self_described_sex";
ALTER TABLE "user_profiles" ADD COLUMN "height_cm" integer;
```

Both nullable and additive — `userProfiles` (`schema.ts:950-969`) already documents the
"row may exist with NULL, user chooses later" contract for `goal`/`experienceLevel`, and these follow
it exactly.

| State | Column | Rendered in prompt | Product may re-ask |
|---|---|---|---|
| Never asked | `NULL` | no line | **yes** |
| Asked, declined | `'prefer_not_to_say'` | no line | **no** |
| Answered | one of four | one line | n/a |

The route mirrors `goal`'s three-way semantics verbatim (`user-profile.ts:157-184`): `undefined`
preserves, `null` unsets, a string is enum-checked against a `VALID_SELF_DESCRIBED_SEX` constant
declared beside `VALID_GOALS` (`:15-25`) and returning `422 { error: "invalid_self_described_sex" }`.
`heightCm` is validated as an integer in `[50, 300]` → `422 { error: "invalid_height_cm" }`; the bound
exists to reject a user who types their height in metres or their weight by mistake, not to police
bodies.

## `user_weight_entries`

```ts
export const userWeightEntries = pgTable(
  "user_weight_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    weightKg: numeric("weight_kg", { precision: 5, scale: 2 }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // Series, NOT 1:1 — deliberately no unique index on userId (proposal A2).
    userRecordedAtIdx: index("user_weight_entries_user_recorded_at_idx")
      .on(table.userId, table.recordedAt),
  })
);
```

`ON DELETE CASCADE` follows the universal convention for user-scoped children (`userProfiles:955`,
`userPreferences:985`). The composite `(userId, recordedAt)` index serves both reads — the
reverse-chronological list and the resolution query — with one structure. `numeric(5,2)` matches
`set_records.weightKg`'s numeric choice and reads back as `string`, so the repository converts through
the existing `toOptionalNumber` helper (`workout-session.ts`).

**Route surface** — a new plugin `apps/api/src/routes/user-weight-entry.ts`, `preHandler: requireAuth()`,
`userId` from `request.authContext` only, never from the body:

| Route | Behaviour |
|---|---|
| `GET /weight-entries` | `200 { entries: WeightEntryDTO[] }`, `recordedAt DESC` — newest first, capped at 100 |
| `POST /weight-entries` | `201 { entry, wasFirstEntry }`. Validates `weightKg` in `(0, 500]` → `422 { error: "invalid_weight_kg" }`; optional `recordedAt` must parse and not be in the future → `422 { error: "invalid_recorded_at" }` |

`wasFirstEntry` is computed **inside the insert transaction** (`count(*) = 1` after insert) so the
notice cannot fire twice or race a second tab. It is the only reason the response is an envelope
rather than the bare entry.

**Migration bookkeeping.** Two hand-written SQL files, `0027_user_profile_body_metrics.sql` and
`0028_user_weight_entries.sql`, with hand-added journal entries at `idx: 27` and `idx: 28` (journal
max is currently 26 — verified). No `meta/*_snapshot.json`; snapshots stop at `0024` and `0025`/`0026`
are the precedent. **The journal trap is already automated:** `migration-journal.test.ts` (17b) reads
the `drizzle/` directory and the journal from disk and asserts every `.sql` has a `tag` and that `idx`
is contiguous from 0. I confirmed both assertions are directory-driven, so they cover these two
migrations with no edit. The file's third test pins 17b's specific entry; a matching one-line
assertion per migration is cheap and follows the established shape.

## The weight resolution rule (decision 5)

**Nearest reading at or before the session, falling back to the earliest reading.** A pure function,
so it is provable in the always-run unit suite:

```ts
// packages/domain/src/progress/bodyweight-resolution.ts — NEW
export interface BodyweightEntry {
  weightKg: number;
  /** ISO-8601 instant the reading was recorded. */
  recordedAt: string;
}

/**
 * The bodyweight that applies to a session completed at `sessionAt`.
 *
 * Nearest reading at-or-before the session; when every reading is LATER than
 * the session (i.e. the session predates the user's first weigh-in), the
 * EARLIEST reading is the backstop. Returns `undefined` only when there are no
 * readings at all — never a guessed or averaged number (decision 7).
 */
export function resolveBodyweightForSession(
  entries: readonly BodyweightEntry[],
  sessionAt: string,
): number | undefined;
```

Behaviour, spelled out because the edge cases are the whole point:

| Situation | Result |
|---|---|
| No entries at all | `undefined` → volume falls back to `(weightKg ?? 0) * reps`, i.e. today |
| Session after some reading | The latest reading at or before it |
| Session before **every** reading | The **earliest** reading (the backstop) |
| Session exactly at a reading's instant | That reading (at-or-before is inclusive) |
| Two readings on the same instant | The later-inserted one, by stable `recordedAt ASC, id ASC` ordering |

**Why this rule and not the obvious ones**, restated from the proposal because the code must encode
it: exact-date-only leaves volume at ~zero because almost no session has a same-day weigh-in;
most-recent-regardless-of-date makes every new weigh-in rewrite the entire history. The chosen rule
gives one shift on first entry, after which each new reading only affects sessions **after the
previous reading**. Settled history stays settled — that property is what the "later weigh-in does not
change an old session" test pins.

The repository sorts entries ASC once per query and passes the same array to every session, so the
function is called N times over one small array with no per-session I/O.

## Bodyweight volume

### One number, three consumers

`WorkoutSessionRecord` gains `resolvedBodyweightKg?: number`, populated in the repository's mapping
path from `resolveBodyweightForSession(entries, session.completedAt ?? session.startedAt)`. Every
formula then applies the identical expression:

```ts
const effectiveKg = (set.weightKg ?? 0) > 0 ? set.weightKg! : (session.resolvedBodyweightKg ?? 0);
total += effectiveKg * (set.actualReps ?? 0);
```

**`(weightKg ?? 0) > 0`, not `weightKg == null`,** on purpose: an explicitly-logged `0 kg` and an
unlogged weight are indistinguishable to the user, and `0 × reps = 0` is precisely the "you did
nothing" lie this change exists to end. It is also the **same predicate** `personal-records.ts:25`
already uses to separate loaded from bodyweight sets, so the two modules divide the world identically
and a reviewer comparing them sees one rule, not two.

| Site | Change |
|---|---|
| `packages/domain/src/offline/session-aggregation.ts:11-24` `computeSessionVolume` | Reads `session.resolvedBodyweightKg`. **No signature change** — it already takes the whole `WorkoutSessionRecord`, so every existing caller is untouched and absent ⇒ today's arithmetic exactly |
| `apps/api/.../workout-session.ts:1355-1358` (muscle-group bucket) | Same expression, using the session's resolved value |
| `apps/web/.../tracker-model.ts:116-121` `exerciseVolume` | Gains a second parameter `resolvedBodyweightKg?: number`, threaded from the session by `deriveTrackerModel`. Optional ⇒ existing tests and callers compile unchanged |

Because the value rides on a record the clients already fetch, the live tracker, the API stats and the
domain share one resolution decided in one place. No client re-derives it and no client can disagree.

### Blast radius, corrected

Every surface fed by `computeSessionVolume` moves once a user records a weight: the Stats volume KPI
and `volumeTrend`, `muscleGroupDistribution[].volumeKg`, the weekly rollup (`:1161`), the progress
route's `recentSessions[].volumeKg` (`:1063`), history trend deltas via `computeVolumeTrend`, and the
web tracker's live readout. All are the same class of number and all are covered by the one threading
above. One small mercy, verified: the web distribution chart renders `setCount`, not `volumeKg`
(`stats/page.tsx:127`), so that bucket's shift is invisible today.

Confirmed unaffected: the #353 retention funnel, whose steps are activity-based
(`admin/stats/stats-constants.ts:39-48`).

### Why PRs cannot move

Not a convention — a missing channel. `computePersonalRecords` takes
`readonly PersonalRecordSetInput[]`, and that interface (`personal-records.ts:10-16`) has **no**
bodyweight member. This design does not add one. Its call site builds each input from the raw set row
(`workout-session.ts:1367-1372`, `weightKg: toOptionalNumber(set.weightKg)`) and keeps doing so. There
is therefore no path by which a resolved bodyweight can reach Epley: to break this, someone would have
to add a field to `PersonalRecordSetInput` **and** change its construction **and** change
`isEligible` — three deliberate edits, not one accidental one.

`openspec/specs/09c-v1-progress-dashboard-stats/spec.md:73` ("Bodyweight and no-weight sets are
excluded from 1RM PRs") therefore stands unchanged, and PR 4 ships a regression test that pins
`prCount` and `personalRecords` across a bodyweight-only fixture with and without a weight reading.

## Volume-shift communication (C2)

Scoped to first weight entry only, per the resolved question round.

`POST /weight-entries` returns `wasFirstEntry: true`; the web weight-entry form renders an inline
`role="status"` panel — polite, not an alert, because the user did something successful — naming
cause and consequence:

> **Your past totals have changed.** Bodyweight sets now count toward your training volume, so figures
> from before today are not directly comparable.

It is dismissible and not persisted: the trigger is a once-per-account server fact, so it cannot
re-appear. New i18n keys under `profile.weight.*` in `packages/i18n/src/messages/{en,es}.json`, both
locales, neutral professional Spanish.

**The accepted consequence, recorded rather than glossed:** a user who returns to Stats weeks later
has no in-product explanation for why their older numbers no longer match what they remember. The
product owner narrowed C2 to this deliberately.

## Mobile profile screen (A3, greenfield)

Zero matches for `UserProfile`/`experienceLevel` in `apps/mobile/src` (verified in exploration). New
files, following the conventions the repo already uses — per-screen `messages.ts` with `react-intl`
(`screens/tracker/messages.ts`, `screens/plan/messages.ts`, `screens/clients/messages.ts`), a sibling
`.styles.ts`, and a thin `src/api/*-client.ts`:

| File | Contents |
|---|---|
| `apps/mobile/src/screens/profile/ProfileScreen.tsx` | Name, goal, experience level, self-described sex, height; plus a weight-entry field and a reverse-chronological list |
| `apps/mobile/src/screens/profile/ProfileScreen.styles.ts` | Styles, `theme/tokens.ts` |
| `apps/mobile/src/screens/profile/messages.ts` | `defineMessages` for this screen only — mobile does **not** read the shared `next-intl` catalogs |
| `apps/mobile/src/api/user-profile-client.ts` | `fetchUserProfile` / `updateUserProfile` |
| `apps/mobile/src/api/weight-entry-client.ts` | `fetchWeightEntries` / `createWeightEntry` |

Mobile renders the same first-entry notice from the same `wasFirstEntry` flag. It is deliberately last
in the chain and depends on nothing in PR 3 or PR 4.

## The observability discipline requirement

`ObservabilityMetadata` (`event-logger.ts:19-27`) is
`Record<string, string | number | boolean | null | undefined>`, so nested objects cannot compile but a
scalar `weightKg` compiles fine. And — verified above — the Langfuse `mask` hook covers `input` and
`output` **only**, never `metadata`, so a body value on trace metadata bypasses the entire redaction
capability. This is the sharpest edge in the change and it deserves better than "spec and review must".

Two mechanisms, honestly graded:

**1. Close the trace metadata by type (structural — this one is a real guarantee).** The two trace
metadata objects are inline literals today (`adapter-factory.ts:95-109`,
`extraction-adapter.ts:251-263`). Give each an exported closed type and annotate the literal:

```ts
// apps/api/src/ai/trace-metadata.ts — NEW
/**
 * The COMPLETE set of keys permitted on a Langfuse trace's `metadata`.
 *
 * Closed on purpose: the SDK's `mask` hook covers `input`/`output` only, so
 * metadata is the one payload no redaction rule can rescue. Adding a key here
 * is a deliberate act with a reviewer attached; adding one at a call site is a
 * compile error.
 */
export interface PlanTraceMetadata {
  feature: "plan-generation" | "plan-chat-extraction";
  provider: string;
  model: string;
  promptSource: "langfuse" | "fallback";
  promptLinked: boolean;
  promptName?: string;
  promptVersion?: number;
  promptLabel?: "production";
  langfusePrompt?: { name?: string; version?: number; isFallback: boolean };
}
```

An excess-property check then rejects `weightKg` at the call site. This turns the discipline
requirement into a build failure for the channel that matters most.

**2. Close `logEvent` metadata by guard test (a lint, and I will not oversell it).** A flat scalar bag
cannot be narrowed generically without retyping every caller, which is far out of scope here. What is
proportionate is a source-text guard in the family this repo already accepts for silent-failure
classes (`migration-journal.test.ts`): a test that scans `apps/api/src/**/*.ts` and fails if any
`metadata:` object literal contains a key matching `/^(weightKg|heightCm|selfDescribedSex|bodyweight)/i`
outside `trace-redaction.ts` and its tests.

It is a lint, not a type. It catches the plausible mistake — someone adding
`metadata: { weightKg }` to an existing `logEvent` call while wiring the weight route — and it will
not catch a determined rename. Stating the limit plainly is part of the design; claiming a guarantee
here would be worse than the gap.

## Interfaces / Contracts

```ts
// packages/contracts/src/index.ts

/** Self-described sex/gender (17c). One field, one consumer: plan generation. */
export type SelfDescribedSex = "female" | "male" | "non_binary" | "other" | "prefer_not_to_say";

export interface UserProfile {
  userId: string;
  name: string;
  goal: PlanGoal | null;
  experienceLevel: ExperienceLevel | null;
  /** 17c. `null` = never asked; `"prefer_not_to_say"` = asked and declined. */
  selfDescribedSex: SelfDescribedSex | null;
  /** 17c. Centimetres, SI only (decision 1). */
  heightCm: number | null;
}

/** One dated bodyweight reading (17c A2). */
export interface WeightEntryDTO {
  id: string;
  weightKg: number;
  /** ISO-8601 instant. */
  recordedAt: string;
}

/** 201 body of POST /weight-entries. */
export interface CreateWeightEntryResponse {
  entry: WeightEntryDTO;
  /** True only for the user's first-ever reading — drives the volume-shift notice (C2). */
  wasFirstEntry: boolean;
}

export interface WorkoutSessionRecord {
  // …existing fields unchanged…
  /**
   * 17c: the bodyweight that applies to THIS session, resolved server-side by
   * `resolveBodyweightForSession`. Absent when the user has no readings — in
   * which case every volume formula degrades to `(weightKg ?? 0) * reps`.
   */
  resolvedBodyweightKg?: number;
}
```

`SelfDescribedSex` is a `type`, and every new interface is type-only, so `contracts.test.ts:61-72`
(which asserts `Object.keys(contracts)`, i.e. **runtime** exports) is unaffected. `SELF_DESCRIBED_SEX`
is deliberately **not** exported as a runtime `as const` array — that would break the export-order
tests for no gain, since the route already declares its own `VALID_*` constant beside `VALID_GOALS`.

```ts
// apps/api/src/ai/prompt.ts

/** Body metrics as prompt input. Never persisted here, never an output schema field. */
export interface BodyProfilePromptInput {
  selfDescribedSex?: Exclude<SelfDescribedSex, "prefer_not_to_say">;
  heightCm?: number;
  bodyweightKg?: number;
}

type PlanPromptInput = PlanSpec & {
  memoryContext?: string[];
  allowedExercises?: string[];
  /** 17c. Absent ⇒ `bodyProfileSection` renders "" ⇒ byte-identical prompt. */
  bodyProfile?: BodyProfilePromptInput;
};
```

`Exclude<…, "prefer_not_to_say">` is small and load-bearing: the declined value **cannot be
represented** in the prompt input type, so the mapping layer must drop it and no branch downstream has
to remember to.

## File changes

| File | Action | PR |
|---|---|---|
| `apps/api/src/db/schema.ts` | Modify — `selfDescribedSexEnum`; `selfDescribedSex`/`heightCm` on `userProfiles`; new `userWeightEntries` | 1, 2 |
| `apps/api/drizzle/0027_user_profile_body_metrics.sql` + journal `idx: 27` | Create | 1 |
| `apps/api/drizzle/0028_user_weight_entries.sql` + journal `idx: 28` | Create | 2 |
| `apps/api/src/db/__tests__/migration-journal.test.ts` | Modify — one pinning assertion per migration | 1, 2 |
| `packages/contracts/src/index.ts` | Modify — `SelfDescribedSex`, `UserProfile` fields, `WeightEntryDTO`, `CreateWeightEntryResponse`, `resolvedBodyweightKg` | 1, 2, 4 |
| `apps/api/src/routes/user-profile.ts` | Modify — `VALID_SELF_DESCRIBED_SEX`, height bounds, port + row + DTO + partial merge | 1 |
| `apps/api/src/db/repositories/user-profile.ts` | Modify — two columns through read/create/upsert | 1 |
| `apps/api/src/routes/user-weight-entry.ts` | Create — `GET`/`POST /weight-entries` | 2 |
| `apps/api/src/db/repositories/user-weight-entry.ts` | Create — list, insert + `wasFirstEntry`, `listAllForUser` | 2 |
| `apps/api/src/app.ts` | Modify — register the weight routes; pass `mask: redactTracedPayload` | 2, 3 |
| `apps/api/src/ai/trace-redaction.ts` | Create — `TRACE_REDACTION_RULES`, `redactSpans`, `redactTracedPayload` | 3 |
| `apps/api/src/ai/trace-metadata.ts` | Create — `PlanTraceMetadata` | 3 |
| `apps/api/src/ai/langfuse-handler.ts` | Modify — `mask` option | 3 |
| `apps/api/src/ai/prompt.ts` | Modify — `bodyProfile`, `bodyProfileSection`, template marker, definition variable | 3 |
| `apps/api/src/ai/adapter-factory.ts` | Modify — annotate `traceMetadata`; fail-closed backstop before `.invoke` | 3 |
| `apps/api/src/ai/extraction-adapter.ts` | Modify — annotate `metadata` only | 3 |
| `apps/api/src/ai/generation-service.ts` | Modify — `attachBodyProfile` beside `allowedExercises` (`:224-227`) | 3 |
| `packages/domain/src/progress/bodyweight-resolution.ts` | Create — `resolveBodyweightForSession` | 4 |
| `packages/domain/src/offline/session-aggregation.ts` | Modify — `computeSessionVolume` reads `resolvedBodyweightKg` | 4 |
| `packages/domain/src/index.ts` | Modify — export the resolution function | 4 |
| `apps/api/src/db/repositories/workout-session.ts` | Modify — batch weight read, resolve at mapping, muscle-group bucket expression | 4 |
| `apps/web/src/app/(app)/plan/[id]/tracker/tracker-model.ts` | Modify — `exerciseVolume` second parameter | 4 |
| `apps/web/src/app/(app)/profile/{profile-form-client.ts,actions.ts,ProfileForm.tsx,options.ts}` | Modify — two scalars; weight form + list; first-entry notice | 1, 2, 4 |
| `packages/i18n/src/messages/{en,es}.json` | Modify — `profile.form.selfDescribedSex.*`, `profile.form.heightCm`, `profile.weight.*` | 1, 2, 4 |
| `.github/workflows/ci-cd.yml` | Modify — add the new integration suite to the hardcoded file list (see below) | 2 |
| `apps/mobile/src/screens/profile/*`, `apps/mobile/src/api/{user-profile,weight-entry}-client.ts` | Create | 5 |

**i18n rebuild gotcha:** apps resolve `@kinora/i18n` through built `dist/`. Editing the catalogs
without rebuilding silently serves stale messages. `pnpm build` (or root `pnpm dev`, which prebuilds
packages) before any manual verification.

## Testing strategy

Strict TDD: the failing test lands before the behaviour, in the same commit. Vitest 3.2.4;
`pnpm -r test`; coverage `pnpm -r --if-present test:coverage` with apps/api functions ≥85% and
apps/web ≥90%, enforced by `.githooks/pre-push`.

### The CI caveat, checked rather than assumed

Issue #382: nine `apps/api` integration suites never execute, because the real-Postgres CI job runs a
**hardcoded file list** (`.github/workflows/ci-cd.yml:113-131`). I opened it. The list is exactly
eight files: `billing-quota`, `billing-admin`, `billing-visibility`, `stripe-schema`,
`stripe-webhook`, `billing-customer`, `user-account-deletion`, `admin-stats` — all
`src/db/repositories/__tests__/*.integration.test.ts`.

**A new `user-weight-entry.integration.test.ts` would not be on that list and would therefore never
run in CI.** Two consequences, both acted on:

1. **The load-bearing logic is pure.** `resolveBodyweightForSession` is a domain function with no I/O,
   so the resolution rule — the part that decides whether history is stable — is proved by the unit
   suite that runs on every push. This is the main reason it is a domain function and not SQL.
2. **PR 2 adds its integration file to that list**, in the same commit as the file. One line. The job
   is named for billing but already gates `admin-stats` and the #353 funnel, and its false-green guard
   (`:132-144`) covers the added file for free. Adding a suite without adding the line would be
   writing proof into a file that never runs — exactly the defect #382 describes.

| PR | Layer | What | Approach |
|---|---|---|---|
| 1 | Unit route | `selfDescribedSex` three-way merge (undefined preserves / null unsets / value stored); `422` on a bad enum member; `heightCm` bounds; `prefer_not_to_say` persists and reads back | Fastify `app.inject` harness |
| 1 | Unit contracts | `contracts.test.ts:61-72` runtime export list **unchanged** — proves the additions are type-only | existing |
| 1 | Guard | `migration-journal.test.ts` — `0027` present at `idx: 27` | existing guard, one assertion |
| 1 | Component web | Form renders all five options, round-trips a selection, and renders `prefer_not_to_say` as a chosen value rather than an empty control | RTL + jsdom |
| 2 | Unit route | `POST` validation matrix (`0`, negative, `>500`, non-numeric, future `recordedAt`); `wasFirstEntry` true then false | `app.inject` |
| 2 | Integration `user-weight-entry.integration.test.ts` **(added to the CI list in the same PR)** | Two readings coexist (no unique index); `GET` returns newest-first; deleting the user cascades every row away; `wasFirstEntry` is false for a second entry inserted concurrently | Real Postgres |
| 2 | Guard | `migration-journal.test.ts` — `0028` at `idx: 28` | existing guard |
| 3 | Unit `trace-redaction.test.ts` | `redactSpans` empties one span and leaves the rest byte-identical; nested/repeated spans; an unterminated open marker redacts to end-of-string (**fail-closed, asserted explicitly**); `redactTracedPayload` walks strings/arrays/objects; a non-string payload passes through | Pure |
| 3 | Unit `prompt.test.ts` | **Byte-identity:** with `bodyProfile` absent, `buildPlanPrompt(spec)` equals the pre-change output — extend the existing snapshot block (`:279`). Also: absent with an empty object; each field independently present; `prefer_not_to_say` emits no line; the section sits between the profile and `{{limitationsSection}}` | Mirrors `:227-266` |
| 3 | Unit `adapter-factory.test.ts` | **The proof that matters:** with body values present, capture the payload the handler observes at the `.invoke()` boundary and assert **no body value survives** into trace input, while the string handed to the chain still **contains** them. Both halves — asserting only the first would pass for a change that broke generation | Existing masking-payload harness |
| 3 | Unit backstop | With a deliberately marker-less section, the prompt degrades to the no-body rendering and emits the reason code; **no value appears in the log payload** | Injected renderer |
| 3 | Type | `PlanTraceMetadata` rejects an excess `weightKg` key | `expectTypeOf` |
| 3 | Guard | Source scan: no `metadata:` literal in `apps/api/src` carries a body-metric key | `migration-journal.test.ts`-style |
| 4 | Unit `bodyweight-resolution.test.ts` | The full table above: empty → `undefined`; at-or-before nearest; session predating all readings → earliest; exact-instant inclusivity; **a later weigh-in does not change an already-resolved older session** | Pure |
| 4 | Unit `session-aggregation.test.ts` | Bodyweight-only session → `0` with no resolved weight, non-zero with one; a loaded set is unaffected; a `0 kg` logged set takes the bodyweight; incomplete sets still excluded | Pure |
| 4 | Unit `personal-records.test.ts` | **Regression:** `computePersonalRecords` output is identical across a fixture with and without a resolved bodyweight; `prCount` unchanged; the `weightKg > 0` eligibility rule pinned | Pure |
| 4 | Unit web tracker | `exerciseVolume` with and without the second parameter; the no-parameter call is byte-identical to today | Pure |
| 4 | Component web | The first-entry notice renders on `wasFirstEntry: true`, is `role="status"`, does not steal focus, and does **not** render on a second entry | RTL |
| 5 | Component mobile | Profile screen renders and round-trips every field; weight entry posts and the list shows newest-first; the notice renders once | RN testing library |

Coverage headroom is thin on apps/api (85% functions). PRs 3 and 4 add several small pure functions
with dense unit tests, which helps rather than hurts; PR 2's route/repo pair is the one to watch, and
its tests ship in the same commit as the behaviour.

## PR boundary and re-forecast

The proposal's five-PR chain survives validation against the mechanism above — the seams fall where it
put them. One observation and one correction:

- **The seams hold.** PR 3 is a coherent unit under the corrected mechanism: the redaction module, the
  handler wiring, the prompt section and the backstop all ship together, which is what the rollback
  plan requires ("do not revert the redaction extension independently"). The corrected mechanism does
  **not** move work into another PR.
- **One correction to the ordering rationale.** The proposal says "2 before 3 — scope B cannot render a
  bodyweight it cannot read." True, but PR 3 also needs PR 1's `selfDescribedSex`/`heightCm`, so it
  depends on **both** predecessors, not just PR 2. The order is unchanged; the reason is broader.

Re-forecast from the **reduced** scope — C3 gone, one fewer profile field — rather than the proposal's
numbers, as instructed. Non-test lines are what the 800-line budget measures.

| PR | Content | Non-test | Test |
|---|---|---|---|
| 1 | A1 — `selfDescribedSex` + `heightCm` through seven layers, migration `0027` | ~130–190 | ~130–190 |
| 2 | A2 — `user_weight_entries`, migration `0028`, route + repo, web form + list, CI list line | ~180–250 | ~170–240 |
| 3 | B — trace-redaction module + handler wiring + metadata types + prompt section + backstop | ~150–220 | ~180–280 |
| 4 | C — resolution function, volume threading (3 sites), `resolvedBodyweightKg`, first-entry notice | ~130–200 | ~180–260 |
| 5 | A3 — mobile profile screen (greenfield) | ~180–250 | ~120–180 |
| | **Total** | **~770–1110** | **~780–1150** |

**PR 3 is larger than the proposal's ~120–200, deliberately.** The proposal sized it as a `mask()`
tweak; the corrected mechanism is a new module, a new metadata type, a handler option and a
fail-closed backstop. I am not going to under-report that to preserve a number. Every PR still sits
comfortably inside the 800-line non-test budget, and the total is modestly below the proposal's
~780–1180 exactly as the resolved question round predicted.

## Migration / rollout

Deploy order is PR order. Both migrations are additive — two nullable columns plus one new table — so
each can be deployed before the code that reads it, and old code ignores what it never selects.

Rollback follows the proposal, with one mechanism-specific note:

- **PR 3.** Reverting the prompt-variable additions restores today's prompt. **Do not revert the
  redaction wiring independently** — a reverted prompt with intact redaction is inert (no span is
  rendered, so `redactSpans` is a no-op); the inverse is a leak. Under the corrected mechanism this is
  even safer than the proposal assumed: the `mask` option is a pure function applied to trace payloads
  only, so leaving it in place has no effect on generation whatsoever.
- **PR 4.** Revert the threading and volume returns to weight-only. Nothing is stored, so nothing is
  corrupted — the numbers move back. The notice reverts with it.
- **PR 2.** The table can be dropped; rows are user-entered and re-enterable. If PR 4 has shipped,
  dropping it returns bodyweight volume to zero — coordinate the revert order.
- **PR 1.** Nullable columns are additive and forward-safe. Revert the UI and the columns stay null,
  exactly like an unfilled profile today. The enum type is forward-only, like `billing_tier`'s `'gym'`.

## Open questions

- [ ] **#374 could not be re-read directly this phase** — no shell tool was available, so
      `gh issue view 374` did not run. Its content was reconstructed from the archived 16e artifacts
      that filed it (`proposal.md:210-219`, `apply-progress.md:880-882`), which record the defect and
      both recorded options. Apply must open the live issue and confirm it has not been re-scoped
      before implementing PR 3; the composition table is what needs re-checking, not the mechanism.
- [ ] The `mask` option's interaction with slice C's prompt-version linkage was not exercised.
      `registerLangfusePrompt` operates on run parenting, not on `input`/`output` bytes, so they should
      be orthogonal — but PR 3 should assert `promptLinked` stays `true` with the mask attached rather
      than assume it.
- [ ] `mapWorkoutSessionRecord`'s full call-site list was not enumerated this phase. PR 4 must confirm
      every path that produces a `WorkoutSessionRecord` for a **volume** consumer receives the resolved
      weight; a path that misses it degrades to today's numbers (safe, but inconsistent between two
      screens, which is its own defect).
- [ ] The offline mobile snapshot writer stores `WorkoutSessionRecord`s locally. A snapshot taken
      before PR 4 has no `resolvedBodyweightKg`, so it degrades correctly — but apply should confirm
      no snapshot schema version assertion rejects the added optional field.
