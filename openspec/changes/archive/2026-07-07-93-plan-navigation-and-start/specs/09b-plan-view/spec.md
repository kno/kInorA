# Delta for 09b-plan-view

## MODIFIED Requirements

### Requirement: PlanSummary DTO Includes Name

The `PlanSummary` DTO returned by the list endpoint MUST include a `name` field. For
plans with a stored name the value is that name; for plans with `name = NULL` the value
is the auto-generated default (not null, not empty string).

(Previously: `PlanSummary` contained only `{ id, status, createdAt }` — no name field.)

#### Scenario: SC-03 — list includes name field

- GIVEN the user has two plans with names "Fuerza" and "Cardio"
- WHEN `GET /workout-plans` is called
- THEN each summary in the response contains `name: "Fuerza"` and `name: "Cardio"` respectively
- AND the array is still ordered newest-first

#### Scenario: SC-03 — null-name plan uses auto-default in DTO

- GIVEN a plan row has `name = NULL`
- WHEN `GET /workout-plans` is called
- THEN the summary for that plan contains a non-empty auto-default `name` string

### Requirement: Selector Uses Plan Name as Primary Label

`PlanSelector` MUST use the plan `name` as the primary option label. The previous
date+status label MUST be replaced or supplemented with the name so two plans are
visually distinguishable.

(Previously SC-23: selector labels each option by created date + status only, with no name.)

#### Scenario: SC-23 — selector shows names

- GIVEN the user has two ready plans with names "Fuerza" and "Cardio"
- WHEN `PlanSelector` renders
- THEN the two options display "Fuerza" and "Cardio" as distinguishable labels

#### Scenario: SC-23 — selector shows auto-default for unnamed legacy plan

- GIVEN a plan has `name = NULL`
- WHEN `PlanSelector` renders for that plan
- THEN its option shows the auto-default label (not "null", not an empty string)

#### Scenario: SC-23 — selected option reflects current planId

- GIVEN the URL carries `?planId=<id>`
- WHEN `PlanSelector` renders
- THEN the option for `<id>` is marked selected regardless of its name
