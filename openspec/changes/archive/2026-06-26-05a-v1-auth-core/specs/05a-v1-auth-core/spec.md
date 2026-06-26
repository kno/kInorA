# Delta for 05a-v1-auth-core

## ADDED Requirements

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
