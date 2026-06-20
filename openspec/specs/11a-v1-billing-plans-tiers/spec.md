# 11a-v1-billing-plans-tiers Specification

## Purpose

Define launch billing tiers, 30-day Pro trial behavior, feature gating, and upgrade prompts without external payment dependency.

## Dependencies

- `05b-v1-security-tenant-validation`

## Requirements

### Requirement: Plan Tiers

The system MUST support Free and Pro tiers with explicit feature gating.

#### Scenario: Free tier access

- GIVEN a newly registered user
- WHEN they access the app
- THEN basic features are available and premium features show upgrade prompts

### Requirement: Trial Period

New users MUST receive a 30-day Pro trial that auto-expires without requiring cancellation.

#### Scenario: Trial expiration

- GIVEN a user's 30-day trial has ended
- WHEN they access a premium feature
- THEN they see a subscribe-to-continue message and the feature is blocked

### Requirement: Billing State Visibility

The UI SHOULD show the user's current tier and trial state.

#### Scenario: Active trial badge

- GIVEN a user is inside the 30-day trial
- WHEN they open the account area
- THEN the remaining trial state is visible
