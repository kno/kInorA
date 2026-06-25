# Exploration: 06-v1-mobile-foundation

## Current State

### PWA Baseline
Zero. The `apps/web/public/` directory is empty — no `manifest.json`, no service worker, no icon assets. The layout exports a basic `viewport` with `device-width` and scale but no `themeColor`, no `apple-mobile-web-app-capable`, and no `<link rel="manifest">`. No PWA-related packages exist in any `package.json`. The `next.config.ts` has no PWA configuration.

### Responsive UI
Minimal. The layout sets `width: device-width` + `initialScale: 1`. Pages use inline styles with `clamp()` for responsive font sizing on the landing page, and `max-width: 100%` with flex layouts everywhere. But there is **no responsive framework** (no Tailwind, no PostCSS, no CSS modules), **no media queries**, **no design system tokens** in the CSS — the Open Design tokens from `DESIGN.md` (OKLch values, Space Grotesk/DM Sans, elevation rules) are not integrated into the web app at all.

### Capacitor
Zero. No `capacitor.config.ts` exists anywhere. No `@capacitor/core` or `@capacitor/cli` in any `package.json`.

### Mobile App (Expo)
Exists at `apps/mobile/` with Login, SignUp, and Home screens, auth infrastructure (SecureStore, deep links, session guard). **No Capacitor** — it's pure Expo managed workflow. Basic `app.json` has bundle identifiers for iOS/Android but no native build config.

### Open Design Snapshots
5 mobile screens available: Dashboard, Create Plan, Voice Assistant, Exercise Detail, Session Tracker. Design system documented with tokens, typography, spacing rules.

### Deps Guard Conflict
`scripts/deps-guard.mjs` blocks `workbox`, `next-pwa`, `@capacitor`, and `capacitor` **everywhere**. It checks `apps/web`, `apps/api`, `packages/contracts`, `packages/domain` — but NOT `apps/mobile`. This means:
- Adding PWA tools to `apps/web` → guard **will fail**
- Adding Capacitor to `apps/mobile` → guard **will pass** (not checked)
- Adding Capacitor at root → guard checks root's deps? No — it only checks the specific workspace files listed. So root-level capacity would also pass.

## Gaps (vs. Spec)

| Requirement | Status | Gap |
|---|---|---|
| PWA installable (manifest) | ❌ Missing | No `manifest.json`, no icons, no `rel="manifest"` |
| Service worker with offline fallback | ❌ Missing | No SW, no caching strategy |
| Viewport meta tags | ⚠️ Partial | Has `viewport` export but no `themeColor`, no apple meta tags |
| Responsive down to 320px | ❌ Missing | No breakpoints, no grid system, no design tokens in use |
| Tap targets ≥44px, no overflow | ❌ Missing | Not enforced anywhere |
| Capacitor shell for iOS/Android | ❌ Missing | No `capacitor.config.ts`, no `@capacitor/*` deps |
| Expo native build config | ❌ Missing | `apps/mobile` is Expo managed — no `expo-dev-client`, no `expo-build-properties` |

## Affected Areas

| File | Why |
|---|---|
| `apps/web/public/manifest.json` | **Create** — PWA manifest with app name, icons, theme_color, display |
| `apps/web/public/sw.js` | **Create** — service worker with cache-first or network-first strategy + offline fallback |
| `apps/web/public/icons/` | **Create** — PWA icon set (192x192, 512x512, apple-touch-icon) |
| `apps/web/src/app/layout.tsx` | **Modify** — add `themeColor` to viewport export, add `<link rel="manifest">`, add apple meta tags |
| `apps/web/next.config.ts` | **Modify** — add service worker headers or `next-pwa`/`@serwist` config |
| `apps/web/package.json` | **Modify** — add `@serwist/next` or manual SW setup (no extra deps) |
| `scripts/deps-guard.mjs` | **Modify** — move PWA/Capacitor from `PROHIBITED_EVERYWHERE` to scoped allowlist (DB pattern) |
| `/capacitor.config.ts` | **Create** — Capacitor project config at root or in `apps/web` |
| `/package.json` | **Modify** — add `@capacitor/core`, `@capacitor/cli`, `@capacitor/ios`, `@capacitor/android` as root devDeps |
| `apps/web/global.css` or `apps/web/src/app/globals.css` | **Create** — design system CSS tokens and responsive breakpoints |
| `apps/web/src/app/**/*.tsx` | **Modify** — replace inline styles with design system tokens, add responsive classnames |

## Approaches

### 1. Full PWA + Capacitor (spec-complete)
- Use `@serwist/next` (maintained fork of `next-pwa`) for the service worker
- Create `manifest.json` and icons manually
- Add Capacitor at root level wrapping the web build
- Add design system CSS and responsive breakpoints
- Update deps guard to allow `@serwist`, `@capacitor/*` in specific workspaces
- **Pros**: Complete per spec, production-ready
- **Cons**: Deps guard needs modification, requires testing on real devices
- **Effort**: Medium

### 2. Manual PWA + Capacitor (no extra NPM deps)
- Write a plain `sw.js` with Workbox CDN or vanilla cache strategy (no NPM dep)
- Create `manifest.json` and icons manually
- Add Capacitor at root level
- Minimal dep guard change (only Capacitor patterns)
- **Pros**: Avoids adding PWA NPM deps, simpler guard update, full control
- **Cons**: More manual SW maintenance, no precaching via Next.js build
- **Effort**: Medium

### 3. PWA-only, defer Capacitor
- Do manifest, SW, responsive design now
- Defer Capacitor to a follow-up change
- **Pros**: Smaller scope, faster to ship, less risk
- **Cons**: Incomplete per spec, native deployment blocked
- **Effort**: Low

## Recommendation

**Approach 1 (Full PWA + Capacitor)** is the right call. The spec is clear, the change is self-contained, and splitting it would delay the capability rather than simplify it.

Key implementation notes:
- Use `@serwist/next` for the service worker — it's the actively maintained evolution of `next-pwa` and handles precaching of Next.js build output
- Capacitor goes at the **root level**, wrapping `apps/web`'s build output as the spec describes
- The deps guard must be updated to move `/workbox/i`, `/@capacitor/i`, `/capacitor-dev/i` from `PROHIBITED_EVERYWHERE` into a new scoped-allow section (like DB packages) that permits them in `apps/web` (PWA) and `apps/mobile` (Capacitor native shell)
- The responsive CSS should integrate the existing Open Design tokens from `DESIGN.md` — this is a prerequisite for the responsive viewport requirement
- The `apps/mobile` Expo app is a SEPARATE thing from the Capacitor shell — the spec is about wrapping the **web PWA** in Capacitor

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Deps guard modification is mandatory and touches an architectural invariant | High | Must be explicit about which workspaces get which capability |
| Next.js 16 + `@serwist/next` compatibility | Medium | Verify `@serwist/next` supports Next.js 16 before committing. If not, fallback to manual SW |
| Capacitor + Next.js output | Medium | Next.js 16 uses the App Router output structure; verify `cap sync` correctly picks up the `out/` or `.next/` directory |
| Open Design tokens not in code | Medium | The web app currently has zero design system integration; adding responsive design will also need to add the CSS custom properties and typography |
| iOS Safari PWA quirks | Low | Separate `apple-mobile-web-app-capable` meta, splash screen handling, status bar styling all need attention |

## Ready for Proposal

Yes. The exploration is thorough, the gaps are clear, and there's a recommended approach with identified risks.
