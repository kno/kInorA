# 06b-v1-orbit-ui-shell Specification

## Purpose

Apply the selected Orbit brand direction and establish the first implementation pass for the public landing page, responsive app shell, navigation structure, and non-functional screen scaffolds from the Open Design snapshot.

This spec turns the design reference into reusable product surfaces without implementing data-backed behavior that belongs to later feature specs.

## Requirements

### Requirement: Orbit Design System Application

The application MUST apply the Orbit visual direction using the local Open Design source of truth for brand tokens, typography, spacing, dark-only surfaces, and accent usage.

#### Scenario: Orbit tokens are visible in the app shell

- GIVEN the app shell renders
- WHEN a user views it on desktop or mobile
- THEN the UI uses the Orbit dark canvas, surface hierarchy, typography, and lime accent rules from `docs/open-design-kinora.md`

#### Scenario: Light theme is not introduced

- GIVEN the default application theme loads
- WHEN any scaffolded v1 screen renders
- THEN it remains dark-only unless a later accepted spec changes that contract

### Requirement: Public Landing Page

The web application MUST include a public landing page aligned with the Open Design landing screen structure: hero, core benefits, how it works, pricing entry points, call to action, and footer.

#### Scenario: Visitor sees launch positioning

- GIVEN an unauthenticated visitor opens the root route
- WHEN the landing page renders
- THEN it presents kInorA's AI-personalized training value proposition and routes the visitor toward account creation or sign-in

### Requirement: Responsive App Shell and Navigation

Authenticated app surfaces MUST share a responsive shell that supports desktop sidebar navigation and mobile bottom navigation for the primary v1 areas.

#### Scenario: Desktop navigation exposes primary areas

- GIVEN an authenticated user on a desktop viewport
- WHEN the app shell renders
- THEN sidebar navigation exposes dashboard, plan, statistics, and plan creation destinations

#### Scenario: Mobile navigation exposes primary areas

- GIVEN an authenticated user on a mobile viewport
- WHEN the app shell renders
- THEN bottom navigation exposes the main mobile destinations with accessible hit targets

### Requirement: Non-Functional Screen Scaffolds

The application SHOULD provide non-functional scaffolds for Open Design screens whose data or behavior is delivered by later specs.

#### Scenario: Later feature surfaces have stable destinations

- GIVEN a user navigates to a scaffolded dashboard, weekly plan, statistics, create-plan, exercise detail, or tracker surface before its backing feature is complete
- WHEN the screen renders
- THEN it shows the correct shell, layout, and placeholder state without pretending that unavailable data or actions are functional
