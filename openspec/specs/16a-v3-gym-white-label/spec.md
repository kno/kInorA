# 16a-v3-gym-white-label Specification

## Purpose

Provide white-label branding for gym tenants through configurable logo, colors, and domain identity.

## Dependencies

- `15b-v2-trainer-dashboard-branding`

## Requirements

### Requirement: Gym Branding Configuration

Gym tenants MUST be able to configure logo, colors, and domain/subdomain branding.

#### Scenario: Gym-branded login page

- GIVEN a white-labeled gym tenant has custom branding
- WHEN a member visits the gym subdomain
- THEN the login page shows gym logo, colors, and domain identity

### Requirement: Default Branding Fallback

The system MUST fall back to kInorA branding when a gym has no custom branding.

#### Scenario: Default branding fallback

- GIVEN a gym has no branding configured
- WHEN a member visits
- THEN default kInorA branding is displayed

### Requirement: Branding Tenant Isolation

Branding configuration MUST apply only to the owning gym tenant.

#### Scenario: Other gym branding excluded

- GIVEN gym A and gym B have different branding
- WHEN a gym A member visits
- THEN gym B branding is never displayed
