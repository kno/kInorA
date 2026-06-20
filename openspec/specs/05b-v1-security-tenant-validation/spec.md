# 05b-v1-security-tenant-validation Specification

## Purpose

Enforce security by design through tenant isolation, input validation, and safe authorization defaults.

## Dependencies

- `01c-v1-multi-tenant-schema`
- `05a-v1-auth-core`

## Requirements

### Requirement: Tenant Isolation Enforcement

Every authenticated request MUST be scoped to the active tenant, and cross-tenant access MUST be rejected.

#### Scenario: Cross-tenant access rejected

- GIVEN tenant A user and tenant B resource id
- WHEN tenant A requests tenant B's resource
- THEN the system returns HTTP 403 Forbidden

### Requirement: Boundary Validation

Every public API endpoint MUST validate body, query, and params before executing use cases.

#### Scenario: Invalid input rejected

- GIVEN a request missing required fields
- WHEN it reaches the API boundary
- THEN the response is HTTP 422 with a descriptive error payload

### Requirement: Secure Defaults

Unauthenticated or ambiguous requests MUST fail closed rather than exposing data.

#### Scenario: Missing session rejected

- GIVEN a protected endpoint
- WHEN the request has no valid session
- THEN the response is HTTP 401 and no tenant data is queried
