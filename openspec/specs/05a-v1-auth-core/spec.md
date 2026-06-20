# 05a-v1-auth-core Specification

## Purpose

Provide user authentication, sessions, and account linking for the launchable v1 application.

## Dependencies

- `01c-v1-multi-tenant-schema`

## Requirements

### Requirement: Email Authentication

The system MUST authenticate users with email and password and issue an application session.

#### Scenario: Email sign-up and login

- GIVEN a new user submits valid email and password
- WHEN registration succeeds
- THEN an account, tenant association, and session are created

### Requirement: OAuth Account Linking

The system MUST support Google OAuth and MUST link identities by verified email instead of creating duplicates.

#### Scenario: OAuth links existing account

- GIVEN an existing email/password user
- WHEN they authenticate via Google with the same verified email
- THEN the OAuth identity is linked to the existing account

### Requirement: Session Availability

Authenticated routes MUST receive user and tenant context from the active session.

#### Scenario: Session exposes tenant context

- GIVEN a logged-in user
- WHEN an authenticated route handles the request
- THEN it receives user id and tenant id from the session context
