# 100b-web-i18n-runtime Specification

## Purpose

Web renders all localized copy through an ICU-capable i18n runtime consuming
the shared `@kinora/i18n` catalogs, fully replacing the home-grown
prop-drilled `messages` + local `t(key, fallback)` + manual `.replace()`
approach, while preserving today's locale-resolution behavior.

## Requirements

### Requirement: Full ICU Support

The web runtime MUST support ICU interpolation, plural selection, select
(gender/variant) branching, and locale-aware number and date formatting as
first-class primitives.

#### Scenario: Interpolated value renders

- GIVEN a message `"Hola {name}"` and `name = "Ana"`
- WHEN the message is rendered
- THEN the output is `"Hola Ana"`

#### Scenario: Plural selection

- GIVEN a message defining ICU plural forms for a `count` argument
- WHEN rendered with `count = 1`
- THEN the singular form is used (e.g. "1 serie")
- WHEN rendered with `count = 3`
- THEN the plural form is used (e.g. "3 series")

#### Scenario: Select branch

- GIVEN a message using ICU `select` with a `status` argument
- WHEN rendered with `status = "ready"`
- THEN the branch mapped to `"ready"` is used

#### Scenario: Locale-aware number and date formatting

- GIVEN a numeric or date value and the active locale is `es`
- WHEN the value is formatted through the runtime's formatter
- THEN the output follows `es` locale conventions (vs `en` conventions when
  the active locale is `en`)

### Requirement: Locale Resolution Unchanged

Locale resolution MUST preserve today's precedence exactly: `?lang=` query
parameter first, then `Accept-Language` header, then EN as the final
fallback. Switching the underlying runtime MUST NOT alter this precedence or
its observable outcome for any existing request shape.

#### Scenario: ?lang= overrides Accept-Language

- GIVEN a request has `Accept-Language: en` and query param `?lang=es`
- WHEN the page resolves the active locale
- THEN the resolved locale is `es`

#### Scenario: Accept-Language used when no query param

- GIVEN a request has no `?lang=` param and `Accept-Language: es`
- WHEN the page resolves the active locale
- THEN the resolved locale is `es`

#### Scenario: EN fallback when neither is present or recognized

- GIVEN a request has no `?lang=` param and no usable `Accept-Language` value
- WHEN the page resolves the active locale
- THEN the resolved locale is `en`

### Requirement: No Home-Grown Interpolation or Local t() Closures Remain

Zero manual `.replace()`-based interpolation sites and zero locally
redefined `t(key, fallback) = messages[key] ?? fallback` closures MUST remain
in the web app after migration. All localized rendering MUST go through the
shared ICU runtime.

#### Scenario: No manual replace-based interpolation remains

- GIVEN the web codebase after migration
- WHEN searched for manual string-interpolation-via-replace patterns used for
  localized copy
- THEN none are found

#### Scenario: No local t(key, fallback) closures remain

- GIVEN the web codebase after migration
- WHEN searched for locally redefined translation-lookup-with-fallback
  closures
- THEN none are found; all lookups go through the shared runtime's
  translation function

### Requirement: Server and Client Component Access

Both server components and client components MUST be able to access
localized messages and formatters through the runtime, respecting the
framework's server/client boundary.

#### Scenario: Server component renders localized copy

- GIVEN a server component needs a localized string
- WHEN it renders
- THEN it obtains the string via the runtime without requiring client-side
  hydration

#### Scenario: Client component renders localized copy

- GIVEN a client component needs a localized string (e.g. inside an
  interactive form)
- WHEN it renders
- THEN it obtains the string via the runtime's client-safe API

### Requirement: Missing Key Fallback

When a message key is missing for the resolved locale, the runtime MUST fall
back to the EN catalog value rather than rendering a raw key or crashing.

#### Scenario: Missing ES key falls back to EN

- GIVEN a key exists in `en.json` but is (transiently) absent from the active
  `es.json` build
- WHEN the message is rendered under locale `es`
- THEN the EN value is rendered instead of the raw key or an error
