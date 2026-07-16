# 100a-shared-i18n-catalog Specification

## Purpose

A shared `@kinora/i18n` package holding EN/ES ICU message catalogs as the single
source of truth, with a parity/validation guard and generated message-key types
consumed by both web and mobile. Concrete package/build tooling choices are
deferred to design; this spec constrains observable behavior only.

## Requirements

### Requirement: EN/ES Catalogs Are the Single Source of Truth

The system MUST expose one shared package holding EN and ES message catalogs
in ICU MessageFormat syntax. Web and mobile MUST consume these catalogs rather
than maintaining independent copies.

#### Scenario: Catalog consumed by both runtimes

- GIVEN a message key exists in the shared catalog
- WHEN web or mobile renders that key
- THEN both resolve the same underlying ICU message text for a given locale

### Requirement: Key Parity Guard

The system MUST provide an automated guard that fails when the EN and ES
catalogs do not contain identical key sets.

#### Scenario: Missing key in one locale fails the guard

- GIVEN a key exists in `en.json` but not in `es.json`
- WHEN the parity guard runs
- THEN it fails and reports the missing key and locale

#### Scenario: Identical key sets pass

- GIVEN `en.json` and `es.json` contain the same set of keys
- WHEN the parity guard runs
- THEN it passes

### Requirement: Non-Empty Value Validation

The system MUST fail the guard when any catalog entry has an empty or
whitespace-only message value.

#### Scenario: Empty value fails the guard

- GIVEN a key in either catalog has an empty string value
- WHEN the parity guard runs
- THEN it fails and identifies the offending key and locale

### Requirement: ICU Argument Parity

The system MUST fail the guard when the same key defines different sets of
ICU arguments (interpolation variables, plural/select argument names) across
locales.

#### Scenario: Mismatched ICU args between locales fails

- GIVEN key `sets.count` takes argument `{count}` in `en.json` but argument
  `{total}` in `es.json`
- WHEN the parity guard runs
- THEN it fails and reports the argument mismatch for that key

#### Scenario: Matching ICU args pass

- GIVEN key `sets.count` uses argument `{count}` in both `en.json` and `es.json`
- WHEN the parity guard runs
- THEN it passes for that key

### Requirement: Generated Message-Key Types

The system MUST generate a type representing the set of valid message keys
from the catalogs, and consuming code MUST reference keys through this
generated type rather than raw strings.

#### Scenario: Unknown key is a type error at consumer build

- GIVEN a consumer references a message key that does not exist in the catalog
- WHEN the consumer's project is type-checked or built
- THEN the build fails with a type error identifying the invalid key

#### Scenario: Valid key type-checks

- GIVEN a consumer references a message key present in the catalog
- WHEN the consumer's project is type-checked
- THEN no error is raised for that key reference

### Requirement: Catalog-Driven Locale Extensibility

The infra MUST support adding a future locale by adding a new catalog file
and MUST NOT require code changes in web or mobile consumers to support an
additional locale's catalog structure.

#### Scenario: New locale catalog added without consumer code changes

- GIVEN a new locale catalog file with full key parity is added to the shared
  package
- WHEN the package is rebuilt
- THEN existing consumer code compiles and runs without modification (locale
  registration/wiring in the runtime layer is out of scope for this
  guarantee)
