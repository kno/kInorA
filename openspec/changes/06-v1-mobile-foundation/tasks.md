# Tasks: 06-v1-mobile-foundation

## Review Workload Forecast

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

Estimated ~430 changed lines across 17 files. Three natural slices per design's migration plan.

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Deps-guard unblock | PR 1 (main) | ~30 lines, standalone, blocking |
| 2 | PWA + responsive | PR 2 (main) | ~380 lines, bulk of the work |
| 3 | Capacitor shell | PR 3 (main) | ~20 lines, isolated |

## Phase 1: Deps-guard (blocking — must ship first)

- [x] [06-INFRA 1.1] Modify `scripts/deps-guard.mjs` — add `PWA_ALLOWED_WORKSPACES` + `CAPACITOR_ALLOWED_WORKSPACES` arrays; move PWA/Capacitor patterns from `PROHIBITED_EVERYWHERE` to scoped checks
- [x] [06-TST 1.2] Verify `pnpm deps-guard` exits 0 with new allowlists

## Phase 2: PWA Foundation

- [ ] [06-WEB 2.1] Create `apps/web/public/manifest.json` — app name, icons, theme_color, display: standalone
- [ ] [06-WEB 2.2] Create PWA icons: `public/icons/icon-192.png`, `icon-512.png`, `apple-touch-icon.png`
- [ ] [06-WEB 2.3] Add `@serwist/next` to `apps/web/package.json` dependencies
- [ ] [06-WEB 2.4] Create `apps/web/app/sw.ts` — service worker with precaching + offline fallback handler
- [ ] [06-WEB 2.5] Create `apps/web/app/offline/page.tsx` — branded offline fallback page
- [ ] [06-WEB 2.6] Wrap `apps/web/next.config.ts` with `withSerwist`
- [ ] [06-WEB 2.7] Update `apps/web/src/app/layout.tsx` — `themeColor` viewport, `appleWebApp` metadata, manifest link, SerwistProvider, globals.css import
- [ ] [06-TST 2.8] Write Playwright test: `manifest.json` returns 200 + correct fields
- [ ] [06-TST 2.9] Write Playwright test: SW registers + serves offline fallback page

## Phase 3: Design System + Responsive

- [ ] [06-WEB 3.1] Create `apps/web/src/app/globals.css` — design tokens (OKLch colors, typography, spacing, radii) + responsive breakpoints (640/768/1024/1280/1920)
- [ ] [06-WEB 3.2] Migrate `page.tsx` — replace inline styles with token-based CSS classes
- [ ] [06-WEB 3.3] Migrate `dashboard/page.tsx` — replace inline styles with token-based CSS classes
- [ ] [06-WEB 3.4] Migrate `(auth)/login/page.tsx` — replace inline styles with token-based CSS classes
- [ ] [06-WEB 3.5] Migrate `(auth)/sign-up/page.tsx` — replace inline styles with token-based CSS classes
- [ ] [06-TST 3.6] Write Playwright test: CSS custom properties resolve to expected OKLch values
- [ ] [06-TST 3.7] Write Playwright viewport tests (375px, 768px, 1280px, 1920px): no overflow, no overlap, content readable
- [ ] [06-TST 3.8] Write Playwright test: all buttons/links have ≥44px tap target dimensions

## Phase 4: Capacitor Shell

- [ ] [06-INFRA 4.1] Add `@capacitor/core`, `@capacitor/cli`, `@capacitor/ios`, `@capacitor/android` to root `package.json` devDependencies
- [ ] [06-INFRA 4.2] Create `capacitor.config.ts` — appId: `com.kinora.app`, appName: `kInorA`, webDir: `apps/web/.next`
- [ ] [06-TST 4.3] Manual verify: `npx cap sync ios` generates `ios/` Xcode project
- [ ] [06-TST 4.4] Manual verify: `npx cap sync android` generates `android/` Android Studio project
