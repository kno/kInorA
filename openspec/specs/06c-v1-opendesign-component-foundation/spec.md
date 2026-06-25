# 06c-v1-opendesign-component-foundation Specification

## Purpose

Create a more faithful bridge between the latest Open Design source and the production web app before feature work continues with the plan wizard.

This spec refreshes the local design reference, imports the standard icon set, and establishes reusable visual components so later screens can be implemented from shared primitives instead of inventing one-off UI each time.

## Requirements

### Requirement: Latest Open Design Refresh

The project MUST refresh the local Open Design snapshot for the selected `kiNorA` project before implementing new product screens.

#### Scenario: Open Design source is synchronized

- GIVEN the Open Design project contains newer Orbit screen updates
- WHEN this spec is implemented
- THEN the implementation process interacts with the Open Design MCP to fetch the latest visual artifacts and updates the local snapshot under `docs/open-design/kinora/`

#### Scenario: Design changes are traceable

- GIVEN refreshed design artifacts are brought into the repository
- WHEN reviewers inspect the change
- THEN the updated source files clearly show which Open Design screens, icons, or component references were imported

### Requirement: Standard Icon Foundation

The web app MUST establish a standard icon foundation that matches the Open Design reference and avoids ad-hoc icon imports.

#### Scenario: Icons are imported consistently

- GIVEN Open Design defines icons for navigation, actions, status indicators, and feature surfaces
- WHEN icons are brought into code
- THEN they are imported through a shared app-level icon foundation with consistent sizing, stroke/fill behavior, accessibility defaults, and naming

#### Scenario: Icon import friction is removed

- GIVEN future screens need icons from the design reference
- WHEN a developer implements those screens
- THEN they can reuse existing icon exports rather than copying raw SVGs, inventing replacements, or importing icons directly from unrelated sources

### Requirement: Reusable Visual Component Base

The web app MUST provide reusable standard components for the recurring Orbit visual patterns used by upcoming screens.

#### Scenario: Common visual patterns have primitives

- GIVEN future v1 screens require cards, section headers, metric blocks, navigation affordances, empty states, and call-to-action surfaces
- WHEN this spec is implemented
- THEN those patterns are available as reusable components aligned with the latest Open Design reference

#### Scenario: Feature screens do not invent visual primitives

- GIVEN `07-v1-plan-wizard` and later specs build product behavior
- WHEN they need standard Orbit UI elements
- THEN they reuse this component base instead of creating visually similar one-off components

### Requirement: Pixel-Perfect Design Alignment

The imported visual foundation MUST prioritize pixel-perfect alignment with the latest Open Design screens.

#### Scenario: Implementation matches design reference

- GIVEN a refreshed Open Design screen is used as the visual source of truth
- WHEN the corresponding component or icon foundation is implemented
- THEN spacing, sizing, radii, typography, color usage, icon weight, and responsive behavior match the design reference as closely as the web platform allows

#### Scenario: Deviations are explicit

- GIVEN an exact design match is not technically practical
- WHEN a deviation is introduced
- THEN it is documented with the reason, expected visual impact, and any follow-up needed to close the gap

### Requirement: Scoped Foundation Only

This spec MUST prepare the visual system for upcoming product screens without implementing the business behavior of those screens.

#### Scenario: Product behavior remains in later specs

- GIVEN this spec adds icons and reusable components
- WHEN the implementation is complete
- THEN it does not implement plan creation, AI generation, workout tracking, progress analytics, billing, or conversational flows beyond what is needed to prove the component foundation
