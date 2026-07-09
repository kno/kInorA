# Tasks: Adopt ICU-Based i18n (next-intl + shared catalogs) (Change 100)

> Rewritten from REVISED design (revision 3, supersedes Engram #1846 rev-2
> tasks). Slice count grows 9 → 10: inserts NEW slice 7 "Web cluster C:
> app-level pages" (8 orphan server pages + 7 landing children previously
> undercounted), folds `create-plan/page.tsx` into slice 6 (was omitted
> before), and extends the cleanup slice's grep gate to cover
> `resolvePageI18n`/`loadMessages` in addition to `messages.*`/`.replace()`/
> local `t()` closures. Rev2 carry-overs kept as-is: `?lang=` header
> mechanism (now with `config.matcher` scoping + anti-spoofing deletion),
> shared tracker subtree as one atomic slice, `select` + `useFormatter` date
> on `PlanSelector`, deep-merge EN fallback in `getRequestConfig`.

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~2160 total across 10 slices (~40 rendering/component files + 4 infra files) |
| 400-line budget risk | Low; largest slices (4 tracker ~260, 5 plan shell ~290, 7 cluster-C ~260) stay under 400 |
| Chained PRs recommended | Yes |
| Chain strategy | stacked-to-main |
| Delivery strategy | auto-chain |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: Low (no slice approaches 400; slices 4/5/7 are the tightest at ~260–290 and are each an atomic render-graph unit — do not split)

### Per-Slice Review Workload

| # | Slice | Est. lines | Budget risk | Note |
|---|-------|-----------|-------------|------|
| 1 | `@kinora/i18n` machinery: flatten, mergeWithBase, parity/ICU-arg guard, type-gen vs sample catalog | ~180 | Low | Pure logic + merge util, small sample data |
| 2 | Catalog migration: 325 flat→nested, 18 ICU (interp + plural + ≥1 `select`) | ~300 | Low | Data-heavy JSON move, near-zero logic risk |
| 3 | Web foundation: `middleware.ts` (new, + `config.matcher` + anti-spoof header deletion), `request.ts` `getRequestConfig` (header→Accept-Language→EN + deepMerge fallback + onError), `next.config` plugin, root provider | ~210 | Low | Framework plumbing; new stateless middleware file |
| 4 | **Tracker subtree (shared)**: TrackerPanel + 7 children, drop `tracker-model` `Translate`, EDIT PlanTrackerClient + PlanStatusClient to stop drilling `messages` to TrackerPanel | ~260 | **Medium** | Tightest atomic slice; shared node forces both parents in same slice — do not split |
| 5 | **Plan shell**: plan/page + plan/[id]/page, PlanWeekView, PlanTrackerClient/PlanStatusClient own `t` (drop `messages` prop, stop drilling to DayDetailPanel/PlanStatusView), DayDetailPanel, PlanStatusView (+`use client`), PlanSelector (`useFormatter().dateTime` + ICU `select`) | ~290 | **Medium** | Second-tightest; 8 files, removing `messages` prop forces parents into same slice |
| 6 | Wizard + create-plan: `create-plan/page.tsx` (`resolvePageI18n` threader → `getTranslations`) + StepperShell + 6 steps | ~230 | Low | Server threader + client stepper move together |
| 7 | **Web cluster C (NEW): app-level pages** — 8 orphan server pages + 7 landing children | ~260 | Medium | Widest file count (15) but each file is a thin server-component migration; must land BEFORE slice 8 retires `loadMessages`/`resolvePageI18n` |
| 8 | Web cleanup (point of no return): full-codebase grep for `messages.*`/`resolvePageI18n`/`loadMessages`/`.replace()`/local `t()` closures, then delete old JSON + retire `loadMessages` + `resolvePageI18n`; KEEP `resolveLocale` + EN-fallback (now in `getRequestConfig`) | ~60 | Low | Deletion-only, gated on the EXTENDED grep across slices 3–7 |
| 9 | Mobile foundation: `IntlProvider` + flatten/merge boundary + `defaultLocale="en"` + locale switch + AUTHOR ~30 mobile-unique tracker strings as new EN+ES keys + expand parity guard | ~220 | Low | Green-field infra + authoring (not just migration) |
| 10 | Mobile tracker migration: WorkoutTrackerScreen + tracker components → `useIntl`/`FormattedMessage`/`FormattedNumber`/`FormattedDate`/`{select}`; retire `copy/tracker.ts`; Hermes plural validation | ~210 | Low | Isolates Hermes/plural uncertainty; exercises select + number/date + plural (SC#3) |

No slice is near/over the 400-line budget; none require a split. Slices 4, 5,
and 7 are the widest by file count but each is bounded by a single
render-graph/route-cluster boundary — splitting any of them would either
leave a dangling `messages` prop (4, 5) mid-slice or separate a page from its
own migration proof (7).

### Suggested Work Units (stacked-to-main)

| Unit | Branch | Depends on | Notes |
|------|--------|-----------|-------|
| 1 | `feat/100-i18n-machinery` → main | — | Foundation; must merge first |
| 2 | `feat/100-i18n-catalog-data` → (1) | 1 | Full catalog through proven guard |
| 3 | `feat/100-i18n-web-foundation` → (2) | 1,2 | middleware + next-intl wiring; old JSON still live |
| 4 | `feat/100-i18n-web-tracker` → (3) | 1,2,3 | Shared tracker subtree + both parent edits |
| 5 | `feat/100-i18n-web-plan-shell` → (4) | 1,2,3,4 | Plan shell; depends on slice 4's parent edits already landing |
| 6 | `feat/100-i18n-web-wizard` → (5) | 1,2,3 | Wizard + create-plan; last "closure" cluster |
| 7 | `feat/100-i18n-web-cluster-c` → (6) | 1,2,3 | NEW — orphan pages + landing children; independent of 4/5/6 content-wise but MUST land before slice 8 |
| 8 | `feat/100-i18n-web-cleanup` → (7) | 4,5,6,7 | Point of no return — gated on EXTENDED full-codebase grep across all of 3–7 |
| 9 | `feat/100-i18n-mobile-foundation` → (8) or main | 1,2 | Green-field mobile infra + copy authoring |
| 10 | `feat/100-i18n-mobile-migration` → (9) | 9 | Hermes plural validation gates polyfill decision |

Each slice merges to main independently once green; `main` stays shippable
throughout because the old web i18n system remains live until slice 8.
Slice 5 depends on slice 4 (not independent) because slice 4 already edits
`PlanTrackerClient`/`PlanStatusClient` to stop drilling `messages` to
`TrackerPanel` — slice 5 continues that same edit to drop the prop entirely
and stop drilling to `DayDetailPanel`/`PlanStatusView`. Slice 7 is
content-independent of slices 4–6 (different route cluster) but is
chain-ordered before slice 8 because slice 8's deletion gate requires ALL of
slices 3–7 to have landed first.

---

## Slice 1 — `@kinora/i18n` Machinery (feat/100-i18n-machinery)

Satisfies: 100a (Key Parity Guard, Non-Empty Value Validation, ICU Argument
Parity, Generated Message-Key Types, Catalog-Driven Locale Extensibility —
proven against a sample catalog before full data migration)

### Phase 1.1: Package Scaffold
- [x] 1.1.1 Create `packages/i18n/package.json` — name `@kinora/i18n`, exports `"."` + `"./messages/en"` + `"./messages/es"`, mirror `packages/domain` devDeps.
- [x] 1.1.2 Create `packages/i18n/tsconfig.json` + `tsconfig.build.json` mirroring `packages/domain`.
- [x] 1.1.3 Register `@kinora/i18n` path alias in root tsconfig; confirm pnpm-workspace glob already covers it.

### Phase 1.2: flattenMessages
- [x] 1.2.1 [RED] `packages/i18n/src/__tests__/flatten.test.ts` — nested object → flat dot-joined `Record<string,string>`.
- [x] 1.2.2 [GREEN] Implement `packages/i18n/src/flatten.ts` — `flattenMessages(nested)`.

### Phase 1.3: mergeWithBase (EN fallback util, Gap 2)
- [x] 1.3.1 [RED] `packages/i18n/src/__tests__/merge.test.ts` — `mergeWithBase(en, locale)` deep-merges nested catalogs; missing namespace/key in `locale` falls back to `en`'s value; present keys in `locale` win.
- [x] 1.3.2 [GREEN] Implement `packages/i18n/src/merge.ts` — `mergeWithBase()` deep merge (not shallow spread — must preserve whole namespaces missing from `locale`).

### Phase 1.4: Parity + ICU-Arg Guard
- [x] 1.4.1 [RED] `packages/i18n/src/__tests__/catalog-parity.test.ts` against a sample EN/ES fixture: (a) missing key fails with key+locale, (b) identical key sets pass, (c) empty/whitespace value fails, (d) mismatched ICU arg names fail, (e) matching ICU args (incl. one `select` case) pass.
- [x] 1.4.2 [GREEN] Implement the guard over recursively-flattened catalogs, parsing `{arg}`/`{arg, plural, ...}`/`{arg, select, ...}` argument names per key.
- [x] 1.4.3 Adapt intent from existing `apps/web/src/i18n/__tests__/catalog-parity.test.ts` into this guard (confirm coverage parity before the old one is retired in slice 8).

### Phase 1.5: Type Generation
- [x] 1.5.1 [RED] `packages/i18n/src/__tests__/types.test.ts` — unknown key reference fails to type-check; valid key type-checks.
- [x] 1.5.2 [GREEN] Implement `packages/i18n/src/types.ts` — generated `Messages` type / flat-key union from the sample catalog shape.

### Phase 1.6: Package Assembly
- [x] 1.6.1 Create `packages/i18n/src/index.ts` — export catalogs, `flattenMessages`, `mergeWithBase`, generated types.
- [x] 1.6.2 Create `packages/i18n/src/messages/en.json` + `es.json` as small SAMPLE catalogs (full data lands in slice 2) — enough to exercise nesting, plural, `select`, and interpolation.
- [x] 1.6.3 `pnpm test` + typecheck in `packages/i18n` — green.

---

## Slice 2 — Catalog Migration (feat/100-i18n-catalog-data)

Satisfies: 100a (all requirements, now against full production data)

### Phase 2.1: Full Catalog Data
- [x] 2.1.1 Migrate all 325 flat underscore keys into nested namespaces (`nav`, `hero`, `trust`, `hiw`, `features`, `pricing`, `cta`, `auth`, `footer`, `phone`, `plan`, `tracker`, `wizard`, `dashboard`, `exercises`, `stats`, `profile`, `offline`, `marketing`).
- [x] 2.1.2 Convert ALL 18 ICU keys (verified count against the live catalog). Plain interpolation kept for `plan.selector.option` (base string; see 2.1.3 for `select` upgrade), `plan.start.conflict`, `plan.start.conflict_no_day`, `plan.day.label`, `tracker.tracking.day`, `tracker.progress.valuetext`, `tracker.target.pill`, `tracker.rest.srActive`, `wizard.step.progressAria`, `wizard.chip.removeAria`; count-bearing → `{n, plural, one{} other{}}` for `wizard.frequency.days`, `wizard.duration.min`, `plan.est_duration` ("est. {n} min" — count-bearing; use plural even though EN/ES "min" is plural-invariant, for consistency), `tracker.next.sets`, `tracker.timeline.meta.done`, `tracker.timeline.meta.active`, `tracker.timeline.meta.pending`; `tracker.progress.label` stays plain interpolation.
- [x] 2.1.3 Add `select` to `plan.selector.option`: `{status, select, ready{} generating{} failed{} other{}}` branch, replacing the `.replace()`-built `{date} ({status})` string at `PlanSelector.tsx:71-76` (date itself is formatted separately via `useFormatter` in slice 5, not baked into this key).
- [x] 2.1.4 Replace `packages/i18n/src/messages/en.json` + `es.json` sample data with the full migrated catalog.

### Phase 2.2: Guard Validation Against Full Data
- [x] 2.2.1 Run the slice-1 guard (unmodified) against the full catalog — fix real mismatches, do not weaken the guard.
- [x] 2.2.2 Run/extend the slice-1 type-generation test against the full catalog shape.
- [x] 2.2.3 `pnpm test` in `packages/i18n` — green with full data.

---

## Slice 3 — Web Foundation: middleware + `?lang=` fix (feat/100-i18n-web-foundation)

Satisfies: 100b (Server and Client Component Access, Locale Resolution
Unchanged); implements the design's C1 fix (`?lang=` via header injection,
now with `config.matcher` scoping + anti-spoofing header deletion) and Gap 2
fix (deep-merge EN fallback in `getRequestConfig`)

### Phase 3.1: Middleware (`?lang=` → header, matcher, anti-spoofing)
- [ ] 3.1.1 [RED] Write `apps/web/src/middleware.test.ts` (or integration test) asserting: request with `?lang=es` sets `x-kinora-lang: es` on the forwarded request headers; request with no `?lang=` clears/omits the header (so bare requests fall through to `Accept-Language`); request with an invalid `?lang=` value still sets the header verbatim (short-circuit to EN happens downstream in `resolveLocale`, not in middleware).
- [ ] 3.1.2 [RED] Write an anti-spoofing test: simulate an incoming request that ALREADY carries a client-supplied `x-kinora-lang` header (e.g. `fr`) with NO `?lang=` query param; assert the middleware DELETES that header before forwarding, so `getRequestConfig` falls through to `Accept-Language` and cannot be spoofed.
- [ ] 3.1.3 [RED] Write a matcher-scope test/assertion: `config.matcher` excludes `/_next/*`, static assets, and `/api/*` — middleware must not run against those paths.
- [ ] 3.1.4 [GREEN] Create `apps/web/src/middleware.ts` — reads `?lang=` from the request URL, calls `NextResponse.next({ request: { headers } })` with `x-kinora-lang` set when `?lang=` present, or actively DELETED (not just omitted) when `?lang=` is absent, satisfying 3.1.1–3.1.3. No cookies, no persisted state.
- [ ] 3.1.5 [GREEN] Add `export const config = { matcher: [...] }` to `middleware.ts` excluding `/_next/*`, static assets, and `/api/*` per next-intl guidance.

### Phase 3.2: `getRequestConfig` (header→Accept-Language→EN + deepMerge + onError)
- [ ] 3.2.1 [RED] Write `apps/web/src/i18n/__tests__/request.test.ts`: (a) `?lang=es` request over an `en` `Accept-Language` header resolves to `es` (header wins); (b) invalid `?lang=` value resolves straight to EN and does NOT fall through to `Accept-Language` (matches existing `resolveLocale` short-circuit, `locale.ts:47`); (c) missing key in `es` catalog falls back to the `en` value via `mergeWithBase` (Gap 2 regression test); (d) a request that triggers `MISSING_MESSAGE` does not throw (verifies `onError` swallows it).
- [ ] 3.2.2 [GREEN] APPEND to the EXISTING `apps/web/src/i18n/request.ts` (do NOT overwrite — the file already exports `getFirstParam`/`resolvePageI18n`, still consumed by slices 5/6/7 until they migrate; `createNextIntlPlugin` targets this same path). Add `export default getRequestConfig(async () => …)` reading the `x-kinora-lang` header, calling the EXISTING `resolveLocale(acceptLanguage, xLangHeader)` from `locale.ts` verbatim (no logic changes), then `messages: mergeWithBase(en, catalog[locale])` from `@kinora/i18n`, plus `onError` handling `MISSING_MESSAGE`. Keep `resolvePageI18n` live in this file until slice 8 retires it.
- [ ] 3.2.3 Add `next-intl@^4.13.1` + `@kinora/i18n` workspace dependency to `apps/web`.
- [ ] 3.2.4 Wrap `apps/web/next.config.ts` with `createNextIntlPlugin('./src/i18n/request.ts')`, composed with existing `withSerwist`.
- [ ] 3.2.5 Wrap root `apps/web/src/app/layout.tsx` children in `NextIntlClientProvider`; preserve `lang={locale}` attribute.

### Phase 3.3: Regression + Validate Gate
- [ ] 3.3.1 Confirm old `messages/{en,es}.json` + `loadMessages` + `resolvePageI18n` remain live and unused-by-new-code (no call-sites migrated yet) — `pnpm test` full web suite green with zero regressions.
- [ ] 3.3.2 **[VALIDATE — apply-time]** Under Turbopack, confirm the middleware-injected `x-kinora-lang` header reliably reaches `getRequestConfig`'s `await headers()` call for the same request (open question from design).
- [ ] 3.3.3 **[VALIDATE — apply-time]** Render the same URL twice with different `?lang=` values back-to-back; assert no cross-locale memoization bleed (each request/response resolves its own messages independently).

---

## Slice 4 — Tracker Subtree (Shared) (feat/100-i18n-web-tracker)

Satisfies: 100b (Full ICU Support, No Home-Grown Interpolation/Local `t()`
Closures, Server+Client Component Access) for the shared tracker surface.
`TrackerPanel` is rendered by BOTH `PlanTrackerClient` and
`PlanStatusClient` — this slice MUST migrate the shared subtree and both
parent call-sites atomically or type-check breaks mid-slice.

### Phase 4.1: Test-First Per Component
- [ ] 4.1.1 [RED] For `TrackerPanel`, `TrackerTopbar`, `SessionProgress`, `ExerciseCard`, `RestRing`, `NextExercisePreview`, `Timeline`, `PerformanceRail`: extend/write render tests asserting each uses `useTranslations`/`useFormatter` (not the old local `t(key,fallback)` closure or `.replace()`), covering plural (`tracker.next.sets`, `tracker.timeline.meta.done/pending`) and interpolation (`tracker.progress.label`, `tracker.rest.srActive`, `tracker.tracking.day`, `tracker.target.pill`).
- [ ] 4.1.2 [GREEN] Migrate `TrackerPanel` — drop the `messages` prop it currently receives from both parents; consume `useTranslations` directly.
- [ ] 4.1.3 [GREEN] Migrate `TrackerTopbar`.
- [ ] 4.1.4 [GREEN] Migrate `SessionProgress`.
- [ ] 4.1.5 [GREEN] Migrate `ExerciseCard`.
- [ ] 4.1.6 [GREEN] Migrate `RestRing` (covers `tracker.rest.srActive {time}`).
- [ ] 4.1.7 [GREEN] Migrate `NextExercisePreview`.
- [ ] 4.1.8 [GREEN] Migrate `Timeline` (covers `tracker.timeline.meta.done/pending {n}` plural).
- [ ] 4.1.9 [GREEN] Migrate `PerformanceRail`.

### Phase 4.2: Drop `Translate` Type + Fix Both Parents
- [ ] 4.2.1 [GREEN] Remove the `Translate` type from `tracker-model.ts` — no longer needed once components self-consume `useTranslations`.
- [ ] 4.2.2 [GREEN] Edit `PlanTrackerClient` to stop passing `messages` to `TrackerPanel` (it keeps its OWN `messages`/`t` for its own remaining local usages until slice 5 migrates it fully).
- [ ] 4.2.3 [GREEN] Edit `PlanStatusClient` to stop passing `messages` to `TrackerPanel` (same pattern as 4.2.2).

### Phase 4.3: Cluster Verification
- [ ] 4.3.1 Grep-verify zero remaining `.replace()`/local `t(key,fallback)` closures across the 8 migrated tracker files + `tracker-model.ts`.
- [ ] 4.3.2 `pnpm test` — full suite green; confirm both `PlanTrackerClient` and `PlanStatusClient` still type-check with the dropped `messages`-to-`TrackerPanel` prop.

---

## Slice 5 — Plan Shell (feat/100-i18n-web-plan-shell)

Satisfies: 100b (same requirement set as slice 4) for the plan-shell
surface, plus Gap 1 (`select` + `useFormatter` date) on `PlanSelector`.
Depends on slice 4 (continues the `PlanTrackerClient`/`PlanStatusClient`
edits started there).

ATOMICITY NOTE: `PlanStatusView` is a second shared render node — rendered by
BOTH `plan/page.tsx` (failed branch) AND `PlanStatusClient`. Both parents and
`PlanStatusView` are all in THIS slice, so it is safe; do NOT re-split this
slice in a way that separates `PlanStatusView` from either parent, or a
dangling `messages` prop will break type-check (same trap as `TrackerPanel`).

### Phase 5.1: Server Pages + PlanWeekView
- [ ] 5.1.1 [RED] Write/extend render tests for `plan/page.tsx` and `plan/[id]/page.tsx` asserting `getTranslations()` server-side usage, no `loadMessages` threading.
- [ ] 5.1.2 [GREEN] Migrate `plan/page.tsx` → `getTranslations()`, drop `loadMessages` threading to children.
- [ ] 5.1.3 [GREEN] Migrate `plan/[id]/page.tsx` → `getTranslations()`, drop `loadMessages` threading.
- [ ] 5.1.4 [RED] Write render test for `PlanWeekView` asserting `getTranslations()` usage (component was missed in the earlier slice cut).
- [ ] 5.1.5 [GREEN] Migrate `PlanWeekView` → `getTranslations()`.

### Phase 5.2: Client Wrappers Drop `messages` Prop
- [ ] 5.2.1 [RED] Write/extend tests asserting `PlanTrackerClient` and `PlanStatusClient` no longer accept a `messages` prop and instead call `useTranslations` directly, and no longer drill `messages` to `DayDetailPanel`/`PlanStatusView`.
- [ ] 5.2.2 [GREEN] Migrate `PlanTrackerClient` — drop `messages` prop entirely; own `t`→`useTranslations`; stop drilling to `DayDetailPanel`.
- [ ] 5.2.3 [GREEN] Migrate `PlanStatusClient` — drop `messages` prop entirely; own `t`→`useTranslations`; stop drilling to `PlanStatusView`.
- [ ] 5.2.4 [GREEN] Migrate `DayDetailPanel` → `useTranslations`.
- [ ] 5.2.5 [RED] Write test asserting `PlanStatusView` is a client component (`use client`) using `useTranslations`.
- [ ] 5.2.6 [GREEN] Add `"use client"` to `PlanStatusView` + migrate to `useTranslations`.

### Phase 5.3: PlanSelector — `select` + `useFormatter` Date (Gap 1)
- [ ] 5.3.1 [RED] Write test asserting `PlanSelector` renders `plan.selector.option` via the ICU `select` branch (`ready`/`generating`/`failed`/`other`) instead of `.replace()`-built `{date} ({status})` string.
- [ ] 5.3.2 [RED] Write test asserting `PlanSelector` formats the date via `useFormatter().dateTime` under the active locale (not a raw `Date#toLocaleDateString` or manual format string).
- [ ] 5.3.3 [GREEN] Migrate `PlanSelector` — `useFormatter().dateTime` for the date + ICU `select` for status, satisfying 5.3.1/5.3.2.

### Phase 5.4: Cluster Verification
- [ ] 5.4.1 Grep-verify zero remaining `.replace()`/local `t(key,fallback)` closures across the 8 plan-shell files.
- [ ] 5.4.2 `pnpm test` — full suite green.

---

## Slice 6 — Wizard + Create-Plan (feat/100-i18n-web-wizard)

Satisfies: 100b (same requirement set as slices 4/5) for the wizard and
create-plan surface. `create-plan/page.tsx` is a server `resolvePageI18n`
threader (not a closure) that must migrate together with the stepper it
threads `messages` into.

### Phase 6.1: `create-plan/page.tsx` Server Threader
- [ ] 6.1.1 [RED] Write/extend render test for `create-plan/page.tsx` asserting `getTranslations()` server-side usage and NO `resolvePageI18n` call, and no `messages` prop threaded to `StepperShell`.
- [ ] 6.1.2 [GREEN] Migrate `create-plan/page.tsx` — replace `resolvePageI18n` with `getTranslations()`; drop `messages` prop threading.

### Phase 6.2: Test-First Per Stepper Component
- [ ] 6.2.1 [RED] For `StepperShell` + the 6 wizard steps (Frequency, Duration, Equipment, Limitations, Goal, Location): extend/write render tests asserting migration to `next-intl` calls, including `wizard.step.progressAria {step}{total}`, `wizard.chip.removeAria {name}`, `wizard.frequency.days` plural, `wizard.duration.min` plural.
- [ ] 6.2.2 [GREEN] Migrate `FrequencyStep` (covers `wizard.frequency.days` plural).
- [ ] 6.2.3 [GREEN] Migrate `DurationStep` (covers `wizard.duration.min` plural).
- [ ] 6.2.4 [GREEN] Migrate `EquipmentStep`.
- [ ] 6.2.5 [GREEN] Migrate `LimitationsStep`.
- [ ] 6.2.6 [GREEN] Migrate `GoalStep`.
- [ ] 6.2.7 [GREEN] Migrate `LocationStep`.
- [ ] 6.2.8 [GREEN] Migrate `StepperShell` (covers `wizard.step.progressAria {step}{total}`, `wizard.chip.removeAria {name}`); no longer receives `messages` prop from `create-plan/page.tsx`.

### Phase 6.3: Cluster Verification
- [ ] 6.3.1 Grep-verify zero remaining `.replace()`/local `t(key,fallback)` closures and zero `resolvePageI18n` calls across the 8 files migrated in this slice.
- [ ] 6.3.2 `pnpm test` — full suite green.

---

## Slice 7 — Web Cluster C: App-Level Pages (feat/100-i18n-web-cluster-c)

NEW slice (revision 3). Satisfies: 100b (Server Component Access, No
Home-Grown Interpolation Remains) for the 8 previously-orphaned server pages
and the 7 landing children that receive the `messages` prop. Independent of
slices 4–6's route clusters, but MUST land before slice 8's cleanup gate
(slice 8 deletes `resolvePageI18n`/`loadMessages`, which these pages still
call today).

### Phase 7.1: Verify Server/Client Status Per File
- [ ] 7.1.1 For each of the 15 files in this slice, confirm current server/client status (`"use client"` directive present or absent) before assigning `getTranslations` (server) vs `useTranslations` (client) — do not assume; check each file individually.

### Phase 7.2: 8 Orphan Server Pages
- [ ] 7.2.1 [RED] Write render test for landing `page.tsx` asserting localized text is sourced via `getTranslations` (next-intl), not `messages.*` catalog access; assert `messages` prop is no longer threaded to landing children.
- [ ] 7.2.2 [GREEN] Migrate landing `page.tsx` → `getTranslations()`; drop `messages` prop threading to children.
- [ ] 7.2.3 [RED] Write render test for `(auth)/login/page.tsx` asserting `getTranslations` usage, no `messages.*` access.
- [ ] 7.2.4 [GREEN] Migrate `(auth)/login/page.tsx` → `getTranslations()`.
- [ ] 7.2.5 [RED] Write render test for `(auth)/sign-up/page.tsx` asserting `getTranslations` usage, no `messages.*` access.
- [ ] 7.2.6 [GREEN] Migrate `(auth)/sign-up/page.tsx` → `getTranslations()`.
- [ ] 7.2.7 [RED] Write render test for `dashboard/page.tsx` asserting `getTranslations` usage, no `messages.*` access.
- [ ] 7.2.8 [GREEN] Migrate `dashboard/page.tsx` → `getTranslations()`.
- [ ] 7.2.9 [RED] Write render test for `profile/page.tsx` asserting `getTranslations` usage, no `messages.*` access.
- [ ] 7.2.10 [GREEN] Migrate `profile/page.tsx` → `getTranslations()`.
- [ ] 7.2.11 [RED] Write render test for `exercises/page.tsx` asserting `getTranslations` usage, no `messages.*` access.
- [ ] 7.2.12 [GREEN] Migrate `exercises/page.tsx` → `getTranslations()`.
- [ ] 7.2.13 [RED] Write render test for `stats/page.tsx` asserting `getTranslations` usage, no `messages.*` access.
- [ ] 7.2.14 [GREEN] Migrate `stats/page.tsx` → `getTranslations()`.
- [ ] 7.2.15 [RED] Write render test for `offline/page.tsx` asserting `getTranslations` usage, no `messages.*` access.
- [ ] 7.2.16 [GREEN] Migrate `offline/page.tsx` → `getTranslations()`; note Serwist precache risk (design Risks table) — no code change required this slice, just avoid regressing the precached snapshot's locale assumption.

### Phase 7.3: 7 Landing Children
- [ ] 7.3.1 [RED] Write render test for `LandingNav` asserting `getTranslations`/`useTranslations` per its verified server/client status (7.1.1), no `messages` prop; confirm its child `LandingNavClient` keeps plain-string props (NOT migrated — receives already-resolved strings).
- [ ] 7.3.2 [GREEN] Migrate `LandingNav` per 7.3.1; drop `messages` prop.
- [ ] 7.3.3 [RED] Write render test for `LandingHero` asserting migration off `messages` prop.
- [ ] 7.3.4 [GREEN] Migrate `LandingHero`.
- [ ] 7.3.5 [RED] Write render test for `LandingHowItWorks` asserting migration off `messages` prop.
- [ ] 7.3.6 [GREEN] Migrate `LandingHowItWorks`.
- [ ] 7.3.7 [RED] Write render test for `LandingFeatures` asserting migration off `messages` prop.
- [ ] 7.3.8 [GREEN] Migrate `LandingFeatures`.
- [ ] 7.3.9 [RED] Write render test for `LandingPricing` asserting migration off `messages` prop.
- [ ] 7.3.10 [GREEN] Migrate `LandingPricing`.
- [ ] 7.3.11 [RED] Write render test for `LandingCTA` asserting migration off `messages` prop.
- [ ] 7.3.12 [GREEN] Migrate `LandingCTA`.
- [ ] 7.3.13 [RED] Write render test for `LandingFooter` asserting migration off `messages` prop.
- [ ] 7.3.14 [GREEN] Migrate `LandingFooter`.
- [ ] 7.3.15 Confirm `LandingCinemaBand`, `LandingTrust`, `LandingNavClient` remain UNCHANGED — they receive already-resolved strings/arrays as props, not the `messages` catalog, and are NOT part of this migration.

### Phase 7.4: Number/Date + Fallback-Literal Cleanup
- [ ] 7.4.1 Apply `useFormatter`/`getFormatter` wherever any of the 15 files render a number or date value.
- [ ] 7.4.2 Remove the inline `?? "…"` fallback literals (some ES defaults) that these pages/children currently carry once their keys resolve correctly via next-intl's deep-merge EN fallback — confirm no observable text regression (these were NOT a hardcoded-English surface per the design's corrected risk note; all pages already resolved the catalog).

### Phase 7.5: Cluster Verification
- [ ] 7.5.1 Grep-verify zero remaining `messages.*` catalog access, `resolvePageI18n` calls, `.replace()` i18n sites, or local `t(key,fallback)` closures across all 15 files in this slice.
- [ ] 7.5.2 `pnpm test` — full suite green.

---

## Slice 8 — Web Cleanup: POINT OF NO RETURN (feat/100-i18n-web-cleanup)

Satisfies: 100b (No Home-Grown Interpolation/Local `t()` Closures Remain,
No Residual Legacy Catalog Access — final confirmation). KEEPS `resolveLocale`
(used by middleware) and the EN-fallback (now living inside
`getRequestConfig`'s `mergeWithBase` call from slice 3) — this slice deletes
dead catalogs/helpers ONLY. Depends on slices 3, 4, 5, 6, AND 7 (cluster C)
having landed first.

- [ ] 8.1 Run the EXTENDED full-codebase grep over `apps/web/src`, EXCLUDING test files (`-g '!**/__tests__/**' -g '!**/*.test.*'`) and comment lines: assert ZERO remaining real catalog access `messages\??\.[a-zA-Z_]` or `messages\[`, `resolvePageI18n`, `loadMessages`, `.replace()` i18n sites, and local `t(key,fallback)` closures. NOTE: a bare `messages\.` pattern false-positives on surviving code comments (`hooks/use-plan-ws.ts:23`, `PlanStatusClient.tsx:73`) — scope the pattern to expression-position access as above, and manually discard any comment-only match. Do NOT proceed if real (non-comment, non-test) access remains.
- [ ] 8.2 Delete old `apps/web/src/i18n/messages/{en,es}.json`.
- [ ] 8.3 Retire `loadMessages` (defined in `apps/web/src/i18n/locale.ts`, imported by `request.ts`) — delete the function and its import once 8.1 confirms zero call-sites.
- [ ] 8.4 Retire `resolvePageI18n` — confirm zero remaining call-sites per 8.1 before deleting the function.
- [ ] 8.5 Do NOT remove `resolveLocale` (middleware/`request.ts` still call it) and do NOT remove the EN-fallback merge (`mergeWithBase`, now living in `getRequestConfig`, added in slice 3) — confirm both remain present after deletion.
- [ ] 8.6 Delete the old `apps/web/src/i18n/__tests__/catalog-parity.test.ts` (intent already adapted into `packages/i18n`'s guard in slice 1).
- [ ] 8.7 `pnpm test` — full web suite green; `pnpm build` (web) green.
- [ ] 8.8 Re-run the 8.1 grep (same scoped pattern, excluding tests/comments) post-deletion as a final confirmation gate — zero references anywhere in `apps/web` to the deleted old JSON paths, `loadMessages`, or `resolvePageI18n`; confirm `resolveLocale` and the `mergeWithBase` fallback call are still present.

---

## Slice 9 — Mobile Foundation + Copy Authoring (feat/100-i18n-mobile-foundation)

Satisfies: 100c (Shared Catalog Consumption, App-Root Provider, Runtime
Locale Switching, EN Support Added). Includes AUTHORING (not just
migrating) ~30 mobile-unique ES-only tracker strings as new EN+ES keys.

### Phase 9.1: Install + Provider
- [ ] 9.1.1 Add `react-intl@^10.1.14` + `@kinora/i18n` workspace dependency to `apps/mobile`.
- [ ] 9.1.2 [RED] Write test asserting `App.tsx` mounts `IntlProvider` above `NavigationContainer` with `messages={flattenMessages(mergeWithBase(en, catalog[locale]))}`, `locale`, `defaultLocale="en"`.
- [ ] 9.1.3 [GREEN] Implement `IntlProvider` wiring in `App.tsx` per 9.1.2, using the shared `flattenMessages`/`mergeWithBase` from `@kinora/i18n` at the boundary.

### Phase 9.2: Locale State + Switching
- [ ] 9.2.1 [RED] Write test asserting locale state switches at runtime and consumers re-render with new locale's copy without app restart.
- [ ] 9.2.2 [GREEN] Implement locale state + context provider for the switch from 9.2.1.

### Phase 9.3: Author ~30 Mobile-Unique Tracker Strings
- [ ] 9.3.1 Enumerate the ~30 mobile-unique ES-only strings in `apps/mobile/src/copy/tracker.ts` that have no EN/web equivalent.
- [ ] 9.3.2 [RED] Extend the `packages/i18n` parity guard test fixture to include the new mobile-only namespace keys; assert the guard requires EN+ES parity for them too (guard must fail if only ES is added).
- [ ] 9.3.3 [GREEN] Author NEW EN+ES entries for all ~30 strings in `packages/i18n/src/messages/{en,es}.json` under a mobile-tracker namespace; run the guard — must pass with real (non-placeholder) EN translations.

### Phase 9.4: Proof Screen + Cross-Runtime Parity
- [ ] 9.4.1 [RED] Write test asserting one representative screen accesses `useIntl().formatMessage({id})` directly (no prop-drilled messages), including at least one EN-rendered string (first mobile EN proof).
- [ ] 9.4.2 [GREEN] Migrate that one screen per 9.4.1.
- [ ] 9.4.3 [RED] Write cross-package test asserting mobile (`react-intl`) and web (`next-intl`) render identical text for a shared catalog key with the same args and locale.
- [ ] 9.4.4 [GREEN] Confirm parity from 9.4.3 holds; fix any catalog/formatter discrepancy.
- [ ] 9.4.5 `pnpm test` in `apps/mobile` — suite green.

---

## Slice 10 — Mobile Tracker Migration (feat/100-i18n-mobile-migration)

Satisfies: 100c (Full ICU Support parity, trackerCopy Served Through the
Runtime). Exercises `select` + number/date + plural per proposal Success
Criterion #3, mirroring slice 5's web-side Gap 1 coverage.

### Phase 10.1: Migrate trackerCopy
- [ ] 10.1.1 [RED] For each `trackerCopy` function entry, write test asserting the ICU message key renders output identical to the old function for representative inputs, in both ES and EN.
- [ ] 10.1.2 [GREEN] Migrate `apps/mobile/src/copy/tracker.ts` entries to ICU messages; screens switch to `useIntl().formatMessage({id}, args)` / `<FormattedMessage/>`.
- [ ] 10.1.3 [GREEN] Migrate `WorkoutTrackerScreen` and remaining tracker components referencing old `trackerCopy` constants to consume the runtime.
- [ ] 10.1.4 Delete `apps/mobile/src/copy/tracker.ts` once all call-sites are migrated — grep-verify zero remaining references.

### Phase 10.2: `select` + Number/Date Parity (SC#3, mirrors web Gap 1)
- [ ] 10.2.1 [RED] Write test asserting a mobile screen renders an ICU `{select}` branch (e.g. plan/session status equivalent) via `<FormattedMessage>`, matching the branch selection logic proven on web in slice 5.
- [ ] 10.2.2 [RED] Write test asserting `<FormattedDate>`/`<FormattedNumber>` render locale-correct date/number output for a shared catalog key with date/number args.
- [ ] 10.2.3 [GREEN] Confirm both 10.2.1 and 10.2.2 pass with the migrated components from Phase 10.1.

### Phase 10.3: Plural Parity with Web
- [ ] 10.3.1 [RED] Write test asserting mobile plural selection (count=1 vs count=3) for a shared plural key matches the branch web selects for the same values.
- [ ] 10.3.2 [GREEN] Confirm parity holds under `react-intl`'s ICU engine (regression guard; should hold by construction since it shares the MessageFormat engine with next-intl).

### Phase 10.4: Hermes On-Device Validation (apply-time)
- [ ] 10.4.1 **[VALIDATE — apply-time]** Render an ES plural message (e.g. `tracker.next.sets`) on a real Hermes device/simulator (RN 0.79.5); confirm `Intl.PluralRules` selects the correct ES plural branch for count=1 and count=3.
- [ ] 10.4.2 **[DECISION — gated by 10.4.1]** If Hermes native output is correct for ES → no polyfill added (design default). If incorrect → enable `@formatjs/intl-pluralrules` + `@formatjs/intl-locale` (force import before `IntlProvider` mount), add the dependency, re-run 10.4.1 to confirm the fix. Document the outcome.

### Phase 10.5: Final Verification
- [ ] 10.5.1 `pnpm test` in `apps/mobile` — full suite green, including EN support parity across the full tracker surface (not just the slice-9 proof screen).
- [ ] 10.5.2 Grep-verify zero remaining references to old Spanish-only hardcoded tracker copy anywhere in `apps/mobile/src`.
</content>
