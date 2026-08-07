## MODIFIED Requirements

### Requirement: Statistics Surface

The statistics surface MUST present progress metrics derived from completed workout sessions, scoped to web only. For the selected period it MUST present KPIs — total volume (kg), session count, total training time, and personal-record (PR) count — each with a delta vs. the previous period; a volume trend (current vs. previous period); muscle-group distribution across the 10 primary muscle groups; and personal records. Total volume, volume trend, and muscle-group distribution figures MUST include volume from bodyweight sets using the resolved bodyweight defined by `profile-body-metrics`' Bodyweight Resolution requirement; a bodyweight set with no resolvable bodyweight (the user has zero weight entries) MUST continue to contribute zero volume, exactly as before this change. PR computation MUST remain unaffected by bodyweight volume (see `profile-body-metrics`' Personal Records Remain Unaffected requirement). When the previous period has no data (zero sessions/volume), each KPI delta MUST be null ("new" / no comparison), never infinity, NaN, or a divide-by-zero error. Metrics MUST degrade gracefully when underlying data is sparse or absent, rather than erroring. The statistics surface MUST NOT require an adherence KPI (adherence is a dashboard concern). All queries backing this surface MUST be scoped by (tenantId, userId).

(Previously: bodyweight and no-weight sets contributed zero volume unconditionally, regardless of
whether the user had ever recorded a weight. Volume figures now include bodyweight-set contributions
once the user has at least one weight entry, per the resolution rule in `profile-body-metrics`.)

#### Scenario: User reviews training analytics

- GIVEN a user has completed workouts
- WHEN they open statistics for a period (week/month/year)
- THEN they see the KPIs (total volume, session count, total time, PR count) each with a delta vs. the previous period, a volume trend for the current vs. previous period, and personal records summarized from their session history

#### Scenario: Muscle-group distribution over the 10 primary groups

- GIVEN a user has completed sessions with exercises mapped to muscle groups
- WHEN they open statistics
- THEN the muscle-group distribution reflects relative volume/frequency across the 10 primary groups (chest, back, shoulders, biceps, triceps, core, glutes, quads, hamstrings, calves) using only data available; the UI MAY present these grouped into coarser display buckets, but the underlying distribution is computed over the 10 primary groups

#### Scenario: Exercise without a muscle-group mapping does not break distribution

- GIVEN a completed session includes at least one exercise with no muscle-group mapping
- WHEN the user opens statistics
- THEN the muscle-group distribution renders using only mapped exercises, the unmapped exercise contributes to other metrics (volume, trends, PRs) unaffected, and no error is shown

#### Scenario: Personal records surface estimated 1RM from sets with logged weight and reps

- GIVEN a user has completed sessions for an exercise with at least one set that is completed and has both a logged weight (> 0) and logged reps (> 0)
- WHEN they open statistics
- THEN each personal record shows the exercise's estimated one-rep max (estimated 1RM), the date it was achieved, and a recent trend, computed only from eligible sets (completed, weight > 0, reps > 0)

#### Scenario: Bodyweight and no-weight sets are excluded from 1RM PRs

- GIVEN an exercise only has bodyweight, no-weight/assisted, or null-reps sets logged
- WHEN the user opens statistics
- THEN no estimated-1RM personal record is shown for that exercise (it is omitted, not shown as zero), while its sets still contribute to volume, session count, and trends where applicable

#### Scenario: Bodyweight sets contribute zero volume before any weight entry exists

- GIVEN a user has completed bodyweight-only sessions and has never recorded a weight entry
- WHEN they open statistics
- THEN total volume, volume trend, and muscle-group distribution for those sessions reflect zero
  contribution from the bodyweight sets, exactly as before this change

#### Scenario: Bodyweight sets contribute non-zero volume once a weight entry exists

- GIVEN a user has completed bodyweight-only sessions and has recorded at least one weight entry
  resolvable to those sessions per the Bodyweight Resolution rule
- WHEN they open statistics
- THEN total volume, volume trend, and muscle-group distribution include the resolved-bodyweight
  contribution from those sets

#### Scenario: KPI delta is null when there is no previous period

- GIVEN a user has data in the selected period but no completed sessions in the previous period
- WHEN they open statistics
- THEN each KPI shows its current value with a null "new" delta (no percentage, no up/down arrow), never infinity, NaN, or an error

#### Scenario: Sparse or absent data degrades gracefully

- GIVEN a user has zero or very few completed sessions
- WHEN they open statistics
- THEN each metric section (KPIs, volume trend, distribution, PRs) independently shows an empty/insufficient-data state instead of failing or hiding the whole surface
