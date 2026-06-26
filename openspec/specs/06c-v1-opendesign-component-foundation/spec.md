# 06c-v1-opendesign-component-foundation Specification

## Purpose

Create a more faithful bridge between the latest Open Design source and the production web app before feature work continues with the plan wizard.

This spec refreshes the local design reference, imports the standard icon set, and establishes reusable visual components so later screens can be implemented from shared primitives instead of inventing one-off UI each time.

## Requirements

### Requirement: Latest Open Design Refresh

The project MUST verify live Open Design access for `kiNorA` project `ceeff5f6-0930-4e48-a0b0-17a6a5c9b9ad` and refresh `docs/open-design/kinora/` from that source before new product-screen work proceeds. Stale local snapshots MUST NOT substitute for unavailable source access.
(Previously: required refreshing the snapshot, but did not make live-source verification or stale-snapshot blocking explicit.)

#### Scenario: Open Design source is synchronized

- GIVEN the live Open Design source is reachable
- WHEN this spec is implemented
- THEN the local snapshot is refreshed under `docs/open-design/kinora/`
- AND the refresh records the source project and retrieval evidence

#### Scenario: Design source is unavailable

- GIVEN live Open Design source access cannot be verified
- WHEN implementation attempts to refresh the snapshot
- THEN implementation is blocked with the dependency documented

#### Scenario: Design changes are traceable

- GIVEN refreshed artifacts enter the repository
- WHEN reviewers inspect the change
- THEN imported screens, icons, and component references are identifiable

### Requirement: Standard Icon Foundation

The web app MUST expose shared icons through one app-level foundation that can include imported Open Design SVGs and wrapped approved library icons with consistent names, size, stroke/fill behavior, and accessibility defaults.
(Previously: required a standard icon foundation, but did not allow both imported SVG and wrapped library sources explicitly.)

#### Scenario: Icons are imported consistently

- GIVEN navigation, action, status, or feature icons are needed
- WHEN icons are brought into code
- THEN consumers import them only from the shared foundation

#### Scenario: Icon import friction is removed

- GIVEN future screens need known design-reference icons
- WHEN a developer implements those screens
- THEN existing icon exports are reused before adding new raw SVGs or direct library imports

### Requirement: Reusable Visual Component Base

The web app MUST provide reusable Orbit primitives for recurring patterns visible across implemented screens and refreshed Open Design references, including cards, section headers, metric blocks, navigation affordances, empty states, and CTA surfaces.
(Previously: listed upcoming patterns without tying scope to implemented screens plus refreshed references.)

#### Scenario: Common visual patterns have primitives

- GIVEN a recurring Orbit pattern appears in source screens
- WHEN this spec is implemented
- THEN a reusable primitive or usage guide exists for that pattern

#### Scenario: Feature screens do not invent visual primitives

- GIVEN later specs need standard Orbit UI elements
- WHEN those screens are implemented
- THEN they reuse the foundation or document a justified deviation

### Requirement: Design Guidance and Deviation Record

The visual foundation MUST guide future screens toward pixel-aligned Orbit usage and MUST document any deviation with reason, impact, and follow-up.
(Previously: focused on pixel-perfect alignment but did not require reusable guidance for future screens.)

#### Scenario: Future screen guidance is available

- GIVEN a later screen uses Orbit primitives or icons
- WHEN developers review the foundation
- THEN guidance explains intended usage and source-design alignment

#### Scenario: Deviations are explicit

- GIVEN an exact design match is impractical
- WHEN a deviation is introduced
- THEN the deviation record states reason, visual impact, and follow-up

### Requirement: Scoped Foundation Only

This spec MUST prepare visual foundations only and MUST NOT implement product behavior for plan creation, AI generation, workout tracking, progress analytics, billing, memory, or conversational flows.
(Previously: excluded product behavior, but less explicitly separated foundation proof from feature behavior.)

#### Scenario: Product behavior remains in later specs

- GIVEN icons, primitives, or guidance are added
- WHEN implementation is complete
- THEN no later-spec product workflow is made functional

#### Scenario: Foundation proof stays visual

- GIVEN an existing screen is updated to prove the foundation
- WHEN reviewers inspect behavior
- THEN user-facing product capabilities remain unchanged
