## MODIFIED Requirements

### Requirement: Profile Storage

The system MUST persist a user profile row uniquely identified by `userId`.
The profile MUST carry `name` (text, NOT NULL), `goal` (one of `strength`,
`hypertrophy`, `fat_loss`, `general_fitness`, nullable), `experienceLevel`
(one of `beginner`, `intermediate`, `advanced`, nullable), `sexOrGender` (one
of `female`, `male`, `non_binary`, `other`, `prefer_not_to_say`, nullable), and `heightCm`
(numeric, nullable). The `userId` column MUST have a unique constraint.
`sexOrGender` and `heightCm` MUST both default to null for every profile row
that predates this change or that has never set them.

(Previously: the profile carried only `name`, `goal`, and `experienceLevel`.
`sexOrGender` and `heightCm` are new nullable, additive columns.)

### Requirement: Profile CRUD

The system MUST expose GET and PUT endpoints for the authenticated user's
profile. PUT MUST reject a blank or missing `name` with 422. PUT MUST reject
invalid enum values for `goal`, `experienceLevel`, or `sexOrGender` with 422.
PUT MUST reject a non-positive (zero or negative) `heightCm` with 422 when a
value is supplied. PUT MUST accept `null` for `sexOrGender` or `heightCm` to
clear a previously set value.

(Previously: PUT validated only `name`, `goal`, and `experienceLevel`.
Validation for `sexOrGender` and `heightCm` is new.)

#### Scenario: Read own profile

- GIVEN an authenticated user with tenant scope
- WHEN they GET their profile
- THEN the response includes `name`, `goal`, `experienceLevel`, `sexOrGender`, and `heightCm`

#### Scenario: Update profile fields

- GIVEN an authenticated user
- WHEN they PUT profile with `{ "name": "Alex", "goal": "hypertrophy", "experienceLevel": "intermediate" }`
- THEN the profile is updated and a subsequent GET returns the new values

#### Scenario: Update body metric fields

- GIVEN an authenticated user
- WHEN they PUT profile with `{ "sexOrGender": "female", "heightCm": 165 }`
- THEN the profile is updated and a subsequent GET returns both values

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

#### Scenario: Reject invalid sexOrGender enum

- GIVEN an authenticated user
- WHEN they PUT profile with `{ "sexOrGender": "unspecified" }`
- THEN the system returns 422 and the profile is unchanged

#### Scenario: Reject non-positive height

- GIVEN an authenticated user
- WHEN they PUT profile with `{ "heightCm": 0 }` or `{ "heightCm": -5 }`
- THEN the system returns 422 and the profile is unchanged

#### Scenario: User isolation

- GIVEN user A and user B each have a profile
- WHEN user B GETs their profile
- THEN user A's profile data, including body metric fields, is never returned

#### Scenario: Loading state during profile fetch

- GIVEN an authenticated user opens the profile page
- WHEN profile data is still being fetched
- THEN the UI shows a loading indicator
