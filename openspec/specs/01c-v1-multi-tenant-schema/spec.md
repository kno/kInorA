# 01c-v1-multi-tenant-schema Specification

## Purpose

Establish multi-tenancy from the first schema decision so future Trainer and B2B features do not require architectural rewrite.

## Dependencies

- `01a-v1-monorepo-setup`
- `01b-v1-clean-architecture-contracts`

## Requirements

### Requirement: Tenant-Scoped Data Model

All user-owned persisted data MUST include tenant scope from the first migration.

#### Scenario: Tenant field exists on user data

- GIVEN the first database migration is applied
- WHEN user-owned tables are inspected
- THEN each table has a required tenant scope column or documented tenant association

### Requirement: Tenant Provisioning

The system MUST create a tenant when a user signs up without an existing tenant context.

#### Scenario: New tenant creation

- GIVEN a first-time user registers
- WHEN account creation succeeds
- THEN a unique tenant is created and associated with the user

### Requirement: Tenant Query Contract

Every repository query for tenant-owned data MUST receive tenant context explicitly.

#### Scenario: Query without tenant rejected

- GIVEN a repository method for tenant-owned data
- WHEN it is called without tenant context
- THEN the call fails before reaching persistence
