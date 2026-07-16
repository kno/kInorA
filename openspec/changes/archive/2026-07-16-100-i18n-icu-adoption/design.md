# Design: Adopt ICU-Based i18n (next-intl + shared catalogs)

> Revision 3 — supersedes rev2 (Engram #1836). Adds the migration of orphan
> page-level catalog consumers (new Web cluster-C slice), extends the cleanup
> gate to grep for `messages.*`/`resolvePageI18n`/`loadMessages`, corrects the
> false "pages hardcode English" risk line, scopes the middleware matcher +
> header anti-spoofing, and recounts the true web surface. Spec unchanged.
> Rev2 carry-over kept as-is: C1 header mechanism, tracker-subtree atomic
> slice, `select`+date, deep-merge EN fallback.

## Technical Approach

Stand up `@kinora/i18n` as the single source of truth: **nested JSON** ICU
catalogs (next-intl native shape), a parity/ICU-arg guard, one
`flattenMessages()` transform (load-bearing invariant), and generated key
types. Web binds via **next-intl@^4.13.1** in "without i18n routing" mode
(peers `next ^16` / `react ^19` — matches repo `next 16.2.9` / `react 19.2.7`).
Mobile binds via **react-intl@^10.1.14** (FormatJS) — same ICU engine, catalogs
shared, flattened to `id→string` at the mobile boundary. Delivered as
stacked-to-main chained PRs, each green and ≤~400 lines.

## Architecture Decisions

### Decision: `?lang=` resolution under next-intl (C1 — carried from rev2)

`getRequestConfig` **cannot** read `searchParams` — only cookies/headers.
Today `?lang=` is resolved per-page from `searchParams` via `resolvePageI18n`
(`request.ts:43`) across the orphan pages; landing + root `layout.tsx` read
headers directly.

**Choice**: Add `apps/web/src/middleware.ts` that reads `?lang=` from the
request URL and **injects it as a per-request header** (`x-kinora-lang`) via
`NextResponse.next({ request: { headers } })`. `getRequestConfig` then calls the
EXISTING `resolveLocale(acceptLanguage, xLangHeader)` from `locale.ts` verbatim,
preserving precedence including the invalid-`?lang=` short-circuit to EN
(`locale.ts:47`). **Anti-spoofing**: when `?lang=` is ABSENT the middleware
actively **DELETES** any client-supplied `x-kinora-lang` header on the forwarded
request, so bare requests fall to Accept-Language and a spoofed header cannot
override it. **Scope**: `config.matcher` excludes `/_next/*`, static assets, and
`/api/*` so middleware never runs on asset/API requests (per next-intl guidance).

**Alternatives rejected**: (a) cookie — stateful; a bare request after
`?lang=es` would resolve `es` from the cookie instead of Accept-Language,
violating spec 100b "MUST NOT alter observable outcome for any existing request
shape." (b) per-page resolution — provider needs the locale at the layout
boundary, not per-page.

**Rationale**: Stateless (per-request, never persisted), reuses `resolveLocale`
unchanged, reproduces today's precedence exactly.

### Decision: Missing-key EN fallback (carried from rev2)

`loadMessages` returns `{...EN, ...locale}` (per-key EN fallback); next-intl does
NOT auto-merge across locales.

**Choice**: `getRequestConfig` returns a **deep-merged** catalog
`mergeWithBase(en, catalog[locale])` (deep — catalogs are nested; a shallow
spread drops whole namespaces). Util lives in `@kinora/i18n`. Set `onError` to
swallow `MISSING_MESSAGE` gracefully. The cleanup slice retires `loadMessages`
but the fallback **moves into** `getRequestConfig` — it is NOT deleted. Mobile
mirrors: `defaultLocale="en"` on `IntlProvider` + `mergeWithBase(en, active)` at
the `flattenMessages` boundary.

### Other decisions (unchanged, condensed)

| Decision | Choice | Rejected | Rationale |
|---|---|---|---|
| Web runtime | next-intl@^4.13.1 no-routing | raw @formatjs; `[locale]` routing | Native App Router server+client; no URL churn |
| Mobile runtime | react-intl@^10.1.14 | i18n-js; Lingui | Same MessageFormat engine → plural/select parity |
| Canonical shape | Nested JSON, no dots in keys | flat canonical | next-intl native; one `flattenMessages` serves react-intl |
| Type gen | next-intl `AppConfig.Messages` (web) + flat-key union (mobile) | manual enums | Unknown key = build error |
| RN polyfill | none default; on-device Hermes plural check gates `@formatjs/intl-pluralrules`+`intl-locale` | always ship | Avoid bloat; Hermes plural completeness unverified |

## Render Graph (tracker subtree — carried from rev2)

    plan/page.tsx (server)                     plan/[id]/page.tsx (server)
      ├─ PlanSelector (client)                  └─ PlanStatusClient (client)
      ├─ PlanStatusView (failed branch)              ├─ PlanStatusView
      └─ PlanWeekView (server)                       └─ TrackerPanel ◄─┐ SHARED
           └─ PlanTrackerClient (client)                               │
                ├─ DayDetailPanel (client)                             │
                └─ TrackerPanel ◄──────────────────────────────────────┘
                     └─ t drilled to 7 children (Topbar, SessionProgress,
                        ExerciseCard, RestRing, NextExercisePreview,
                        Timeline, PerformanceRail)

`TrackerPanel` (+7 children) is shared across both parents → migrates atomically
with BOTH parents (else a dangling `messages`/`t` prop breaks type-check).

## True Web Migration Surface (recounted, incl. cluster C)

**≈40 rendering/component files** + 4 infra-wiring files. Rev2 undercounted at
~24 because it omitted (a) the 8 orphan pages + 7 landing children (**cluster
C**, 15 files) and (b) `create-plan/page.tsx` (server `resolvePageI18n`
threader, now folded into the wizard slice). Breakdown:

- **Infra (4):** middleware.ts, request.ts, next.config.ts, layout.tsx.
- **14 local `t`/`messages` closures:** StepperShell, FrequencyStep, DurationStep,
  EquipmentStep, LimitationsStep, GoalStep, LocationStep, PlanStatusView,
  PlanStatusClient, PlanWeekView, PlanSelector, TrackerPanel, PlanTrackerClient,
  DayDetailPanel.
- **3 server threaders (NOT closures):** plan/page.tsx, plan/[id]/page.tsx,
  create-plan/page.tsx — they resolve+thread `messages`, define no `t`.
- **7 prop-drilled tracker children:** Topbar, SessionProgress, ExerciseCard,
  RestRing, NextExercisePreview, Timeline, PerformanceRail.
- **Cluster C (15):** 8 pages (landing `page.tsx`, login, sign-up, dashboard,
  profile, exercises, stats, offline) + 7 landing children that consume the
  `messages` prop (LandingNav, LandingHero, LandingHowItWorks, LandingFeatures,
  LandingPricing, LandingCTA, LandingFooter). `LandingCinemaBand`, `LandingTrust`,
  `LandingNavClient` receive already-resolved strings/arrays → NOT migrated.
- Plus `tracker-model.ts` (drop `Translate` type). `.replace()` = 32 sites / 14
  files (subset of the above).

## Corrected Slice Table (stacked-to-main; each type-check green)

| # | Slice | Files (LOC) | Atomicity / risk |
|---|---|---|---|
| 1 | `@kinora/i18n` machinery: `flattenMessages`, `mergeWithBase`, parity/ICU-arg guard, type-gen vs sample catalog | packages/i18n/src/{flatten,merge,types,index}.ts + `__tests__` (~180) | Prove transform+guard+merge before data |
| 2 | Catalog migration: 325 flat→nested, 18 ICU (interp + plural + ≥1 `select`) | packages/i18n/src/messages/{en,es}.json (~300) | Data-heavy, run through proven guard |
| 3 | Web foundation: install next-intl, NEW `middleware.ts` (`?lang=`→header, **`config.matcher` excl `/_next`/assets/`/api`, DELETE spoofed header when no `?lang=`**), `request.ts` `getRequestConfig` (header→Accept-Language→EN + `mergeWithBase` + onError), `next.config` plugin, root `NextIntlClientProvider`. Test: `?lang=es` over `en` Accept-Language | middleware.ts, request.ts, next.config.ts, layout.tsx (~210) | Framework wiring; no call-site change |
| 4 | **Tracker subtree (shared)**: TrackerPanel + 7 children → `useTranslations`/`useFormatter`; drop `tracker-model` `Translate`; EDIT PlanTrackerClient + PlanStatusClient to stop passing `messages` to TrackerPanel | TrackerPanel, TrackerTopbar, SessionProgress, ExerciseCard, RestRing, NextExercisePreview, Timeline, PerformanceRail, tracker-model.ts, PlanTrackerClient*, PlanStatusClient* (~260) | Shared node → both parents move together |
| 5 | **Plan shell**: plan/page + plan/[id]/page → `getTranslations` (drop `loadMessages` threading); PlanWeekView → `getTranslations`; PlanTrackerClient + PlanStatusClient own `t`→`useTranslations` (drop `messages` prop + stop drilling to DayDetailPanel/PlanStatusView); DayDetailPanel → `useTranslations`; PlanStatusView → `use client` + `useTranslations`; **PlanSelector → `useFormatter().dateTime` (Gap1 date) + ICU `select` on plan `status`** | plan/page, plan/[id]/page, PlanWeekView, PlanTrackerClient, PlanStatusClient, DayDetailPanel, PlanStatusView, PlanSelector (~290) | Removing `messages` prop forces parents same slice |
| 6 | Wizard + create-plan: **create-plan/page.tsx** (`resolvePageI18n` threader → `getTranslations`, drop `messages` prop) + StepperShell + 6 steps → `useTranslations`; plural for `frequency.days`/`duration.min` | create-plan/page.tsx, StepperShell, FrequencyStep, DurationStep, EquipmentStep, LimitationsStep, GoalStep, LocationStep (~230) | Server threader + client stepper move together |
| 7 | **Web cluster C: app-level pages** (NEW): 8 orphan pages → `getTranslations` (server) — landing `page.tsx`, login, sign-up, dashboard, profile, exercises, stats, offline; 7 landing children (`LandingNav`→child `LandingNavClient` keeps plain-string props, `LandingHero`, `LandingHowItWorks`, `LandingFeatures`, `LandingPricing`, `LandingCTA`, `LandingFooter`) → `getTranslations`, drop `messages` prop. `useFormatter` where any number/date exists. Verify each file's server/client status before assigning the API | page.tsx, (auth)/login/page, (auth)/sign-up/page, dashboard/page, profile/page, exercises/page, stats/page, offline/page, LandingNav, LandingHero, LandingHowItWorks, LandingFeatures, LandingPricing, LandingCTA, LandingFooter (~260) | Must land BEFORE cleanup retires `loadMessages`/`resolvePageI18n` |
| 8 | **Web cleanup (point of no return, LAST web slice)**: full-codebase grep MUST show ZERO residual `messages.*` catalog access, `resolvePageI18n`, `loadMessages`, `.replace()` i18n sites, AND local `t()` closures before deletion. Only then delete old `messages/{en,es}.json`, retire `loadMessages`, `resolvePageI18n`. KEEP `resolveLocale` (used by middleware) and `mergeWithBase` EN fallback (now in `getRequestConfig`) | locale.ts, request.ts, old JSON (~small) | Dead-code only after ALL sites migrate |
| 9 | Mobile foundation: `IntlProvider` in App.tsx above NavigationContainer + `flattenMessages`/`mergeWithBase` boundary + `defaultLocale="en"` + locale context/switch. **AUTHOR ~30 mobile-unique tracker strings as NEW EN+ES keys in `@kinora/i18n`; expand parity guard** (+1 screen proof) | App.tsx, i18n provider, catalog additions, 1 screen (~220) | Green-field infra + authoring |
| 10 | Mobile tracker migration: WorkoutTrackerScreen + tracker components → `useIntl`/`FormattedMessage`/`FormattedNumber`/`FormattedDate`/`{select}`; retire `copy/tracker.ts`; on-device Hermes plural check + polyfill decision. Tests exercise select + number/date + plural (SC#3) | copy/tracker.ts, screens/* (~210) | Isolates Hermes/plural uncertainty |

## Catalog: ICU conversions (incl. Gap 1 `select`)

Namespaces by first segment (nav, hero, …, plan, tracker, wizard). 18
placeholder keys → ICU. Count-bearing → `{n, plural, one{} other{}}`
(`wizard.frequency.days`, `wizard.duration.min`, `tracker.next.sets`,
`tracker.timeline.meta.done/pending`). Plain interpolation stays
(`tracker.progress.label "Exercise {n} of {m}"`). **New `select`**:
`plan.selector.option` gains `{status, select, ready{} generating{} failed{}
other{}}` (replaces the `{date} ({status})` `.replace()` at PlanSelector.tsx:71-76).
**Number/date**: PlanSelector date via `useFormatter().dateTime`; mobile via
`<FormattedDate>`/`<FormattedNumber>`.

## Testing Strategy

| Layer | What | How |
|---|---|---|
| Unit | flatten, mergeWithBase, parity/ICU-arg guard, key types | vitest (packages/i18n) |
| Integration | `?lang=es` over `en` Accept-Language; invalid `?lang=`→EN; spoofed `x-kinora-lang` w/o `?lang=`→Accept-Language; missing-key EN fallback; no cross-locale bleed | vitest + @testing-library/react |
| Integration | `select` + number/date render both runtimes; plural parity web↔mobile | vitest |
| Manual | on-device Hermes plural check | Expo simulator |

## Risks

| Risk | Sev | Mitigation |
|---|---|---|
| Middleware header injection visible to `getRequestConfig` same request | Med | VALIDATE at apply: assert injected header reaches `headers()`; render both locales same URL, assert no memoization bleed |
| `NextIntlClientProvider` persists across soft navigations; a client nav changing only `?lang=` may serve STALE provider messages | Low | VALIDATE/known-limitation: no in-app language switcher today; `?lang=` is set on hard nav, so no live path hits this. Revisit if a switcher lands |
| `NextIntlClientProvider` ships full active-locale catalog (325+ keys) to every client bundle | Low | Acceptable at current size; future: namespace-split provider |
| Serwist precaches one `/offline` snapshot at one build/first-cache locale | Low | Accept (degraded offline) or make `/offline` locale-neutral; VALIDATE at apply |
| Mobile ~30 ES-only tracker strings have no EN equivalent | Med | Slice 9 AUTHORS new EN+ES keys + expands parity guard |
| Cluster-C pages/landing children currently carry inline `?? "…"` fallback literals (some ES defaults) | Info | These become dead once keys resolve via next-intl deep-merge EN fallback; slice 7 removes them. NOT a hardcoded-English surface — all these pages resolve the catalog today |
| Hermes `Intl.PluralRules` ES correctness (RN 0.79.5) | Med | On-device render gates polyfill (slice 10) |

## Review Workload

10 stacked-to-main PRs (one per slice), each type-check green and ≤~400 changed
lines. Largest web slices (4 tracker ~260, 5 plan ~290, 7 cluster-C ~260) stay
under the 400-line budget. `Decision needed before apply: No`. `Chained PRs
recommended: Yes` (stacked). `400-line budget risk: Low`. Slice 8 is the LAST
web slice and the sole point of no return.

## Open Questions (VALIDATE at apply) — RESOLVED at apply/verify

- [x] Middleware-injected `x-kinora-lang` header reliably reaches
      `getRequestConfig`'s `await headers()` in Next 16 Turbopack. VALIDATED
      (slice 3, tasks.md 3.3.2/3.3.3): confirmed under both Turbopack dev and
      `next build --webpack` + `next start`.
- [ ] Hermes `Intl.PluralRules` ES output on RN 0.79.5. NOT VALIDATED —
      headless apply pass cannot exercise a real Hermes device/simulator.
      Deferred, tracked in issue #117 (see archive-report.md).
