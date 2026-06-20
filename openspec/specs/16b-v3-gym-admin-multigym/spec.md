# 16b-v3-gym-admin-multigym Specification

## Purpose

Enable gym administrators and enterprise customers to manage members, trainers, analytics, and multiple gym locations.

## Dependencies

- `16a-v3-gym-white-label`

## Requirements

### Requirement: Gym Tenant Administration

Gym administrators MUST be able to invite members, assign trainers, and configure plan defaults.

#### Scenario: Admin adds member

- GIVEN a gym admin dashboard
- WHEN the admin invites a member by email
- THEN the member is associated with the gym tenant after registration

### Requirement: Aggregate Usage Analytics

Gym administrators SHOULD see aggregate workouts, adherence, and active member counts for their tenant.

#### Scenario: Aggregate usage view

- GIVEN a gym has active members
- WHEN the admin views analytics
- THEN total workouts, average adherence, and active users are shown

### Requirement: Multi-Gym Context Switching

Enterprise admins MUST be able to switch between gym locations under one enterprise account.

#### Scenario: Switch between gyms

- GIVEN an enterprise admin manages 3 locations
- WHEN they switch gym context
- THEN members, trainers, and analytics update to that gym only
