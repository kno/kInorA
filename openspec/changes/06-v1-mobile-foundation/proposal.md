# Proposal: 06-v1-mobile-foundation

## Intent

kInorA currently has zero mobile-readiness: no PWA manifest, no service worker, no responsive breakpoints, no Capacitor shell, and no design system tokens in CSS. This change establishes the mobile foundation required for v1 by making the web app installable as a PWA, adding offline fallback via a service worker, enforcing responsive layout from 320px to 1920px, and wrapping the web build in a Capacitor shell for native iOS/Android deployment.

## Scope

### In Scope

- PWA manifest (`public/manifest.json`) with app name, icons, theme color, and display mode
- Service worker via `@serwist/next` with precaching and offline fallback page
- PWA icon set (192×192, 512×512, apple-touch-icon)
- Viewport and apple meta tags in `layout.tsx`
- Design system CSS custom properties (tokens from Open Design `DESIGN.md`) and responsive breakpoints
- Responsive fixes across existing pages to pass 320px–1920px without overflow
- Capacitor project shell at root level wrapping `apps/web` build output
- `@capacitor/core`, `@capacitor/cli`, `@capacitor/ios`, `@capacitor/android` as root devDeps
- Deps-guard update: move `@serwist` and `@capacitor/*` from `PROHIBITED_EVERYWHERE` to scoped allowlist for `apps/web` and root

### Out of Scope

- Expo app (`apps/mobile`) native build configuration — separate concern
- Native app store submission or CI/CD for native builds
- Push notifications
- Advanced offline data sync beyond the fallback page
- Full design-system component library (responsive tokens only)

## Capabilities

### New Capabilities

- `pwa-installable`: PWA manifest, icons, service worker, install prompt, offline fallback
- `capacitor-native-shell`: Capacitor config wrapping web build for iOS/Android native deployment
- `responsive-design-foundation`: Design system CSS tokens, responsive breakpoints, 320px–1920px layout guarantee

### Modified Capabilities

None — all capabilities are new.

## Approach

1. Update `scripts/deps-guard.mjs` — move `@serwist`, `@capacitor` patterns from `PROHIBITED_EVERYWHERE` to a scoped-allow section targeting `apps/web` and root
2. Create `apps/web/public/manifest.json` and PWA icon set in `apps/web/public/icons/`
3. Install and configure `@serwist/next` in `apps/web` — register service worker, configure precaching and offline fallback
4. Add `themeColor`, `<link rel="manifest">`, and apple meta tags to `apps/web/src/app/layout.tsx`
5. Create `apps/web/src/app/globals.css` with Open Design CSS custom properties (OKLch colors, typography, spacing) and responsive breakpoints (320/640/768/1024/1280/1920)
6. Audit and fix responsive layout across existing pages — replace inline styles with token-based classes, enforce ≥44px tap targets
7. Install `@capacitor/core`, `@capacitor/cli`, `@capacitor/ios`, `@capacitor/android` at root; create `capacitor.config.ts` pointing to `apps/web/out` (or equivalent build output)
8. Verify `cap sync ios` and `cap sync android` generate native projects

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| `@serwist/next` incompatible with Next.js 16 | Medium | Verify compatibility before install; fallback to manual `sw.js` if needed |
| Deps-guard modification weakens architectural invariant | High | Scoped allowlist with explicit workspace targets — do not blanket-allow |
| Capacitor + Next.js App Router output structure mismatch | Medium | Verify `cap sync` picks up correct build directory; test with `next export` if needed |
| Design system tokens not yet in codebase | Medium | Integrate tokens from `DESIGN.md` in step 5 before responsive work |
| iOS Safari PWA quirks (splash screen, status bar) | Low | Dedicated apple meta tags and splash screen config in Capacitor |

## Rollback Plan

1. Revert `scripts/deps-guard.mjs` to previous state (restores prohibited patterns)
2. Remove `apps/web/public/manifest.json`, `apps/web/public/icons/`, `apps/web/public/sw.js`
3. Uninstall `@serwist/next` from `apps/web` and `@capacitor/*` from root
4. Remove `capacitor.config.ts`
5. Revert `layout.tsx` viewport and meta tag changes
6. Revert `globals.css` design system additions
7. Run `pnpm deps-guard` and `pnpm build` to confirm clean state

## Success Criteria

- [ ] `pnpm deps-guard` passes with new scoped allowlist
- [ ] `pnpm build` succeeds for `apps/web`
- [ ] `manifest.json` is served and browser install prompt appears
- [ ] Service worker registers and offline fallback page renders on network disconnect
- [ ] All pages render without horizontal overflow from 320px to 1920px
- [ ] All interactive elements have ≥44px tap targets
- [ ] `npx cap sync ios` generates a valid Xcode project
- [ ] `npx cap sync android` generates a valid Android Studio project
- [ ] Design system CSS tokens are defined and referenced in layouts
