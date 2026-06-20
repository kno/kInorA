# 10a-v1-user-memory-structured Specification

## Purpose

Persist editable user profile, training preferences, plan data, and workout history as structured tenant-scoped data.

## Dependencies

- `01c-v1-multi-tenant-schema`
- `05b-v1-security-tenant-validation`

## Requirements

### Requirement: Structured Editable Memory

The system MUST provide CRUD operations for user profile, training preferences, workout settings, and plan data.

#### Scenario: Update user profile

- GIVEN a logged-in user
- WHEN they update name, goal, or experience level
- THEN the changes are saved and returned on the next profile read

### Requirement: User-Controlled Deletion

The user MUST be able to delete structured memory entries they own where deletion is legally and functionally allowed.

#### Scenario: Delete workout history entry

- GIVEN a user with completed sessions
- WHEN they delete a specific session
- THEN it no longer appears in history

### Requirement: Tenant-Scoped Structured Memory

Structured memory MUST be scoped by tenant id and user id.

#### Scenario: Cross-user data excluded

- GIVEN user A and user B in different tenants
- WHEN user B reads profile memory
- THEN user A's records are not returned
