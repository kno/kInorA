# Design: 06-v1-mobile-foundation

## Technical Approach

Three workstreams, sequenced to unblock each other:

1. **Deps-guard unblock** — Update `scripts/deps-guard.mjs` to move PWA/Capacitor patterns from `PROHIBITED_EVERYWHERE` to a scoped allowlist (mirroring the DB pattern). This must happen first since every subsequent step adds prohibited deps.

2. **PWA foundation** — Install `@serwist/next` in `apps/web`, create `manifest.json`, PWA icons, service worker source (`app/sw.ts`), and an offline fallback page. Wrap `next.config.ts` with `withSerwist`. Add `SerwistProvider` and PWA metadata to `layout.tsx`.

3. **Responsive design system** — Create `apps/web/src/app/globals.css` with the Open Design CSS custom properties (OKLch colors, typography, spacing, radii) and responsive breakpoints. Import the font families. Replace inline styles in existing pages with CSS classes using these tokens. Audit tap targets (≥44px).

4. **Capacitor shell** — Install `@capacitor/core`, `@capacitor/cli`, `@capacitor/ios`, `@capacitor/android` at root. Create `capacitor.config.ts` pointing to `apps/web/.next` (or `out/` if using static export). Verify `cap sync` generates native projects.

## Architecture Decisions

| Decision | Options | Tradeoff | Choice |
|----------|---------|----------|--------|
| Service worker library | `@serwist/next` vs manual `sw.js` vs `next-pwa` | `@serwist/next` handles precaching of Next.js build output automatically; manual SW gives full control but requires maintaining cache lists; `next-pwa` is unmaintained | `@serwist/next` — maintained fork, Next.js 16 compatible via `@serwist/turbopack` |
| Deps-guard pattern | Blanket-allow vs scoped allowlist | Blanket-allow weakens the invariant; scoped allowlist mirrors the existing DB pattern and keeps explicit workspace targets | Scoped allowlist — new `PWA_ALLOWED_WORKSPACES` and `CAPACITOR_ALLOWED_WORKSPACES` arrays |
| Capacitor location | Root level vs `apps/web` | Root wraps the web build output; `apps/web` keeps it co-located but mixes concerns | Root level — Capacitor is a deployment shell, not an app concern |
| Next.js output for Capacitor | `.next/` (server) vs `out/` (static export) vs `.next/static` | Static export (`output: 'export'`) is simplest for Capacitor but loses SSR; `.next` works with `cap sync` but requires a server adapter on native | `.next` with `cap sync` — defer static export decision; Capacitor WebView can load from localhost |
| CSS approach | Tailwind vs CSS modules vs plain CSS custom properties | Tailwind adds a build tool dependency; CSS modules add file overhead for tokens; plain CSS is minimal and matches existing patterns | Plain CSS custom properties in `globals.css` — matches existing inline-style patterns, no build tooling change |
| Font loading | Google Fonts CDN vs self-hosted | CDN is simplest but adds external dependency; self-hosted is better for offline | Google Fonts CDN initially (matches `kinora.css`); self-hosting deferred to follow-up |

## Data Flow

```
User visits web app
    │
    ├─→ Browser loads layout.tsx
    │     ├─ imports globals.css (design tokens + responsive)
    │     ├─ viewport export → theme-color, apple-mobile-web-app-capable
    │     └─ <link rel="manifest"> → manifest.json
    │
    ├─→ SerwistProvider registers service worker (sw.js)
    │     ├─ Precaches Next.js build output
    │     └─ On offline → serves cached fallback page
    │
    └─→ Capacitor shell (native deployment)
          ├─ cap sync ios → ios/ native project
          ├─ cap sync android → android/ native project
          └─ WebView loads web app from localhost
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `scripts/deps-guard.mjs` | Modify | Move PWA/Capacitor patterns from `PROHIBITED_EVERYWHERE` to scoped allowlists; add `apps/web` and root to allowed workspaces for PWA; add `apps/web` for Capacitor |
| `apps/web/package.json` | Modify | Add `@serwist/next` as dependency |
| `apps/web/next.config.ts` | Modify | Wrap config with `withSerwist` from `@serwist/next` |
| `apps/web/app/sw.ts` | Create | Service worker source — precache config + offline fallback handler |
| `apps/web/app/offline/page.tsx` | Create | Offline fallback page — simple branded UI shown when network unavailable |
| `apps/web/public/manifest.json` | Create | PWA manifest with app name, icons, theme_color, display: standalone |
| `apps/web/public/icons/icon-192.png` | Create | PWA icon 192×192 |
| `apps/web/public/icons/icon-512.png` | Create | PWA icon 512×512 |
| `apps/web/public/icons/apple-touch-icon.png` | Create | Apple touch icon 180×180 |
| `apps/web/src/app/layout.tsx` | Modify | Add `themeColor` to viewport, `appleWebApp` metadata, `<link rel="manifest">`, `SerwistProvider`, import `globals.css` |
| `apps/web/src/app/globals.css` | Create | Design system CSS custom properties (OKLch colors, typography, spacing, radii) + responsive breakpoints (320/640/768/1024/1280/1920) |
| `apps/web/src/app/page.tsx` | Modify | Replace inline styles with design system CSS classes |
| `apps/web/src/app/dashboard/page.tsx` | Modify | Replace inline styles with design system CSS classes |
| `apps/web/src/app/(auth)/login/page.tsx` | Modify | Replace inline styles with design system CSS classes |
| `apps/web/src/app/(auth)/sign-up/page.tsx` | Modify | Replace inline styles with design system CSS classes |
| `package.json` (root) | Modify | Add `@capacitor/core`, `@capacitor/cli`, `@capacitor/ios`, `@capacitor/android` as root devDeps |
| `capacitor.config.ts` | Create | Capacitor project config — appId, appName, webDir pointing to `apps/web/.next` |

## Interfaces / Contracts

### CSS Custom Properties (globals.css)

```css
:root {
  /* Surfaces */
  --bg:        oklch(5% 0.006 270);
  --surface:   oklch(11% 0.006 270);
  --surface-2: oklch(15% 0.006 270);
  --border:    oklch(24% 0.006 270);
  --fg:        oklch(96% 0.002 270);
  --muted:     oklch(66% 0.006 270);

  /* Brand accent */
  --accent:    oklch(89% 0.20 128);
  --accent-fg: oklch(5% 0.006 270);

  /* Typography */
  --font-display: 'Space Grotesk', system-ui, sans-serif;
  --font-body:    'DM Sans', -apple-system, system-ui, sans-serif;

  /* Spacing rhythm */
  --sp-1: 8px;  --sp-2: 12px; --sp-3: 16px;
  --sp-4: 24px; --sp-5: 32px; --sp-6: 48px;

  /* Radii */
  --r-card: 18px;
  --r-btn: 12px;
  --r-pill: 999px;
}
```

### Responsive Breakpoints

```css
/* Mobile-first breakpoints */
@media (min-width: 640px)  { /* sm  — large phone */ }
@media (min-width: 768px)  { /* md  — tablet */ }
@media (min-width: 1024px) { /* lg  — small desktop */ }
@media (min-width: 1280px) { /* xl  — desktop */ }
@media (min-width: 1920px) { /* 2xl — large desktop */ }
```

### Capacitor Config

```typescript
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.kinora.app',
  appName: 'kInorA',
  webDir: 'apps/web/.next',
  server: {
    androidScheme: 'https',
  },
};

export default config;
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| PWA manifest | `manifest.json` is valid, served at correct path | Playwright: navigate to `/manifest.json`, assert 200 + correct JSON fields |
| Service worker | SW registers, precaches assets, serves offline fallback | Playwright: intercept network, verify SW registration, simulate offline, assert fallback page renders |
| Responsive layout | Pages render without overflow at 320px–1920px | Playwright viewport tests at 375px, 768px, 1280px, 1920px — assert no horizontal scroll, no overflow |
| Tap targets | Interactive elements ≥44px | Playwright: query all buttons/links, assert min dimensions |
| Design tokens | CSS custom properties resolve correctly | Playwright: evaluate computed styles, assert `--accent` resolves to expected OKLch value |
| Capacitor sync | `cap sync` generates native projects | Manual verification: run `npx cap sync ios` and `npx cap sync android`, check output directories exist |
| Deps guard | New packages pass the guard | `pnpm deps-guard` — must exit 0 |

## Migration / Rollout

1. **Deps-guard first** — Commit the guard change alone so subsequent commits can add packages without failing CI.
2. **PWA + responsive** — Single commit adding manifest, SW, design tokens, and responsive fixes. All pages use new tokens.
3. **Capacitor** — Separate commit adding Capacitor deps and config. This is isolated from the web app.
4. **No data migration** — This change adds client-side capabilities only. No schema, API, or persistence changes.
5. **No feature flags** — PWA features activate automatically via manifest + SW registration. Capacitor is opt-in (run `cap sync` manually).

## Open Questions

- [ ] Does `@serwist/next` support Next.js 16 App Router? The docs show `@serwist/turbopack` for newer setups. Need to verify which package to use (`@serwist/next` vs `@serwist/turbopack`).
- [ ] Capacitor `webDir`: Next.js 16 App Router uses `.next/` by default, but Capacitor needs static files. May need `output: 'export'` in `next.config.ts` to produce `out/` directory.
- [ ] Should the offline fallback page be a static HTML file or a Next.js page? Static is simpler for Capacitor; Next.js page requires SSR which Capacitor can't provide natively.
