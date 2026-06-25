# Exploration: 06b-v1-orbit-ui-shell

## Current State Summary

### 1. Design Tokens (`apps/web/src/app/globals.css`)

**Already matches the Orbit/Open Design spec closely:**
- Surfaces: `--bg`, `--surface`, `--surface-2`, `--border`, `--fg`, `--muted` — exact OKLch values match `docs/open-design-kinora.md`
- Accent: `--accent` (`oklch(89% 0.2 128)`) and `--accent-fg` — correct
- Typography: Space Grotesk + DM Sans imported from Google Fonts, scale tokens present
- Spacing: 8px rhythm (`--sp-1` through `--sp-6`)
- Radii: `--r-card: 18px`, `--r-btn: 12px`, `--r-pill: 999px`
- States: success, warning, danger, info

**Missing tokens (present in the Open Design CSS but not in globals.css):**
- `--accent-dim`: `oklch(89% 0.20 128 / 0.12)` — used heavily in the design reference for active nav items, pill-active states, hover accents, and the AI icon. Every screen's CSS defines it.

**Utility classes defined:** `.kin-page`, `.kin-card`, `.kin-hero`, `.kin-title`, `.kin-btn`, `.kin-input`, `.kin-form`, `.kin-error`, `.kin-link`, etc. All use the custom properties above.

### 2. Open Design Source (`docs/open-design-kinora.md` + local snapshot)

The local snapshot at `docs/open-design/kinora/` contains:
- `DESIGN.md` — Full design system spec (surfaces, typography, layout, anti-patterns)
- `assets/kinora.css` — Shared CSS tokens and primitive classes (`.card`, `.btn`, `.pill`, `.chip`, `.progress-track`, etc.)
- `index.html` — Overview linking all 10 screens
- 10 screen HTML files (5 web + 5 mobile)

**Web surfaces in the design:**
| Screen | Key structure |
|--------|--------------|
| `web-landing.html` | Sticky nav with brand + links + CTA, hero grid with phone mock, trust strip (4-column), how-it-works (3 steps), feature grid (2×2), pricing (3 tiers), CTA band, footer with link columns + social |
| `web-dashboard.html` | **Sidebar shell** (248px) with wordmark, nav items (Inicio, Mi plan, Estadísticas, Crear plan, Ejercicios), user avatar/bottom section; main area with topbar, greeting, metrics row, workout card, weekly check-in, mini chart, AI suggestion |
| `web-plan.html` | Same sidebar shell, different content |
| `web-stats.html` | Same sidebar shell, analytics content |
| `web-create-plan.html` | Same sidebar shell, plan creation content |

**Mobile surfaces:** Each uses a fixed bottom tab bar (Inicio, Plan, Crear [FAB], Stats, Perfil) with width constrained to 390px viewport.

### 3. Current Layout (`apps/web/src/app/layout.tsx`)

**Very thin — no shell, no auth awareness:**
- Wraps children in `<html lang={locale}><body><SerwistProvider>`
- Resolves locale from `Accept-Language` header
- Imports `globals.css`
- No sidebar, no navigation, no auth-state detection
- PWA metadata (viewport, icons, manifest, apple-web-app)

### 4. Current Landing Page (`apps/web/src/app/page.tsx`)

**Minimal placeholder:**
- Renders a centered hero with `messages.title`, `messages.subtitle`, and a CTA link (`#`)
- Uses `kin-page`, `kin-hero`, `kin-hero__title`, `kin-hero__subtitle`, `kin-btn` classes
- Locale-aware via `resolveLocale` + `loadMessages`
- The Open Design reference shows a full page with: sticky nav, hero with phone mock, trust strip, how-it-works steps, feature grid, pricing cards, CTA band, and footer

### 5. Current Dashboard (`apps/web/src/app/dashboard/page.tsx`)

**Minimal auth confirmation page:**
- Heading "Dashboard", paragraph "You are authenticated", logout button
- Uses `kin-page`, `kin-card`, `kin-title`, `kin-text`, `kin-btn--danger`
- No sidebar, no data, no shell
- The Open Design reference shows a rich dashboard with sidebar, metrics, workout, check-in, charts

### 6. Auth Pages (`login/page.tsx`, `sign-up/page.tsx`)

- Both are complete functional forms: email/password + social login option
- Server actions wired (`loginAction`, `signupAction`)
- Styled with `kin-*` classes from globals.css
- Error handling via `?error=` search param
- Switch links between login/sign-up
- No shell needed — these are standalone public pages under `(auth)` route group

### 7. Auth Proxy (`apps/web/src/proxy.ts`)

- Gates protected routes by checking `kinora_session` cookie
- HTML navigation: redirects to `/login?from=`
- API/XHR: returns 401 JSON
- **Protected matcher currently:** `["/dashboard/:path*", "/plan/:path*", "/profile/:path*"]`
- **NOT covering:** `/stats`, `/create-plan`, `/exercises`, or any new app routes from the design

### 8. Auth Gate (`apps/web/src/auth-gate.ts`)

- Pure function, well-tested (5 + 8 tests)
- Returns `pass`, `redirect`, or `unauthorized`
- Session check: cookie present + non-empty + non-whitespace
- No issues here

### 9. Route Structure (existing pages)

| Route | File | Current State |
|-------|------|---------------|
| `/` | `page.tsx` | Minimal placeholder landing |
| `/dashboard` | `dashboard/page.tsx` | Minimal placeholder, no shell |
| `/login` | `(auth)/login/page.tsx` | Functional, styled |
| `/sign-up` | `(auth)/sign-up/page.tsx` | Functional, styled |
| `/offline` | `offline/page.tsx` | Static offline fallback (inline styles, no design tokens) |

**Missing routes (from design reference):** `/plan`, `/stats`, `/create-plan`, `/exercises`, `/profile`

### 10. Components

**No `apps/web/src/components/` directory exists.** All UI is inline in page files, using CSS classes from `globals.css`.

### 11. i18n Messages (`apps/web/src/i18n/messages/en.json`)

Only 3 keys: `title`, `subtitle`, `cta`. The full landing page will need substantially more messages.

---

## Gap Analysis

| Requirement | Current State | Gap |
|---|---|---|
| Orbit tokens applied | Tokens match except `--accent-dim` | Add `--accent-dim` token |
| Dark-only surfaces | `globals.css` is dark-only, correct | ✓ No gap |
| Public landing page | Minimal hero, no features/steps/pricing/footer | Full rebuild needed from Open Design web-landing |
| Responsive app shell (sidebar + bottom nav) | No shell exists | New `AppShell` component needed |
| Desktop sidebar nav | None | 5 nav items: Inicio, Mi plan, Estadísticas, Crear plan, Ejercicios |
| Mobile bottom nav | None | 5 tabs: Inicio, Plan, Crear (FAB), Stats, Perfil |
| Auth-aware shell | Layout has no auth detection | Need to check session in root or route-group layout |
| Dashboard in shell | Bare page | Needs shell wrapping + placeholder content |
| Scaffold pages for plan/stats/create-plan/exercises | None exist | Create with shell + placeholder state |
| Proxy matcher covers new routes | Only `/dashboard`, `/plan`, `/profile` | Add `/stats`, `/create-plan`, `/exercises` |
| i18n messages for landing | 3 keys only | Expand messages for full landing sections |
| Component primitives | All inline, no component files | Create reusable shell components |

---

## Key Constraints & Risks

1. **No component base exists** — This is the first UI work in `apps/web`. Need to establish component patterns (file structure, naming, test conventions) without prior examples to follow.

2. **Auth detection in layout** — The root layout is a server component. If we use a route group (`(app)`), we can check `cookies()` there. But offline/landing pages shouldn't see the sidebar. The design shows different navs for public (landing's own sticky nav) vs. authenticated (sidebar/ bottom nav).

3. **Landing page complexity** — The Open Design landing is substantial (~724 lines HTML + CSS). Translating to React components without a `components/` directory means either a large single file or establishing the component structure as part of this change.

4. **Mobile shell width** — The Open Design mobile screens are designed for iPhone (390px viewport). On wider phones the bottom tab bar needs `max-width` constraint and centering. The current CSS for mobile has `width: 390px` hardcoded which won't work across devices.

5. **Proxy matcher expansion risk** — Adding routes to the proxy matcher means they become protected. If the shell pages don't exist yet or the routes are wrong, users could hit 404s or be redirected incorrectly. Must be done carefully.

6. **Offline page** — Uses inline styles instead of design tokens. Not critical for this change (it's a fallback screen) but worth noting.

7. **i18n scope** — The landing page in the Open Design reference is in Spanish. The project convention is English for UI copy. The messages need to be authored in English, with Spanish as an option later.

---

## Recommendations

### 1. Add `--accent-dim` token to globals.css

```css
--accent-dim: oklch(89% 0.20 128 / 0.12);
```

This is used by every Open Design screen for active states, hover states, and backgrounds. Without it, active nav items and pills won't render correctly.

### 2. Use Next.js route group for authenticated shell

Create `apps/web/src/app/(app)/layout.tsx` — a route-group layout that:
- Checks session cookie (via `cookies()` from `next/headers`)
- Renders `AppShell` (sidebar desktop + bottom nav mobile) around children

This keeps the root layout clean (PWA, Serwist, locale) and the app shell isolated.

### 3. Create AppShell component

Under `apps/web/src/components/AppShell/`:
- `AppShell.tsx` — shell wrapper with sidebar + bottom nav
- `SidebarNav.tsx` — desktop sidebar (248px, nav items, user bottom section)
- `MobileNav.tsx` — mobile bottom tab bar with FAB
- CSS module or shared classes

Nav items from design:
- Desktop: Dashboard (Inicio), Plan (Mi plan), Statistics (Estadísticas), Create Plan (Crear plan), Exercises (Ejercicios)
- Mobile: Home (Inicio), Plan, Create (FAB, centered), Stats, Profile (Perfil)

### 4. Rebuild landing page

Translate `web-landing.html` into React components:
- `LandingNav` (sticky, brand + nav links + CTA/login)
- `LandingHero` (headline + subtitle + CTA + phone mock)
- `TrustStrip` (4-column value props)
- `HowItWorks` (3 steps)
- `FeatureGrid` (4 feature cards)
- `PricingSection` (3 tiers: Free, Pro, Teams)
- `CTABand`
- `Footer`

Keep the existing `kin-*` CSS class convention where the classes already exist, and extend `globals.css` with new landing-specific classes.

### 5. Enrich i18n messages

Expand `en.json` to cover landing sections. The Open Design reference has Spanish copy — translate to English for the canonical messages.

### 6. Create scaffold pages

For each missing route, create a page under `(app)/` route group that wraps in the shell with placeholder content:
- `(app)/plan/page.tsx`
- `(app)/stats/page.tsx`
- `(app)/create-plan/page.tsx`
- `(app)/exercises/page.tsx`
- `(app)/profile/page.tsx` (already in proxy matcher)

### 7. Update proxy matcher

Add to `proxy.ts` config:
```ts
matcher: ["/dashboard/:path*", "/plan/:path*", "/profile/:path*", "/stats/:path*", "/create-plan/:path*", "/exercises/:path*"]
```

### 8. Keep the dashboard page content

Move the existing dashboard content into the shell and add placeholder data sections matching the Open Design dashboard layout (metrics row, today's workout, weekly check-in, mini chart, AI suggestion — all as non-functional UI).

---

## Effort Estimate

| Area | Estimated Effort |
|------|-----------------|
| Tokens (`--accent-dim`) | Trivial |
| AppShell + SidebarNav + MobileNav | Medium |
| Landing page rebuild | High (largest surface) |
| i18n messages expansion | Low |
| Dashboard migration to shell | Low |
| Scaffold pages (plan, stats, create-plan, exercises, profile) | Low-Medium (5 pages) |
| Offline page token-ification | Low (optional) |
| Proxy matcher update | Trivial |
| **Total** | **Medium-High** |

The bulk of the effort is the landing page translation and establishing the AppShell component pattern.

## Ready for Proposal

**Yes.** The spec is clear, the design reference is comprehensive, and the gaps are well-defined. The orchestrator can move to the proposal phase.
