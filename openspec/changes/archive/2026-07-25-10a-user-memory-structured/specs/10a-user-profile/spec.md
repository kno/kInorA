# 10a — User Profile

## Capability

Store and manage user identity data (name, goal, experienceLevel) as user-scoped structured memory, with auto-provisioning during registration.

## Requirements

### R1: Profile Storage

The system MUST persist a user profile row uniquely identified by `userId`. The profile MUST carry `name` (text, NOT NULL), `goal` (one of `strength`, `hypertrophy`, `fat_loss`, `general_fitness`, nullable), and `experienceLevel` (one of `beginner`, `intermediate`, `advanced`, nullable). The `userId` column MUST have a unique constraint.

### R2: Profile CRUD

The system MUST expose GET and PUT endpoints for the authenticated user's profile. PUT MUST reject a blank or missing `name` with 422. PUT MUST reject invalid enum values for `goal` or `experienceLevel` with 422.

### R3: Auto-Provision on Registration

The registration flow (`provisionTenantForUser`) MUST insert a default profile row with `name` set to the email prefix (part before `@`) and `goal`/`experienceLevel` set to NULL. This MUST happen in the same transaction as tenant/user/membership creation.

## Scenarios

### Scenario: Read own profile

**Given** an authenticated user with tenant scope  
**When** they GET their profile  
**Then** the response includes `name`, `goal`, and `experienceLevel`

### Scenario: Update profile fields

**Given** an authenticated user  
**When** they PUT profile with `{ "name": "Alex", "goal": "hypertrophy", "experienceLevel": "intermediate" }`  
**Then** the profile is updated and a subsequent GET returns the new values

### Scenario: Reject blank name on PUT

**Given** an authenticated user  
**When** they PUT profile with `{ "name": "" }`  
**Then** the system returns 422 and the profile is unchanged

### Scenario: Reject invalid goal enum

**Given** an authenticated user  
**When** they PUT profile with `{ "goal": "cardio" }`  
**Then** the system returns 422

### Scenario: Reject invalid experienceLevel

**Given** an authenticated user  
**When** they PUT profile with `{ "experienceLevel": "expert" }`  
**Then** the system returns 422

### Scenario: User isolation

**Given** user A and user B each have a profile  
**When** user B GETs their profile  
**Then** user A's profile data is never returned

### Scenario: Profile created during registration

**Given** a user registers with email `alex@example.com`  
**When** registration completes  
**Then** a profile row exists with `name = "alex"`, `goal = NULL`, `experienceLevel = NULL`

### Scenario: Loading state during profile fetch

**Given** an authenticated user opens the profile page  
**When** profile data is still being fetched  
**Then** the UI shows a loading indicator

## Out of Scope

- Avatar upload or profile photo
- Public or shareable profiles
- Cross-tenant profile sharing
- Goal-specific training logic (goal is metadata only)
- Profile completeness prompts or gamification
