# 01b-v1-clean-architecture-contracts Specification

## Purpose

Define Clean Architecture boundaries and shared contracts before feature code exists.

## Dependencies

- `01a-v1-monorepo-setup`

## Requirements

### Requirement: Layered Dependency Direction

The system SHOULD enforce dependency direction from outer layers toward inner layers: infrastructure/adapters MAY depend on use cases and domain, but domain MUST NOT depend on infrastructure.

#### Scenario: Layer violation fails

- GIVEN a domain file imports from an infrastructure package
- WHEN lint or build runs
- THEN the check MUST fail with a layer-boundary error

### Requirement: Shared Contracts

Shared data contracts MUST live in shared packages and MUST be usable by web, API, and mobile shell integrations.

#### Scenario: Contract reused by API and web

- GIVEN a `PlanSpec` contract is exported
- WHEN web submits a plan wizard payload and API validates it
- THEN both sides use the same contract shape

### Requirement: Domain Isolation

Domain entities and use cases MUST be testable without network, database, framework, or UI dependencies.

#### Scenario: Domain test runs in isolation

- GIVEN a use case test imports only domain and contract packages
- WHEN the unit test runs
- THEN no framework or database module is loaded
