# 100c-mobile-i18n-runtime Specification

## Purpose

Mobile renders EN and ES copy through an ICU-capable i18n runtime consuming
the SAME shared `@kinora/i18n` catalogs as web, via a provider mounted at the
app root, replacing the Spanish-only `trackerCopy` function-interpolation
approach with no existing i18n layer.

## Requirements

### Requirement: Shared Catalog Consumption

The mobile runtime MUST consume the same shared EN/ES ICU catalogs used by
web, not a separate or forked copy.

#### Scenario: Mobile and web render identical text for shared key

- GIVEN a message key exists in the shared catalog with the same arguments
- WHEN mobile and web each render that key with the same argument values and
  locale
- THEN both produce the same rendered text

### Requirement: App-Root Provider

The mobile app MUST mount an i18n provider at the app root so all screens
can access localized messages without manual prop-drilling.

#### Scenario: Deeply nested screen accesses translations without prop-drilling

- GIVEN the provider is mounted at the app root
- WHEN a screen several levels deep in the navigation tree needs a localized
  string
- THEN it accesses the translation function/hook directly, without receiving
  messages as a prop from its parent

### Requirement: Runtime Locale Switching

The app MUST expose a locale switch that changes the active locale at
runtime without requiring an app restart.

#### Scenario: Switch locale at runtime re-renders copy

- GIVEN the app is running with locale `es`
- WHEN the user switches the locale to `en`
- THEN visible screen copy re-renders in English without an app restart

### Requirement: EN Support Added

The app MUST render fully in EN, in addition to ES. Previously EN was
unsupported (ES-only).

#### Scenario: EN added (was Spanish-only)

- GIVEN the app previously supported only Spanish copy
- WHEN the locale is set to `en`
- THEN all `trackerCopy`-sourced UI text renders in English

### Requirement: Full ICU Support

The mobile runtime MUST support ICU interpolation and plural selection with
parity to web's behavior.

#### Scenario: Interpolation parity with web

- GIVEN a message `"Serie {current} de {total}"` with `current = 2, total = 4`
- WHEN rendered on mobile under locale `en`
- THEN the output matches what web would render for the equivalent key and
  arguments

#### Scenario: Plural parity with web

- GIVEN a message defining ICU plural forms for a `count` argument
- WHEN rendered on mobile with `count = 1` and with `count = 3`
- THEN the singular/plural forms selected match the forms web would select
  for the same values

### Requirement: trackerCopy Served Through the Runtime

All content previously hardcoded in `apps/mobile/src/copy/tracker.ts` MUST be
served through the shared i18n runtime rather than local Spanish-only
constants or ad hoc function interpolation.

#### Scenario: Tracker screen renders copy from the runtime

- GIVEN the workout tracker screen needs a status label
- WHEN it renders
- THEN the label is obtained via the i18n runtime from the shared catalog,
  not from a local hardcoded constant
