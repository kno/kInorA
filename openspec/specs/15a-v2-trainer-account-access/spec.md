# 15a-v2-trainer-account-access Specification

## Purpose

Enable Trainer accounts, client assignment, and trainer-scoped permissions.

## Dependencies

- `01c-v1-multi-tenant-schema`
- `05b-v1-security-tenant-validation`

## Requirements

### Requirement: Trainer Account Type

The system MUST support a Trainer account tier distinct from Free and Pro.

#### Scenario: Trainer registration

- GIVEN a user selects Register as Trainer
- WHEN onboarding completes
- THEN their account receives trainer permissions

### Requirement: Client Assignment

Trainers MUST only manage clients assigned to them within the active tenant.

#### Scenario: Trainer sees own clients only

- GIVEN trainer T1 and trainer T2 have different clients
- WHEN T1 views the client list
- THEN only T1's assigned clients appear

### Requirement: Client Plan Assignment

Trainers MUST be able to assign plans to specific clients.

#### Scenario: Trainer creates client plan

- GIVEN a trainer with 3 clients
- WHEN they create a plan for client A
- THEN only client A can see and execute that plan
