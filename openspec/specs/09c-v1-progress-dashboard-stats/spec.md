# 09c-v1-progress-dashboard-stats Specification

## Purpose

Provide progress surfaces backed by workout sessions and history: dashboard, statistics, weekly plan/progress overview, and exercise detail references.

This spec converts completed workout data into useful user feedback after tracking and offline history exist.

## Dependencies

- `09a-v1-workout-tracking-core`
- `09b-v1-workout-offline-history`
- `06b-v1-orbit-ui-shell`

## Requirements

### Requirement: Dashboard Progress Summary

The dashboard MUST summarize current training progress using available workout and history data.

#### Scenario: User sees today's training context

- GIVEN a user has an active plan and workout history
- WHEN they open the dashboard
- THEN they see today's workout context, streak or adherence indicators, recent progress, and relevant quick actions

#### Scenario: Empty dashboard explains next action

- GIVEN a user has no workout history yet
- WHEN they open the dashboard
- THEN the dashboard shows an empty state that guides them toward creating a plan or starting a workout

### Requirement: Statistics Surface

The statistics surface MUST present progress metrics derived from completed workout sessions.

#### Scenario: User reviews training analytics

- GIVEN a user has completed workouts
- WHEN they open statistics
- THEN they see meaningful summaries such as volume, adherence, muscle group distribution, trends, or personal records when data is available

### Requirement: Weekly Plan and Progress Overview

The weekly plan surface MUST connect planned training with completion progress.

#### Scenario: User reviews the week

- GIVEN a user has a generated plan and logged sessions
- WHEN they open the weekly plan overview
- THEN planned days, completed sessions, missed sessions, and upcoming work are distinguishable

### Requirement: Exercise Detail Progress References

Exercise detail views SHOULD reference recent history for the selected exercise when available.

#### Scenario: User views exercise history context

- GIVEN a user opens an exercise detail screen for an exercise they have performed before
- WHEN workout history exists for that exercise
- THEN the screen shows recent performance context without replacing the live session tracking flow
