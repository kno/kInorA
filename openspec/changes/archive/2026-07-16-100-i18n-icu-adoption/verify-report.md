# Verify Report: Adopt ICU-Based i18n (Change 100)

**Verdict: PASS-WITH-NOTES**

Verified against `main` (HEAD `4e26add`). All 10 slices merged. Strict TDD
was active throughout (confirmed via tasks.md RED/GREEN phase markers).

## Test Suite (full workspace, `pnpm -r test`)

| Package | Files | Tests | Result |
|---|---|---|---|
| packages/i18n | 5 | 27 | pass |
| packages/contracts | 4 | 36 | pass |
| packages/domain | 11 | 116 | pass |
| apps/mobile | 23 | 139 | pass |
| apps/api | 44 | 585 | pass |
| apps/web | 72 | 603 | pass |
| **Total** | **159** | **1506** | **all pass** |

`pnpm -r type-check` — clean across all 6 workspace projects (contracts,
i18n, domain, mobile, api, web).

## Cleanup-Invariant Greps (apps/web/src, excl. tests/comments)

- `messages\??\.[a-zA-Z_]` / `messages\[` (residual catalog access): **0 matches**
- `resolvePageI18n`: **0 matches**
- `loadMessages`: **0 matches**
- old `apps/web/src/i18n/messages/{en,es}.json`: **deleted, confirmed absent**
- `.replace()` in non-test source: **0 matches**
- `resolveLocale` (must remain, used by proxy/getRequestConfig): **present** — `apps/web/src/i18n/locale.ts:20`
- `mergeWithBase` (must remain, EN-fallback in getRequestConfig): **present** — `apps/web/src/i18n/request.ts:14,53`
- `const t = useTranslations()/getTranslations()` occurrences (~37 sites): all are next-intl framework hooks, not home-grown `t(key, fallback)` closures — correct per spec 100b's "no local t() closures" requirement.

## Mobile Cleanup Grep (apps/mobile/src, excl. tests/comments)

- `trackerCopy` / `copy/tracker` references: **0 matches** (file deleted, slice 10.1.4)
- Hardcoded Spanish tracker strings (`Sesión activa`, `Pausar sesión`, etc.): **0 matches**

## Spec Coverage

- **100a (shared catalog)**: `packages/i18n/src/{flatten,merge,catalog-parity,types}.ts` present; `en.json`/`es.json` carry 352 parity-guarded leaf keys (329 base + 23 mobile-tracker, per slice 9). Parity/ICU-arg/non-empty-value guard + generated `MessageKeys` type all implemented and tested (27 tests green).
- **100b (web runtime)**: `next-intl` wired via `getRequestConfig` (deep-merge EN fallback, `onError`), `proxy.ts` handles `?lang=`→header injection with active anti-spoofing header deletion (confirmed in code, `apps/web/src/proxy.ts:51,55,58`). All tracker/plan/wizard/landing/app-level surfaces migrated off `messages` prop-drilling; `PlanSelector` uses ICU `select` + `useFormatter().dateTime` (Gap 1 closed).
- **100c (mobile runtime)**: `react-intl`'s `IntlProvider` mounted at app root via `LocaleProvider.tsx`; `WorkoutTrackerScreen` migrated off `trackerCopy` onto `useIntl()`; cross-runtime parity tests assert mobile/web render identical text for shared keys (interpolation + plural).

## Tasks vs. Code

All checklist items in `tasks.md` are marked `[x]` and match code state, EXCEPT
the two explicitly deferred items below (also unchecked `[ ]` in tasks.md).

## Outstanding (deferred, NOT verification failures — tracked in issue #117)

- **10.4.1** — Hermes on-device `Intl.PluralRules` ES validation: cannot run headless; explicitly left `[ ]` with NOT-VALIDATED marker in tasks.md.
- **10.4.2** — Polyfill decision gated on 10.4.1: left `[ ]`/OPEN; code ships the no-polyfill default per design, undecided pending device check.
- Mobile tracker visual-parity eyeball (post-decomposition/#116): manual/visual check, not code-completeness.

These are apply-time/device validations by design, not gaps in the merged
implementation — code, tests, and type-checks are green without them.

## Conclusion

Implementation matches spec, design, and tasks for all 10 slices. Full test
suite (1506 tests) and type-check are green on `main`. Cleanup invariants
hold: zero residual home-grown i18n in web; `resolveLocale`/`mergeWithBase`
correctly retained. The only open items are the two explicitly-flagged,
non-code-blocking Hermes device validations tracked in #117.
