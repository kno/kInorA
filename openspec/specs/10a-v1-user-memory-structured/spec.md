# 10a-v1-user-memory-structured Specification

## Purpose

Persist editable user profile, training preferences, and workout session
lifecycle (delete) as structured, tenant-scoped and user-scoped data, so the
app can personalize without re-asking, the plan wizard can pre-fill from
saved defaults, and users can manage their own workout history.

## Dependencies

- `01c-v1-multi-tenant-schema`
- `05b-v1-security-tenant-validation`

## Capability: User Profile

Store and manage user identity data (name, goal, experienceLevel) as
user-scoped structured memory, with auto-provisioning during registration.

### Requirement: Profile Storage

The system MUST persist a user profile row uniquely identified by `userId`.
The profile MUST carry `name` (text, NOT NULL), `goal` (one of `strength`,
`hypertrophy`, `fat_loss`, `general_fitness`, nullable), and
`experienceLevel` (one of `beginner`, `intermediate`, `advanced`, nullable).
The `userId` column MUST have a unique constraint.

### Requirement: Profile CRUD

The system MUST expose GET and PUT endpoints for the authenticated user's
profile. PUT MUST reject a blank or missing `name` with 422. PUT MUST reject
invalid enum values for `goal` or `experienceLevel` with 422.

#### Scenario: Read own profile

- GIVEN an authenticated user with tenant scope
- WHEN they GET their profile
- THEN the response includes `name`, `goal`, and `experienceLevel`

#### Scenario: Update profile fields

- GIVEN an authenticated user
- WHEN they PUT profile with `{ "name": "Alex", "goal": "hypertrophy", "experienceLevel": "intermediate" }`
- THEN the profile is updated and a subsequent GET returns the new values

#### Scenario: Reject blank name on PUT

- GIVEN an authenticated user
- WHEN they PUT profile with `{ "name": "" }`
- THEN the system returns 422 and the profile is unchanged

#### Scenario: Reject invalid goal enum

- GIVEN an authenticated user
- WHEN they PUT profile with `{ "goal": "cardio" }`
- THEN the system returns 422

#### Scenario: Reject invalid experienceLevel

- GIVEN an authenticated user
- WHEN they PUT profile with `{ "experienceLevel": "expert" }`
- THEN the system returns 422

#### Scenario: User isolation

- GIVEN user A and user B each have a profile
- WHEN user B GETs their profile
- THEN user A's profile data is never returned

#### Scenario: Loading state during profile fetch

- GIVEN an authenticated user opens the profile page
- WHEN profile data is still being fetched
- THEN the UI shows a loading indicator

### Requirement: Auto-Provision on Registration

The registration flow (`provisionTenantForUser`) MUST insert a default
profile row with `name` set to the email prefix (part before `@`) and
`goal`/`experienceLevel` set to NULL. This MUST happen in the same
transaction as tenant/user/membership creation.

#### Scenario: Profile created during registration

- GIVEN a user registers with email `alex@example.com`
- WHEN registration completes
- THEN a profile row exists with `name = "alex"`, `goal = NULL`, `experienceLevel = NULL`

### Out of Scope (User Profile)

- Avatar upload or profile photo
- Public or shareable profiles
- Cross-tenant profile sharing
- Goal-specific training logic (goal is metadata only)
- Profile completeness prompts or gamification

## Capability: User Preferences

Store training context preferences (defaultLocation, defaultDuration,
defaultEquipment) as user-scoped structured memory and pre-fill the plan
wizard from saved values.

### Requirement: Preferences Storage

The system MUST persist a user preferences row uniquely identified by
`userId`. The row MUST carry `defaultLocation` (text, nullable),
`defaultDuration` (integer minutes, nullable), and `defaultEquipment` (text
array or JSONB, nullable). `defaultDuration` when non-null MUST be a
positive integer. `defaultEquipment` when non-null MAY be an empty array.

### Requirement: Preferences CRUD

The system MUST expose GET and PUT endpoints for the authenticated user's
preferences. PUT MUST accept partial updates — fields not sent SHALL remain
unchanged. PUT MUST reject non-positive `defaultDuration` with 422.

#### Scenario: Read own preferences

- GIVEN an authenticated user with saved preferences
- WHEN they GET their preferences
- THEN the response includes `defaultLocation`, `defaultDuration`, and `defaultEquipment`

#### Scenario: Update all preference fields

- GIVEN an authenticated user
- WHEN they PUT `{ "defaultLocation": "gym", "defaultDuration": 60, "defaultEquipment": ["dumbbells", "bench"] }`
- THEN preferences are updated and a subsequent GET returns the new values

#### Scenario: Partial update preserves unsent fields

- GIVEN a user has `defaultLocation: "home"`, `defaultDuration: 45`
- WHEN they PUT only `{ "defaultDuration": 30 }`
- THEN `defaultLocation` remains `"home"` and `defaultEquipment` is unchanged

#### Scenario: Reject non-positive duration

- GIVEN an authenticated user
- WHEN they PUT `{ "defaultDuration": 0 }` or `{ "defaultDuration": -10 }`
- THEN the system returns 422 and existing preferences are unchanged

#### Scenario: Empty equipment array is valid

- GIVEN an authenticated user
- WHEN they PUT `{ "defaultEquipment": [] }`
- THEN the request succeeds and equipment is stored as empty array

#### Scenario: User isolation

- GIVEN user A and user B both have preferences
- WHEN user B GETs their preferences
- THEN user A's preferences are never returned

### Requirement: Wizard Pre-fill

The plan wizard SHOULD read `user_preferences` on mount. If a preferences
row exists, the wizard SHOULD pre-fill defaultLocation, defaultDuration, and
defaultEquipment steps with stored values. If no row exists, the wizard MUST
behave exactly as today (no pre-fill, null defaults).

#### Scenario: Wizard pre-fills from preferences

- GIVEN a user has preferences with `defaultLocation: "gym"`, `defaultDuration: 45`, `defaultEquipment: ["band"]`
- WHEN the plan wizard mounts
- THEN the location, duration, and equipment steps show these values as pre-filled defaults

#### Scenario: Wizard no-op when no preferences exist

- GIVEN a user has no preferences row
- WHEN the plan wizard mounts
- THEN all preference steps show null/empty defaults — wizard behaves exactly as today

### Out of Scope (User Preferences)

- New wizard steps or step reordering
- Preferences → PlanSpec mapping logic (existing wizard handles it)
- Equipment value validation against a known catalog
- Onboarding wizard flow

## Capability: Workout Session Delete

Allow users to delete their own workout sessions (individual or bulk) via
tenant-scoped API endpoints, with cascading cleanup of exercises and set
records.

### Requirement: Individual Session Delete

The system MUST expose `DELETE /workout-sessions/:id` scoped to (tenantId,
userId). Deletion MUST cascade to session exercises and set records. After
deletion the session MUST NOT appear in history, stats, or dashboard. A
nonexistent or unowned session MUST return 404.

#### Scenario: Delete owned completed session

- GIVEN a user has a completed workout session
- WHEN they DELETE `/workout-sessions/:id`
- THEN the session is removed
- AND it no longer appears in history, stats, or dashboard

#### Scenario: Delete nonexistent session returns 404

- GIVEN no session exists with the given ID
- WHEN they DELETE `/workout-sessions/:id`
- THEN the system returns 404

#### Scenario: Delete another user's session returns 404

- GIVEN user A owns a session in the same tenant as user B
- WHEN user B attempts to DELETE that session
- THEN the system returns 404 (no existence information leak)

#### Scenario: Cross-tenant delete returns 404

- GIVEN a session owned by tenant A
- WHEN a tenant B user attempts to DELETE it
- THEN the system returns 404

#### Scenario: Deletion cascades to exercises and sets

- GIVEN a completed session with 3 exercises and 15 set records
- WHEN the session is deleted
- THEN the session, its exercises, and all set records are removed
- AND no orphaned rows remain

### Requirement: Bulk Session Delete

The system MUST expose `DELETE /workout-sessions` that deletes ALL workout
sessions owned by the authenticated user within the active tenant, with
cascading cleanup. The endpoint MUST return the count of deleted sessions.
When the user has no sessions, the endpoint MUST succeed with count 0.

#### Scenario: Bulk delete all completed sessions

- GIVEN a user has 5 completed workout sessions
- WHEN they DELETE `/workout-sessions`
- THEN all 5 are deleted
- AND the response includes a count of 5

#### Scenario: Bulk delete with no sessions

- GIVEN a user has zero workout sessions
- WHEN they DELETE `/workout-sessions`
- THEN the response returns success with count 0

### Requirement: Active Session Guard

The system MUST reject deletion of an active (in-progress) session for both
individual and bulk delete, returning 409 Conflict. The user MUST complete
or cancel the active session before deletion.

#### Scenario: Delete active session returns 409

- GIVEN a user has an active (in-progress) workout session
- WHEN they DELETE `/workout-sessions/:id`
- THEN the system returns 409
- AND the session remains in active state

#### Scenario: Bulk delete fails with active sessions

- GIVEN a user has 3 completed and 1 active session
- WHEN they DELETE `/workout-sessions`
- THEN the system returns 409
- AND no sessions are deleted

### Out of Scope (Workout Session Delete)

- Soft delete or trash/recovery
- Scheduled or automatic deletion (retention policy)
- Delete individual exercises or set records independently
- Delete workout plans or plan specs
- GDPR export-before-delete flow
