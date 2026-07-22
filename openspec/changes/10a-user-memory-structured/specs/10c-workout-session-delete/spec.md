# 10c — Workout Session Delete

## Capability

Allow users to delete their own workout sessions (individual or bulk) via tenant-scoped API endpoints, with cascading cleanup of exercises and set records.

## Requirements

### R1: Individual Session Delete

The system MUST expose `DELETE /workout-sessions/:id` scoped to (tenantId, userId). Deletion MUST cascade to session exercises and set records. After deletion the session MUST NOT appear in history, stats, or dashboard. A nonexistent or unowned session MUST return 404.

### R2: Bulk Session Delete

The system MUST expose `DELETE /workout-sessions` that deletes ALL workout sessions owned by the authenticated user within the active tenant, with cascading cleanup. The endpoint MUST return the count of deleted sessions. When the user has no sessions, the endpoint MUST succeed with count 0.

### R3: Active Session Guard

The system MUST reject deletion of an active (in-progress) session for both individual and bulk delete, returning 409 Conflict. The user MUST complete or cancel the active session before deletion.

## Scenarios

### Scenario: Delete owned completed session

**Given** a user has a completed workout session  
**When** they DELETE `/workout-sessions/:id`  
**Then** the session is removed  
**And** it no longer appears in history, stats, or dashboard

### Scenario: Delete nonexistent session returns 404

**Given** no session exists with the given ID  
**When** they DELETE `/workout-sessions/:id`  
**Then** the system returns 404

### Scenario: Delete another user's session returns 404

**Given** user A owns a session in the same tenant as user B  
**When** user B attempts to DELETE that session  
**Then** the system returns 404 (no existence information leak)

### Scenario: Cross-tenant delete returns 404

**Given** a session owned by tenant A  
**When** a tenant B user attempts to DELETE it  
**Then** the system returns 404

### Scenario: Delete active session returns 409

**Given** a user has an active (in-progress) workout session  
**When** they DELETE `/workout-sessions/:id`  
**Then** the system returns 409  
**And** the session remains in active state

### Scenario: Bulk delete all completed sessions

**Given** a user has 5 completed workout sessions  
**When** they DELETE `/workout-sessions`  
**Then** all 5 are deleted  
**And** the response includes a count of 5

### Scenario: Bulk delete with no sessions

**Given** a user has zero workout sessions  
**When** they DELETE `/workout-sessions`  
**Then** the response returns success with count 0

### Scenario: Bulk delete fails with active sessions

**Given** a user has 3 completed and 1 active session  
**When** they DELETE `/workout-sessions`  
**Then** the system returns 409  
**And** no sessions are deleted

### Scenario: Deletion cascades to exercises and sets

**Given** a completed session with 3 exercises and 15 set records  
**When** the session is deleted  
**Then** the session, its exercises, and all set records are removed  
**And** no orphaned rows remain

## Out of Scope

- Soft delete or trash/recovery
- Scheduled or automatic deletion (retention policy)
- Delete individual exercises or set records independently
- Delete workout plans or plan specs
- GDPR export-before-delete flow
