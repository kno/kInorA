# 10b — User Preferences

## Capability

Store training context preferences (defaultLocation, defaultDuration, defaultEquipment) as user-scoped structured memory and pre-fill the plan wizard from saved values.

## Requirements

### R1: Preferences Storage

The system MUST persist a user preferences row uniquely identified by `userId`. The row MUST carry `defaultLocation` (text, nullable), `defaultDuration` (integer minutes, nullable), and `defaultEquipment` (text array or JSONB, nullable). `defaultDuration` when non-null MUST be a positive integer. `defaultEquipment` when non-null MAY be an empty array.

### R2: Preferences CRUD

The system MUST expose GET and PUT endpoints for the authenticated user's preferences. PUT MUST accept partial updates — fields not sent SHALL remain unchanged. PUT MUST reject non-positive `defaultDuration` with 422.

### R3: Wizard Pre-fill

The plan wizard SHOULD read `user_preferences` on mount. If a preferences row exists, the wizard SHOULD pre-fill defaultLocation, defaultDuration, and defaultEquipment steps with stored values. If no row exists, the wizard MUST behave exactly as today (no pre-fill, null defaults).

## Scenarios

### Scenario: Read own preferences

**Given** an authenticated user with saved preferences  
**When** they GET their preferences  
**Then** the response includes `defaultLocation`, `defaultDuration`, and `defaultEquipment`

### Scenario: Update all preference fields

**Given** an authenticated user  
**When** they PUT `{ "defaultLocation": "gym", "defaultDuration": 60, "defaultEquipment": ["dumbbells", "bench"] }`  
**Then** preferences are updated and a subsequent GET returns the new values

### Scenario: Partial update preserves unsent fields

**Given** a user has `defaultLocation: "home"`, `defaultDuration: 45`  
**When** they PUT only `{ "defaultDuration": 30 }`  
**Then** `defaultLocation` remains `"home"` and `defaultEquipment` is unchanged

### Scenario: Reject non-positive duration

**Given** an authenticated user  
**When** they PUT `{ "defaultDuration": 0 }` or `{ "defaultDuration": -10 }`  
**Then** the system returns 422 and existing preferences are unchanged

### Scenario: Empty equipment array is valid

**Given** an authenticated user  
**When** they PUT `{ "defaultEquipment": [] }`  
**Then** the request succeeds and equipment is stored as empty array

### Scenario: Wizard pre-fills from preferences

**Given** a user has preferences with `defaultLocation: "gym"`, `defaultDuration: 45`, `defaultEquipment: ["band"]`  
**When** the plan wizard mounts  
**Then** the location, duration, and equipment steps show these values as pre-filled defaults

### Scenario: Wizard no-op when no preferences exist

**Given** a user has no preferences row  
**When** the plan wizard mounts  
**Then** all preference steps show null/empty defaults — wizard behaves exactly as today

### Scenario: User isolation

**Given** user A and user B both have preferences  
**When** user B GETs their preferences  
**Then** user A's preferences are never returned

## Out of Scope

- New wizard steps or step reordering
- Preferences → PlanSpec mapping logic (existing wizard handles it)
- Equipment value validation against a known catalog
- Onboarding wizard flow
