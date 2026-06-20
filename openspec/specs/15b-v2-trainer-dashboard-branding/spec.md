# 15b-v2-trainer-dashboard-branding Specification

## Purpose

Provide trainer dashboards, progress views, and branded plans after trainer access exists.

## Dependencies

- `15a-v2-trainer-account-access`

## Requirements

### Requirement: Client Progress Dashboard

Trainers MUST be able to view assigned client progress, adherence, and workout history.

#### Scenario: View client adherence

- GIVEN a trainer assigned to client A
- WHEN they open the client dashboard
- THEN completion rate, recent sessions, and RPE trends are shown

### Requirement: Branded Plans

Trainers MAY create plans with custom branding visible to their clients.

#### Scenario: Branded plan appears to client

- GIVEN a trainer creates a branded plan
- WHEN the client opens the plan
- THEN the trainer name, custom title, and colors are displayed

### Requirement: Tenant-Safe Dashboard Data

Trainer dashboards MUST NOT aggregate data from outside the active tenant.

#### Scenario: Other tenant excluded

- GIVEN a trainer belongs to tenant A
- WHEN dashboard metrics load
- THEN tenant B clients are excluded
