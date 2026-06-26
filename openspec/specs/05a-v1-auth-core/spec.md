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

### Requirement: Google-only Sign-up

The system MUST support Google-only sign-up. A new user authenticating via Google with a verified email SHALL have an account, owner tenant association, and session created without a password.

#### Scenario: Google-only sign-up creates account and session

- GIVEN a new user authenticates via Google with a verified email not associated with any existing account
- WHEN Google login succeeds
- THEN the system creates a new user account (no password)
- AND creates an owner tenant association
- AND issues a session

#### Scenario: Unverified Google email rejected for new user

- GIVEN a new user authenticates via Google with an email that Google has NOT marked as verified
- WHEN Google login succeeds
- THEN the system does NOT create an account
- AND does NOT issue a session
- AND returns an authentication error
