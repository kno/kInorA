# profile-body-metrics Specification

## Purpose

Let a user record their own physiological body metrics — a single self-described sex/gender
value, height, and a dated bodyweight series — so that plan generation can account for who is
training and completed bodyweight work counts as real training volume. These values MUST reach
generation without ever reaching a third-party observability vendor, an LLM output schema, or an
observability event, and their absence MUST leave every existing behavior byte-for-byte unchanged.

## Dependencies

- `10a-v1-user-memory-structured` (the `user_profiles` row this extends)
- `08-v1-ai-plan-generation` (the prompt this feeds)
- `09c-v1-progress-dashboard-stats` (the volume figures this shifts)

## Requirements

### Requirement: Body Descriptor and Height Storage

The system MUST persist, on the user's profile row, one nullable `sexOrGender` enum field with
values `female`, `male`, `non_binary`, `other`, `prefer_not_to_say`, and one nullable `heightCm` numeric field.
Both MUST default to null for a user who has never set them. `prefer_not_to_say` MUST be a distinct
stored enum value, never a reuse of null: null means "never asked/answered", `prefer_not_to_say`
means "asked, and the user declined". Both values MUST be treated identically as "absent" by every
downstream consumer (generation, volume) — they differ only in whether the product may prompt the
user again.

#### Scenario: Field defaults to null for an existing user

- GIVEN a user profile created before this change, or a user who has never set body fields
- WHEN their profile row is read
- THEN `sexOrGender` is null and `heightCm` is null

#### Scenario: prefer_not_to_say is stored distinctly from null

- GIVEN an authenticated user
- WHEN they set `sexOrGender` to `prefer_not_to_say`
- THEN the stored value is `prefer_not_to_say`, not null
- AND a subsequent read returns `prefer_not_to_say`, distinguishable from a user who never answered

#### Scenario: Both null and prefer_not_to_say degrade identically downstream

- GIVEN one user with `sexOrGender = null` and another user with `sexOrGender = prefer_not_to_say`
- WHEN generation or volume computation reads either profile
- THEN both are treated as absent, with no behavioral difference between the two

### Requirement: Body Descriptor and Height CRUD

The system MUST expose the `sexOrGender` and `heightCm` fields through the existing authenticated
user-profile GET and PUT endpoints, alongside `name`, `goal`, and `experienceLevel`. PUT MUST
reject an invalid `sexOrGender` enum value with 422. PUT MUST reject a non-positive `heightCm`
(zero or negative) with 422 when a value is supplied. PUT MUST accept `null` for either field to
clear a previously set value. Reading another user's profile MUST NOT expose these fields, under
the same isolation guarantee `10a-v1-user-memory-structured` already provides for `name`/`goal`.

#### Scenario: Set body descriptor and height

- GIVEN an authenticated user
- WHEN they PUT profile with `{ "sexOrGender": "female", "heightCm": 165 }`
- THEN the profile is updated and a subsequent GET returns both values

#### Scenario: Reject invalid sexOrGender enum

- GIVEN an authenticated user
- WHEN they PUT profile with `{ "sexOrGender": "unspecified" }`
- THEN the system returns 422 and the profile is unchanged

#### Scenario: Reject non-positive height

- GIVEN an authenticated user
- WHEN they PUT profile with `{ "heightCm": 0 }` or `{ "heightCm": -5 }`
- THEN the system returns 422 and the profile is unchanged

#### Scenario: Clear a previously set value

- GIVEN a user with `sexOrGender = "male"` already stored
- WHEN they PUT `{ "sexOrGender": null }`
- THEN the profile updates to `sexOrGender = null`

### Requirement: Bodyweight Entry Recording

The system MUST persist bodyweight readings as a 1:many series keyed by `userId`, in a table
(`user_weight_entries`) carrying `userId`, `weightKg` (numeric), `recordedAt` (date), and
`createdAt`. `userId` MUST reference the user with `ON DELETE CASCADE`. The table MUST NOT carry a
unique constraint on `userId` — a user MAY have any number of readings. Creating an entry MUST
reject a non-positive `weightKg` with 422.

#### Scenario: First weight entry is stored

- GIVEN an authenticated user with no prior weight entries
- WHEN they submit a weight entry with `weightKg = 72.5` and a `recordedAt` date
- THEN a new `user_weight_entries` row is created for that user

#### Scenario: Second entry does not replace the first

- GIVEN a user already has one stored weight entry
- WHEN they submit a second weight entry with a different date
- THEN both rows exist afterward — the second does not overwrite or delete the first

#### Scenario: Reject non-positive weight

- GIVEN an authenticated user
- WHEN they submit a weight entry with `weightKg = 0` or a negative value
- THEN the system returns 422 and no row is created

#### Scenario: Deleting the user cascades away every entry

- GIVEN a user with one or more `user_weight_entries` rows
- WHEN that user's account is deleted
- THEN every `user_weight_entries` row referencing that user is deleted

### Requirement: Bodyweight Entry Listing

The system MUST expose the authenticated user's own weight entries as a read-only, reverse-
chronological list (most recent `recordedAt` first). Reading another user's entries MUST NOT be
possible.

#### Scenario: List returns newest first

- GIVEN a user has weight entries recorded on three different dates
- WHEN they list their weight entries
- THEN the entries are ordered by `recordedAt` descending, newest first

#### Scenario: User isolation on weight entries

- GIVEN user A and user B each have weight entries
- WHEN user B lists their weight entries
- THEN user A's entries are never returned

### Requirement: SI Units Only, No Unit Field

`heightCm` and `weightKg` MUST be stored and transmitted in SI units (centimeters, kilograms) with
no accompanying unit field, no per-user unit preference, and no conversion at read or write time —
consistent with `set_records.weightKg`, which has never carried a unit choice.

#### Scenario: No unit field accepted or returned

- GIVEN an authenticated user reads or writes `heightCm` or a weight entry
- WHEN the request or response is inspected
- THEN no unit field is present anywhere in the payload; the numeric value is always SI

### Requirement: Absent Body Values Degrade The Generation Prompt Byte-For-Byte

When `sexOrGender`, `heightCm`, and the user's bodyweight series are all absent (null, or a series
with zero entries), the rendered generation prompt MUST be byte-identical to the prompt rendered
before this change existed. No default value (e.g. an assumed average height or weight) MUST ever
be substituted for an absent field, in either the wizard-triggered generation flow or the chat
create-plan extraction flow.

#### Scenario: Fully absent body data produces the unchanged prompt

- GIVEN a user with `sexOrGender = null`, `heightCm = null`, and zero weight entries
- WHEN a plan is generated for that user, via either the wizard flow or the chat create-plan flow
- THEN the rendered prompt string is byte-identical to the prompt that would have rendered before
  this change

#### Scenario: prefer_not_to_say degrades exactly like null

- GIVEN a user with `sexOrGender = prefer_not_to_say`, `heightCm = null`, and zero weight entries
- WHEN a plan is generated for that user
- THEN the rendered prompt is byte-identical to the fully-absent case — no distinguishing text is
  rendered for a decline versus a never-asked field

#### Scenario: Partial presence renders only the present fields

- GIVEN a user with `heightCm = 178` set and `sexOrGender` and bodyweight both absent
- WHEN a plan is generated for that user
- THEN the rendered prompt includes height-derived content and omits any sex/gender- or
  bodyweight-derived content, with no invented substitute for the absent fields

### Requirement: Body Metric Values Never Reach Langfuse Trace Input

The redaction step applied to the rendered prompt before it is handed to `invoke()` MUST strip
every present body-metric value (`sexOrGender`, `heightCm`, resolved bodyweight) from the string
that becomes the Langfuse trace input, in both the wizard-triggered generation flow and the chat
create-plan extraction flow. This redaction MUST be written as a general value-redaction capability
(not a body-metrics special case), extending the existing limitation-term redaction seam rather than
introducing a second one.

#### Scenario: Body values do not survive into the traced input — wizard flow

- GIVEN a user with `sexOrGender`, `heightCm`, and a bodyweight reading all present, and a Langfuse
  trace handler attached
- WHEN a plan is generated through the wizard-triggered flow
- THEN the string passed to `invoke()` as trace input contains none of that user's body-metric
  values

#### Scenario: Body values do not survive into the traced input — chat extraction flow

- GIVEN a user with `sexOrGender`, `heightCm`, and a bodyweight reading all present, and a Langfuse
  trace handler attached
- WHEN a plan is generated through the chat create-plan extraction flow
- THEN the string passed to `invoke()` as trace input contains none of that user's body-metric
  values

#### Scenario: No trace handler configured — redaction still runs

- GIVEN no Langfuse trace handler is configured (e.g. local development)
- WHEN a plan is generated for a user with body metrics present
- THEN the redaction step still runs unconditionally before `invoke()`, independent of whether a
  handler is attached

### Requirement: Body Metric Values Never Enter A Structured Output Schema

Body-metric values MUST NOT be added as a field to `WorkoutExerciseSchema`, `WorkoutSessionSchema`,
or `WorkoutProgramSchema`. They MUST enter generation only as rendered prompt text — input, never a
model output shape.

#### Scenario: Output schemas carry no body-metric field

- GIVEN the generation output contracts as defined after this change
- WHEN `WorkoutExerciseSchema`, `WorkoutSessionSchema`, and `WorkoutProgramSchema` are inspected
- THEN none of them defines a `sexOrGender`, `heightCm`, or bodyweight field

### Requirement: Body Metric Values Never Passed As Observability Metadata

No code path MUST pass a body-metric value (`sexOrGender`, `heightCm`, or a resolved bodyweight
scalar) as a value in an `ObservabilityMetadata` object logged via the event-logging system. This is
a discipline requirement, not a type-system guarantee — `ObservabilityMetadata` is a flat scalar bag
that compiles a bare numeric or string body value without error, so this MUST be enforced by review
and by tests asserting no observability event emitted from a body-metric-touching code path carries
one of these values.

#### Scenario: Weight-entry creation emits no body-metric-valued observability event

- GIVEN a user creates a weight entry
- WHEN any observability event is logged for that request
- THEN no logged event's metadata contains the submitted `weightKg` value, or any other body-metric
  value, under any key

#### Scenario: Generation-triggering observability events carry no body-metric value

- GIVEN a user with body metrics present triggers plan generation
- WHEN any observability event is logged for that generation lifecycle
- THEN no logged event's metadata contains that user's `sexOrGender`, `heightCm`, or bodyweight value

### Requirement: Bodyweight Resolution For Volume

When computing training volume for a set with no logged `weightKg` (a bodyweight set), the system
MUST resolve a bodyweight for that set's session date using this rule, applied consistently by both
`exerciseVolume`/`sessionVolume` (web tracker) and the equivalent API-side stats aggregation:

1. If the user has one or more weight entries with `recordedAt` on or before the session date, use
   the entry with the latest `recordedAt` at or before that date (the nearest reading backward).
2. Otherwise, if the user has at least one weight entry with `recordedAt` after the session date,
   use the earliest such entry (the earliest-reading backstop).
3. If the user has zero weight entries, resolve no bodyweight; the set contributes zero volume,
   exactly as before this change.

A session's resolved bodyweight MUST NOT change as a result of a later weight entry, except when
that later entry becomes the new nearest-at-or-before reading for that session's date (i.e. only
sessions between the previous reading's date and the new reading's date are affected by adding a
new reading).

#### Scenario: No weight entries — bodyweight sets contribute zero volume

- GIVEN a user has zero weight entries
- WHEN volume is computed for a session containing a bodyweight-only set
- THEN that set contributes zero volume, unchanged from today's behavior

#### Scenario: Session predates every weight entry — earliest entry is the backstop

- GIVEN a user's only weight entry has `recordedAt` after a given session's date
- WHEN volume is computed for that session
- THEN the resolved bodyweight for that session is the earliest weight entry's `weightKg`

#### Scenario: Session falls between two readings — nearest-before wins

- GIVEN a user has weight entries on 2026-06-01 (80kg) and 2026-08-01 (78kg)
- WHEN volume is computed for a session dated 2026-07-15
- THEN the resolved bodyweight for that session is 80kg (the nearest reading at or before the
  session date)

#### Scenario: A new later reading does not rewrite settled history

- GIVEN a user has a weight entry on 2026-06-01 (80kg), and a session dated 2026-05-01 already
  resolves its bodyweight against a still-earlier entry from 2026-04-01 (82kg)
- WHEN the user adds a new weight entry on 2026-09-01 (76kg)
- THEN the 2026-05-01 session's resolved bodyweight remains 82kg — unaffected by the new,
  later-dated entry

#### Scenario: Web tracker and API stats aggregation agree

- GIVEN a user with a mix of weighted and bodyweight sets and one or more weight entries
- WHEN the web tracker computes session volume and the API stats aggregation computes the same
  session's contribution to `totalVolumeKg`
- THEN both use the identical resolved bodyweight for the same session, by the same resolution rule

### Requirement: Volume Shift Is Announced At First Weight Entry

The moment a user's first weight entry is created, the system MUST surface a user-visible
explanation naming the cause (bodyweight sets now count toward volume) and the consequence (totals
before today are not directly comparable to totals after). This explanation MUST be shown at the
point of first weight entry only; this change does NOT require a persistent explanation on the
Stats volume surface for later visits.

#### Scenario: First weight entry triggers the explanation

- GIVEN a user has zero prior weight entries
- WHEN they submit their first weight entry
- THEN the system surfaces an explanation stating that bodyweight sets now count toward volume and
  that historical totals before this point are not directly comparable

#### Scenario: Subsequent weight entries do not repeat the explanation

- GIVEN a user has already submitted at least one weight entry
- WHEN they submit a second or later weight entry
- THEN no volume-shift explanation is shown again for that action

#### Scenario: Returning to Stats later carries no persistent volume-shift note

- GIVEN a user recorded their first weight entry in a previous session
- WHEN they later open the Stats volume surface
- THEN no persistent explanation of the volume shift is required to be present (out of scope for
  this change)

### Requirement: Personal Records Remain Unaffected By Bodyweight Volume

Adding bodyweight to the volume formula MUST NOT change personal-record (PR) computation.
`isEligible` for an estimated-1RM personal record MUST continue to require `weightKg > 0` on the
set itself, and PR computation MUST continue to read the set's logged load directly — never a
computed volume figure, and never a resolved bodyweight. This is an explicit non-regression: the
existing exclusion of bodyweight and no-weight sets from 1RM PRs, already specified, stands
unchanged by this change.

#### Scenario: Bodyweight-only exercise still shows no estimated-1RM PR

- GIVEN a user has weight entries and an exercise history containing only bodyweight sets
  (`set.weightKg` null or zero on every set)
- WHEN they open statistics after this change ships
- THEN no estimated-1RM personal record is shown for that exercise, exactly as before this change

#### Scenario: A newly resolved bodyweight does not create a PR

- GIVEN a user's first weight entry causes previously-zero-volume bodyweight sets to gain volume
- WHEN PR computation runs afterward
- THEN no new personal record appears as a result of the resolved bodyweight — PR eligibility is
  unaffected by volume resolution entirely

### Requirement: Mobile Profile Parity

The mobile app MUST provide a profile screen through which the authenticated user can read and
write the same `sexOrGender`, `heightCm`, and bodyweight-entry data available on web, subject to
the same validation and isolation rules.

#### Scenario: Mobile records and reads back the same fields as web

- GIVEN a user sets `sexOrGender`, `heightCm`, and a weight entry from the mobile profile screen
- WHEN they view the same data from the web profile page
- THEN the values match exactly

#### Scenario: Mobile enforces the same validation

- GIVEN a user on mobile
- WHEN they attempt to submit an invalid `sexOrGender` value, a non-positive `heightCm`, or a
  non-positive `weightKg`
- THEN the request is rejected under the same rules as the web endpoints
