# Delta for 09c-plan-view-design

## MODIFIED Requirements

### Requirement: Detail Panel Includes Start CTA

The `DayDetailPanel` detail panel MUST include the "Empezar sesión" CTA when the
rendered plan has status `ready`. The CTA MUST carry `(planId, day)` context and route
to the workout tracker.

(Previously SC-12: "Empezar sesión de hoy" CTA was absent — explicitly deferred to 09a.)

#### Scenario: SC-12 — detail panel shows start CTA for ready plan

- GIVEN a ready plan is selected and a day card is expanded
- WHEN `DayDetailPanel` renders the detail panel
- THEN the "Empezar sesión" button is present
- AND it carries the correct `planId` and `day` values

#### Scenario: SC-12 — detail panel shows remaining elements unchanged

- GIVEN a ready plan is selected and a day card is expanded
- WHEN `DayDetailPanel` renders
- THEN the eyebrow, subtitle, exercise table, and "Peso" column absence are unchanged from the 09c baseline

### Requirement: Deferred Elements List Updated

The set of elements explicitly absent from the rendered HTML MUST be updated to remove
"Empezar sesión de hoy" from the deferred list, since the CTA is now present.

(Previously SC-23: listed "An 'Empezar sesión de hoy' button or any functional workout-start CTA" as absent.)

#### Scenario: SC-23 — start CTA is no longer in the absent list

- GIVEN a ready plan day card is expanded
- WHEN the rendered HTML is inspected
- THEN an "Empezar sesión" button IS present in the DOM
- AND the following remain absent: "Peso" column, completion check-marks, "today" indicator, week navigation, real "Volumen objetivo" value
