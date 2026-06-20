# 09a-v1-workout-tracking-core Specification

## Purpose

Provide online workout session tracking, set records, RPE validation, and notes before offline sync is added.

## Dependencies

- `01c-v1-multi-tenant-schema`
- `05b-v1-security-tenant-validation`

## Requirements

### Requirement: Workout Session Recording

The system MUST allow authenticated users to create workout sessions and record exercise sets.

#### Scenario: Complete set entry

- GIVEN a user performing a workout session
- WHEN they submit weight, reps, RPE, completion status, and notes
- THEN the set is stored and appears in the active session

### Requirement: RPE Validation

Set RPE MUST be constrained to the 0-10 range.

#### Scenario: Invalid RPE rejected

- GIVEN a user enters RPE outside 0-10
- WHEN they submit the set
- THEN the system rejects the input with a validation error

### Requirement: Tenant-Scoped Session Access

Workout sessions MUST only be visible to users in the owning tenant and authorized user scope.

#### Scenario: Other tenant session hidden

- GIVEN a session owned by tenant B
- WHEN a tenant A user requests it
- THEN the system returns no session data
