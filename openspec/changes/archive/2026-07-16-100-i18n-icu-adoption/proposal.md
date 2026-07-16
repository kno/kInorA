# Proposal: Adopt ICU-Based i18n (next-intl + shared catalogs), Retire Home-Grown System

Closes #100. Roadmap: hardens the localization foundation under v1 web (07 plan-wizard, 09 tracker) and 06 mobile-foundation.

## Intent

The home-grown i18n is a liability. Web has no `t` hook or context: a `messages` Record is prop-drilled and **14 files each redefine a local `t(key, fallback) = messages[key] ?? fallback`** closure, with **32 `.replace(` manual-interpolation call-sites**. There are no plurals, no `select`, and no locale-aware number/date formatting — all faked with string surgery, which is error-prone and untestable. Mobile (`apps/mobile/src/copy/tracker.ts`) is Spanish-only with function-based template interpolation and **no i18n layer at all** (no EN, no provider, no switching). The two runtimes share no approach, guaranteeing catalog and behavior drift. Adopting a real ICU library gives interpolation, plurals, select, and locale formatting as first-class, testable primitives across web and mobile.

## Scope

### In Scope
- New shared package `@kinora/i18n`: ICU catalogs (EN/ES JSON), parity+validation logic (adapt intent of `catalog-parity.test.ts`: key sets, non-empty values, ICU-argument parity), and type generation. NOT runtime bindings.
- Web migration to **next-intl** (Next 16 App Router, "without i18n routing" mode) preserving existing `?lang=` + `Accept-Language` resolution (`apps/web/src/i18n/request.ts` `resolvePageI18n`, `locale.ts`). Replace all 14 local `t` closures and 32 `.replace()` sites; convert 18 placeholder keys to ICU.
- Mobile green-field i18n: FormatJS/ICU-compatible runtime (react-intl or i18n-js) consuming the SAME shared catalogs; add EN, provider, locale switching; migrate `trackerCopy`.
- Full ICU as formal requirement: interpolation + plurals + select + locale-aware number/date.
- Infra designed for low-cost future locales (catalog loading, typing, provider), EN+ES shipped now.

### Out of Scope
- Adding NEW locales beyond EN/ES (infra ready, content not authored).
- Locale-prefixed URL routing (`/[locale]/…`) — keep current param/header resolution.
- Backend/API-emitted message localization (not currently localized).
- Rewriting copy content or redesigning screens.

## Capabilities

### New Capabilities
- `100a-shared-i18n-catalog`: `@kinora/i18n` package — ICU EN/ES catalogs, parity/validation guard, generated message-key types.
- `100b-web-i18n-runtime`: next-intl provider + `useTranslations`/formatters wired to existing locale resolution; server/client boundary rules.
- `100c-mobile-i18n-runtime`: FormatJS-compatible provider consuming shared catalogs, EN/ES switching.

### Modified Capabilities
- None (no existing i18n spec; consuming features change implementation, not spec-level requirements).

## Approach

1. Stand up `@kinora/i18n` (pnpm `packages/*`, alongside `@kinora/contracts`/`@kinora/domain`) as source of truth for catalogs + parity + types.
2. Convert existing 325 EN/ES keys to ICU; migrate the 18 placeholder keys to ICU syntax; keep 1:1 parity enforced by adapted guard.
3. Web: install next-intl (verify Next 16 compat at design), provide messages at layout/request boundary from `resolvePageI18n`, replace prop-drilled `t` and `.replace()` with `useTranslations` + formatters; respect server-vs-client component split.
4. Mobile: pick FormatJS-compatible runtime at design; add provider at app root, migrate `trackerCopy`, add EN.
5. Large cross-cutting change → deliver as **chained/stacked PRs** (package → web core → web feature clusters (plan/tracker/wizard/create-plan) → mobile), each independently green.

## Affected Areas

| Area | Impact | Description |
|------|--------|--------------|
| `packages/i18n/**` | New | Shared ICU catalogs, parity/validation, type gen |
| `apps/web/src/i18n/{request,locale}.ts` | Modified | Feed next-intl from existing resolution |
| `apps/web/src/i18n/messages/{en,es}.json` | Modified | Move to shared package; ICU conversion |
| `apps/web/src/i18n/__tests__/catalog-parity.test.ts` | Modified | Adapt to ICU-arg parity |
| `apps/web/**` (14 files, 32 sites) | Modified | Replace local `t`/`.replace()` with hooks/formatters |
| `apps/mobile/src/copy/tracker.ts` + app root | Modified/New | Green-field i18n provider + catalog consumption |
| Root `pnpm-workspace`/tsconfig paths | Modified | Register `@kinora/i18n` |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| next-intl ↔ Next 16 incompatibility | Med | Verify compat design; fallback to raw `@formatjs/intl` if unsupported |
| Server vs client component boundary friction | Med | Define boundary rules in design; provide messages at server boundary, hooks in client |
| RN runtime differs from web (Intl polyfill needs) | Med | Design validates `Intl`/polyfill on Expo 53/RN 0.79 before pick |
| Catalog format divergence web vs mobile | Med | Single shared catalog + shared parity/type guard is source of truth |
| Large diff overwhelms review | High | Chained/stacked PRs by work unit; each green + independently reviewable |
| Silent copy regressions during 32-site migration | Med | Parity guard + type-safe keys catch missing/renamed keys at build/test |

## Rollback Plan

- Per-slice revert: each stacked PR is self-contained. Reverting a feature-cluster PR restores its prior `t`/`.replace()` closures (kept until that slice lands).
- Package-level: `@kinora/i18n` is additive; until web/mobile import it, reverting consumers leaves the old inline catalogs functional. Keep old `messages/*.json` until web slices complete.

## Dependencies

- next-intl compatibility with Next 16.2.9 / React 19.2.7 (confirm at design).
- FormatJS-compatible mobile runtime + any `Intl` polyfill for Expo ~53 / RN 0.79.5 / React 19.0.0.
- pnpm workspace registration of `@kinora/i18n`.

## Success Criteria

- [x] `@kinora/i18n` ships EN/ES ICU catalogs, parity/validation, and generated key types; consumed by web and mobile.
- [x] Zero local `t(key, fallback)` closures and zero `.replace()` interpolation sites remain in `apps/web`.
- [x] ICU interpolation, plurals, select, and locale-aware number/date are exercised by tests in both runtimes.
- [x] Mobile renders EN and ES with a provider and locale switch; `trackerCopy` served from shared catalogs.
- [x] Web locale resolution (`?lang=` + `Accept-Language`) behaves as before via next-intl.
- [x] Parity guard passes (identical EN/ES key + ICU-arg sets); type-check green.
