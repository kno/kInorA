# 93a-plan-day-start-cta Specification

## Purpose

Expose a per-day "Empezar sesión" CTA inside `DayDetailPanel` so a user can start a
workout tracker session for a specific `(planId, day)` pair directly from the Plan tab,
without navigating to `/plan/[id]`.

## Requirements

### Requirement: CTA Reachable via Plan Tab Navigation

The Plan tab MUST provide a path to start a session for any training day on a ready plan
without requiring direct `/plan/[id]` URL entry. The per-day start CTA MUST be visible
inside `DayDetailPanel` when the selected plan status is `ready`.

#### Scenario: Start CTA present for a ready plan day

- GIVEN the user navigates to the Plan tab and selects a ready plan
- WHEN they expand a day card in `DayDetailPanel`
- THEN an "Empezar sesión" button is visible for that day

#### Scenario: Start CTA absent for non-ready plan

- GIVEN the user navigates to the Plan tab and the selected plan has status `generating` or `failed`
- WHEN they view the plan
- THEN no "Empezar sesión" CTA is shown for any day

### Requirement: CTA Carries (planId, day) Context

Activating the CTA MUST route to the workout tracker with both `planId` and `day` as
context parameters. The tracker MUST receive and use these values to scope the session
start call.

#### Scenario: CTA routes with correct planId and day

- GIVEN a user opens `DayDetailPanel` for day 2 of plan `abc`
- WHEN they click "Empezar sesión"
- THEN the tracker receives `planId = "abc"` and `day = 2`

#### Scenario: Two different days carry distinct context

- GIVEN a user expands day 1 and then day 3 of the same ready plan
- WHEN they activate the CTA on each
- THEN the tracker receives `day = 1` and `day = 3` respectively, never the wrong day

### Requirement: i18n Coverage

The "Empezar sesión" label MUST be sourced from the i18n catalog (not hardcoded). Both
`en.json` and `es.json` MUST contain the key.

#### Scenario: Label rendered from catalog

- GIVEN the user's locale is `es`
- WHEN `DayDetailPanel` renders the CTA
- THEN the button label is retrieved from `es.json` and no hardcoded English string is present

### Requirement: Route Layer Compliance

The CTA action MUST route through a server action or client navigation; it MUST NOT
import the database layer directly (the #85 `routes-no-db-layer` rule applies).

#### Scenario: No direct db import in CTA path

- GIVEN the CTA is activated
- WHEN the session start flow executes
- THEN no browser-side code imports or calls the database layer directly
