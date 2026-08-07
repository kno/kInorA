# Proposal: 17c-profile-body-metrics (the app must know the body it is training)

GitHub [kno/kInorA#361](https://github.com/kno/kInorA/issues/361). Real implementation. Builds on
`openspec/changes/17c-profile-body-metrics/exploration.md` — do not re-derive its evidence.

Roadmap relation: extends `10a-v1-user-memory-structured` ("editable structured memory: profile,
preferences, and training data") with physiological attributes, and feeds
`08-v1-ai-plan-generation` and `09c-v1-progress-dashboard-stats`.

Four product forks were decided by the product owner on 2026-08-07 and are pinned below as
constraints, not options: **volume shift accepted**, **sex and gender are two fields**,
**SI units only**, **scope A+B+C chained**.

## Intent

The app generates training plans and computes training volume for a person whose body it knows
nothing about. `user_profiles` holds `name`, `goal` and `experienceLevel` and stops there
(`apps/api/src/db/schema.ts:950-969`). The only `weightKg` in the schema is the load on the bar
(`:766`), never the person on the floor.

Two concrete consequences, both verified:

1. **Generation guesses.** `PLAN_PROMPT_TEMPLATE` (`apps/api/src/ai/prompt.ts:47-77`) carries no
   physiological signal, so load prescriptions and exercise selection cannot account for who is
   lifting.
2. **Bodyweight work counts as zero.** `exerciseVolume` (`tracker-model.ts:116-121`) is
   `(weightKg ?? 0) * (actualReps ?? 0)`. A full push-up session reports **0 kg of volume**. The
   user did the work; the app says they did nothing.

Success: a user can record sex, gender, height and a dated bodyweight series; generation uses them
without leaking them to a third party; bodyweight sets stop reporting zero; and the user is *told*
when their historical numbers move because of it.

### Correction to the issue's framing (verified, carried from exploration)

The issue says the capture point is "the wizard" (`apps/web/src/components/wizard/`). That wizard
captures `PlanSpec` for one generation run. Sex, gender, height and weight are **durable profile
attributes**, so they belong on `apps/web/src/app/(app)/profile/`, following the
`goal` / `experienceLevel` pattern across seven layers. This is a different screen and a different
lifecycle from the one the issue names.

### Second correction — the PR table does **not** change (verified this pass)

The orchestrator brief carried forward that both the Stats volume KPI **and the PR table** shift.
Only the first is true. `computePersonalRecords`
(`packages/domain/src/progress/personal-records.ts:24-26, 43-52`) gates on `set.weightKg > 0` and
computes Epley from that load alone — it never reads a volume figure. Spec
`09c-v1-progress-dashboard-stats` states the rule explicitly: *"Bodyweight and no-weight sets are
excluded from 1RM PRs"*. **That requirement stands unchanged** (pinned decision 6).

## Scope

### In Scope

- **A1. Web profile scalars.** **One** nullable self-described enum (superseding the earlier
  two-field split — see the resolved question round) and `heightCm` on `user_profiles`, through all
  seven layers: schema, contracts, `GET`/`PUT /user-profile`, Drizzle repo,
  `profile-form-client.ts`, `actions.ts`, `ProfileForm.tsx` + `packages/i18n`.
- **A2. Bodyweight series.** New `user_weight_entries` table (`userId` → `users.id`
  `ON DELETE CASCADE`, `weightKg numeric`, `recordedAt`, `createdAt`, **no unique index on
  `userId`**), new route and repo, plus a web entry form and a read-only reverse-chronological list.
- **A3. Mobile profile screen.** Greenfield: new screen, new API client, new per-screen
  `react-intl` `messages.ts`. Covers the A1 scalars and A2 weight entry.
- **B. Feed generation.** Body metrics rendered into the plan prompt string, **plus the redaction
  extension that stops them reaching Langfuse** (pinned decision 3). Applies to both the wizard
  generation path and the chat create-plan extraction path.
- **C1. Bodyweight volume.** `exerciseVolume` and the API-side stats aggregation add the resolved
  bodyweight to weightless sets, under the resolution rule in pinned decision 5.
- **C2. Volume-shift communication.** An explicit, user-visible explanation that historical volume
  moved and why (pinned decision 4). Not an afterthought — a shipped requirement. **Scoped to the
  point of first weight entry only** — see the resolved question round.

### Out of Scope

- **Any change to `WorkoutExerciseSchema`, `WorkoutSessionSchema` or `WorkoutProgramSchema`**
  (`packages/contracts/src/workout-program.schema.ts`). See pinned decision 2.
- **Personal records and `prCount`.** Unchanged by construction — see the second correction above.
- **The #353 retention funnel.** Its steps are activity-based, not volume-based
  (`admin/stats/stats-constants.ts:39-48`). Verified unaffected.
- **Unit choice (kg/lb, cm/ft-in).** SI only, pinned decision 1.
- **Mobile gendered imagery.** No mobile media-selection point was located during exploration. Do
  not size or promise it; file it as follow-up if a point is found.
- **BMI, body-fat, circumference measurements, or any derived health index.**
- **A formal health-data consent flow or retention policy beyond cascade-on-user-delete.** Flagged
  as a product/legal question, not resolved here.
- **Weight-series charting.** The list is textual. `StatsSummaryDTO.volumeTrend` is two undated
  aligned arrays and is not reusable for a dated series.

## Capabilities

### New Capabilities

- `profile-body-metrics`: a user records sex, gender, height and a dated bodyweight series; the
  system uses them for generation, volume and imagery without exposing them to third parties.

### Modified Capabilities

- `10a-v1-user-memory-structured`: the structured profile gains four physiological attributes.
- `08-v1-ai-plan-generation`: the generation prompt carries body metrics, and trace redaction is
  widened to cover them.
- `09c-v1-progress-dashboard-stats`: volume (KPI, trend, muscle-group distribution) counts
  bodyweight sets; the estimated-1RM PR requirement is explicitly **unchanged**.

## Approach & Pinned Decisions

**1. SI only, no unit field.** `set_records.weightKg` has never asked and there is no unit
preference anywhere in the schema. Adding one here would make this the app's first user-facing unit
choice and would require a stored preference, conversion at the edge and a locale default. Rejected
by the product owner. Accepted consequence, stated plainly: non-metric users convert mentally.

**2. Body data is prompt input, never output schema.** `WorkoutProgramSchema` feeds
`.withStructuredOutput` at `adapter-factory.ts:139, 159, 179, 199, 228` — every provider adapter.
A per-user scalar has no home in a per-exercise output shape, and #357 is the cautionary tale.
Body data enters as rendered prompt text and nothing else.

**3. Close the Langfuse channel by extending the redaction step — before this change can ship
scope B.** Verified: `mask()` (`apps/api/src/ai/mask.ts:17-29`) redacts **only** the literal
`limitations[].text` terms handed to it; `invokeChain` (`adapter-factory.ts:66+`) calls
`mask(rawPrompt, limitationTerms)` then `.invoke(maskedPrompt, { callbacks: [handler] })`, where
`handler` is the Langfuse `CallbackHandler` (`langfuse-handler.ts:53-79`), configured in production
since the `16e` series. **The masked prompt is the trace input.** Nothing leaks today only because
the prompt carries no body data; scope B changes exactly that.

*Chosen mechanism: extend the existing redaction step to cover body-metric values before
`invoke()`* (exploration §6 option a). Rationale: it mirrors the pattern already in place, keeps
one redaction seam rather than two, and requires no change to trace coverage. The alternatives were
weaker — deriving a server-side fragment (option b) hides the values from traces but also from
debuggability and still leaves the seam un-generalized; excluding `plan-generation` traces
entirely (option c) discards the observability `16e` was built for.

**Relationship to #374: alongside, not fixing and not blocked by.** #374 is about limitation text
surviving on first mention; this is a different data class the issue never names. 17c does not
close #374 and does not wait for it. Because both fixes land on the same seam, `sdd-design` MUST
re-read #374 before choosing the exact hook so the two do not collide. The extension must be
written as a general value-redaction capability, not a body-metrics special case.

**Discipline requirement, not a type guarantee:** `ObservabilityMetadata`
(`event-logger.ts:19-27`) is a flat scalar bag, so nested objects cannot compile — but a scalar
`weightKg` passed as metadata compiles fine. No type stops it. Spec and review must.

**4. The volume shift is accepted AND announced.** Adding bodyweight to the formula changes
already-logged bodyweight sets from zero to non-zero. There is no per-set stored volume snapshot;
stats query historical `set_records` live. So `totalVolumeKg`, `volumeTrend` and
`muscleGroupDistribution[].volumeKg` move for **past** sessions the moment a user first records
their weight. Snapshot-at-set-time and separate-metric were both offered and rejected.

**This must not happen silently.** #367's governing lesson is that nothing changes under the user
without telling them. Pinned: the first bodyweight entry MUST produce a user-visible explanation
naming the cause and the consequence ("bodyweight sets now count toward your volume; totals before
today are not comparable"), and the Stats volume surface MUST carry a persistent explanation of
what volume now includes. Exact surface and dismissal semantics are `sdd-design`'s; the requirement
to communicate is not negotiable.

**5. Weight resolution rule: nearest reading at or before the session, falling back to the earliest
reading.** Exploration surfaced this gap; the issue does not resolve it. The rule must satisfy two
constraints that pull against each other — decision 4 accepts that sessions predating any reading
gain volume, so exact-date-only and strict at-or-before both fail; but future weigh-ins must not
keep rewriting settled history.

| Candidate rule | Verdict |
|---|---|
| Exact-date-only | Rejected — almost every session has no same-day reading; volume stays ~zero |
| Most recent reading, regardless of date | Rejected — every new weigh-in rewrites the entire history |
| **Nearest at-or-before, earliest as backstop** | **Chosen** — one-time shift on first entry, then each new reading only affects sessions after the previous reading |

**6. Personal records stay weight-logged-only.** `isEligible`
(`personal-records.ts:24-26`) requires `weightKg > 0`; Epley over an inferred bodyweight would
invent 1RMs for push-ups. Spec `09c` states the exclusion as a requirement. Not touched.

**7. Absent values degrade to today's behaviour byte-for-byte.** When sex, gender, height or
weight is absent, the rendered prompt MUST be byte-identical to what it renders today, and volume
MUST fall back to `(weightKg ?? 0) * reps`. No default 75 kg, no inferred average. An invented
number is worse than no number because the generator would trust it. This is a testable
requirement, not a guideline.

**8. "Prefer not to say" is a positive value, not null.** `experienceLevel` already uses null for
"never chosen". If the field reuses null for a decline, the product cannot distinguish *asked and
declined* from *never asked* — and will keep re-prompting someone who already said no. **Position:
an explicit `prefer_not_to_say` enum member, distinct from null.** Both are treated as absent by
decision 7's degradation rule; they differ only in whether the product may ask again.

> **RESOLVED, and now applies to one field rather than two** — see decision 9.

**9. ~~Sex and gender are separate fields~~ — SUPERSEDED by the product owner, and correctly so.**

> The original position was two fields with two consumers: sex for the physiological load
> heuristics in scope B, gender for the imagery rule in scope C.
>
> **Decision 10 dropped the imagery rule, which removed gender's only consumer.** Capturing a
> sensitive personal attribute with no declarable purpose is a data-minimisation failure, and a
> conspicuous one in a change that spends decision 3 on stopping these same values reaching a
> third-party vendor.
>
> **Resolution: ONE nullable self-described field, feeding generation.** This is now *more*
> coherent than the split, not a regression. The argument for separating them was that they served
> two different consumers; with one consumer there is no conflation left to avoid. The field is
> asked once, for a stated purpose, and used for that purpose.

**10. Gendered-imagery suppression is OUT OF SCOPE — dropped by the product owner.**

> The catalog has no `gender` field; the signal is a substring match on record names, reportedly
> 29 `(male)` + 4 `(female)` of 1,324, and the rule can only fire when an ungendered equivalent
> exists for the same movement — which the data does not guarantee. Roughly 2.5% of records, with
> no guaranteed substitute, is too thin a return to build and maintain.
>
> **Consequences:** C3 leaves scope entirely; the 29/4 spot-check `sdd-design` was told to run is
> no longer needed; PR 4 shrinks. If this ever matters, it starts as its own issue with a real
> count derived first, not assumed.

### Changed-line forecast and PR chain

`review_budget_lines: 800`, measured on **non-test** lines (corrected after 17b, where all three
PRs overran purely through test mass).

| PR | Content | Non-test | Test |
|---|---|---|---|
| 1 | A1 — web profile scalars (sex, gender, heightCm) through seven layers | ~150–220 | ~150–220 |
| 2 | A2 — `user_weight_entries` table, route, repo, web entry form + list | ~180–260 | ~180–250 |
| 3 | B — prompt rendering + redaction extension (both generation paths) | ~120–200 | ~150–250 |
| 4 | C — bodyweight volume, resolution rule, shift communication, imagery | ~150–250 | ~200–300 |
| 5 | A3 — mobile profile screen (greenfield) | ~180–250 | ~120–180 |
| | **Total** | **~780–1180** | **~800–1200** |

**Honest budget signal (`delivery_strategy: ask-on-risk`): each PR sits comfortably under the
800-line non-test budget, but the change as a whole is 1.0–1.5× the budget. Chaining is mandatory,
not a convenience.** I am not splitting silently to dodge the number — the split is on its merits
and the total is stated for the product owner to accept or trim.

**Boundary rationale:**

- **1 before 2** — the scalars establish the profile write path that the weight route reuses; the
  series is a different shape (1:many, new table) and does not belong in the same review.
- **2 before 3** — scope B cannot render a bodyweight it cannot read.
- **3 before 4** — independent in principle, but B carries the redaction fix, which is the highest
  privacy risk in the change and should not queue behind stats work.
- **5 last, deliberately.** Mobile is greenfield and depends on nothing in 3 or 4; putting it last
  lets the entire data → generation → stats value chain land first. It is also the slice most
  likely to be deferred if the total is trimmed, and it is cleanly droppable from the tail.

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Body metrics reach Langfuse via the traced prompt | **High if unaddressed** | Decision 3; the redaction extension ships in the same PR as the prompt change, with a test asserting no body value survives into trace input |
| Users see their historical volume move with no explanation | **High if unaddressed** | Decision 4 makes communication a shipped requirement, not documentation |
| A default bodyweight is invented for absent values | Med | Decision 7; byte-identical-prompt and fallback-formula tests |
| API-side volume computation diverges from `tracker-model.ts` | **Med — unverified** | Exploration did not read the API aggregation. `sdd-design` MUST read it and confirm one shared rule, not two |
| The 29/4 gendered-record count is wrong | Med | Decision 10; re-derive before sizing C3. If the real count is near zero, C3 should be dropped rather than built |
| Mobile profile greenfield overruns PR 5 | Med | It is last in the chain and cleanly droppable; split scalars from weight entry if it grows |
| Health-data classification is informal | Med | Flagged for product/legal; this change treats body metrics at least as strictly as limitations |
| Coverage gate blocks the chain (apps/api functions 85%, apps/web 90%) | Med | Tests ship in the same commit as each behaviour change |
| Contracts export-order tests break | Low | Known and mechanical (`contracts.test.ts`) |
| Drizzle journal entry omitted for the two migrations | Med | Hand-verify the journal `idx`; a missing entry makes `migrate` silently skip on deploy. This has bitten this repo |

## Rollback Plan

- **PR 5 (mobile):** self-contained new screen; revert in isolation.
- **PR 4 (volume + imagery):** revert the formula change and volume returns to weight-only. Nothing
  is stored, so nothing is corrupted — the numbers simply move back. The communication surface
  reverts with it.
- **PR 3 (generation):** revert the prompt-variable additions and the prompt renders as it does
  today. **Do not revert the redaction extension independently** — a reverted prompt with intact
  redaction is harmless; the inverse is a leak.
- **PR 2 (weight series):** the table can be dropped; rows are user-entered and re-enterable. If
  PR 4 has shipped, dropping it returns bodyweight volume to zero — coordinate the revert order.
- **PR 1 (scalars):** nullable columns are additive and forward-safe. Revert the UI and the columns
  simply stay null, exactly like an unfilled profile today.

## Success Criteria

- [ ] A user records sex, gender, height and a bodyweight reading from the web profile page, and
      re-loads them intact.
- [ ] A second bodyweight reading is stored alongside the first, not replacing it; the list shows
      both, newest first.
- [ ] Deleting a user cascades away every `user_weight_entries` row.
- [ ] With every body field absent, the rendered generation prompt is **byte-identical** to the
      pre-change prompt; a test asserts this directly.
- [ ] With body fields present, no body-metric value appears in the Langfuse trace input; a test
      asserts this at the `invoke()` boundary.
- [ ] No field is added to `WorkoutExerciseSchema`, `WorkoutSessionSchema` or
      `WorkoutProgramSchema`; no body value is passed as `ObservabilityMetadata`.
- [ ] A completed bodyweight-only session reports non-zero volume once a weight reading exists, and
      zero when none does.
- [ ] Volume for a session predating every reading resolves against the earliest reading; a later
      weigh-in does not change it.
- [ ] `prCount` and `personalRecords` are unchanged by the volume change; a test pins the
      `weightKg > 0` eligibility rule.
- [ ] On first bodyweight entry the user sees an explanation that past volume figures have changed
      and why; the Stats volume surface states what volume includes.
- [ ] A gendered exercise record is suppressed when an ungendered equivalent exists, and rendered
      unchanged when it does not.
- [ ] Mobile can record and read back the same profile fields as web.
- [ ] `pnpm type-check`, `pnpm -r test`, `pnpm -r --if-present test:coverage` and `pnpm build` are
      green; both Drizzle journal entries are present.

## Proposal question round — RESOLVED (product owner, 2026-08-07)

Four questions were raised while pinning the approach. All are now decided, and one answer
cascaded into a fifth decision.

1. **`prefer_not_to_say` as a positive value? → YES.** As assumed in decision 8. Now applies to the
   single merged field rather than two.

2. **Where does the volume-shift explanation live? → AT FIRST WEIGHT ENTRY ONLY.** This narrows the
   proposal's assumption, which was first-entry *and* a persistent note on the Stats volume
   surface. C2 shrinks accordingly. Accepted consequence, recorded deliberately: a user returning
   to Stats weeks later has no in-product explanation for why their older numbers no longer match
   what they remember.

3. **Ship gendered-imagery suppression? → NO, DROPPED.** See decision 10. C3 leaves scope; the
   29/4 spot-check is no longer required.

4. **Mobile last and droppable? → YES, and the total was accepted in full.** All five PRs proceed;
   nothing was trimmed. Mobile stays last on its merits, not as a candidate for removal.

5. **Cascading from 3 — the two-field split collapses to one.** Dropping the imagery rule removed
   `gender`'s only consumer. Rather than store a sensitive attribute with no declarable purpose,
   the fields merge into a single self-described value feeding generation. See decision 9.

### Net effect on the forecast

C3 is gone and A1 loses a field, so PRs 1 and 4 shrink. The five-PR chain and its ordering are
unchanged, and each PR remains comfortably inside the 800-line non-test budget. The revised total
is modestly below the ~780–1180 stated above; `sdd-tasks` should re-forecast from the reduced
scope rather than reusing these numbers.

## Follow-up work

- **Mobile gendered imagery** — no media-selection point was located. File once found.
- **Formal health-data classification** — consent copy and a retention story beyond
  cascade-on-user-delete. Product and legal, not this change.
- **Weight-series charting** — the list is textual here; a dated trend chart has no reusable
  precedent in the codebase.
- **#374** — limitation text on first mention. Not fixed here; decision 3's general redaction seam
  should make it cheaper.
