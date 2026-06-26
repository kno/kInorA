# Design: 06b-v1-orbit-ui-shell

## Technical Approach

Apply Orbit brand from the Open Design snapshot. Use a Next.js route group `(app)` for authenticated pages with a responsive AppShell (desktop 248px sidebar / mobile bottom nav with FAB). Rebuild the public landing page from the design reference using existing `kin-*` CSS conventions extended with new classes in `globals.css`. No new framework — keep vanilla CSS with OKLch custom properties.

## Architecture Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Shell auth model | Proxy guarantees auth; shell does not re-check | `(app)` routes are proxy-gated — reaching them implies valid session |
| Component styling | CSS modules for shell; `globals.css` classes for landing | Matches existing `kin-*` convention. CSS modules for reusable components establish clean boundary |
| Landing CSS location | New landing classes in `globals.css` | Landing is a single page — avoids premature abstraction |
| Active nav state | `usePathname()` in client wrapper | Simplest route-matching API for App Router |
| SVG icons | Inline per component | Only 5-6 distinct icons — extract when patterns emerge |
| Breakpoint | 768px sidebar/bottom-nav switch | Matches existing `md` breakpoint in globals.css |

## Data Flow

```
Request → Proxy (auth gate) → (app)/layout → AppShell
              ↓                         ├─ SidebarNav (≥768px)
         /login?from=                   ├─ MobileNav (<768px)
              (unauthenticated)         └─ {children} (main content)

Active route: usePathname() → nav highlights matching item via CSS class
```

## File Changes

| File | Action | Description |
|---|---|---|
| `apps/web/src/app/globals.css` | Modify | Add `--accent-dim` + landing section CSS classes |
| `apps/web/src/app/page.tsx` | Modify | Replace minimal hero with full landing (8 sections) |
| `apps/web/src/i18n/messages/en.json` | Modify | Expand from 3 to ~60 keys for landing sections |
| `apps/web/src/components/AppShell/AppShell.tsx` | Create | Client wrapper: viewport detection, sidebar/mobile-nav, children slot |
| `apps/web/src/components/AppShell/AppShell.module.css` | Create | Shell responsive layout |
| `apps/web/src/components/AppShell/SidebarNav.tsx` | Create | Desktop sidebar: wordmark, 5 nav items, user area |
| `apps/web/src/components/AppShell/SidebarNav.module.css` | Create | 248px fixed, active state with `--accent-dim` + 3px left border |
| `apps/web/src/components/AppShell/MobileNav.tsx` | Create | Fixed bottom bar: 4 tabs + centered FAB |
| `apps/web/src/components/AppShell/MobileNav.module.css` | Create | Tab bar, FAB circle (48px lime), safe area padding |
| `apps/web/src/components/landing/LandingNav.tsx` | Create | Sticky nav: brand, links, login/CTA buttons |
| `apps/web/src/app/(app)/layout.tsx` | Create | Route-group layout rendering `<AppShell>{children}</AppShell>` |
| `apps/web/src/app/(app)/dashboard/page.tsx` | Move | Migrate from `dashboard/` — placeholder metrics layout in shell |
| `apps/web/src/app/(app)/plan/page.tsx` | Create | Scaffold — shell + placeholder |
| `apps/web/src/app/(app)/stats/page.tsx` | Create | Scaffold — shell + placeholder |
| `apps/web/src/app/(app)/create-plan/page.tsx` | Create | Scaffold — shell + placeholder |
| `apps/web/src/app/(app)/exercises/page.tsx` | Create | Scaffold — shell + placeholder |
| `apps/web/src/app/(app)/profile/page.tsx` | Create | Scaffold — shell + placeholder |
| `apps/web/src/proxy.ts` | Modify | Add `/stats`, `/create-plan`, `/exercises` to matcher |
| `apps/web/src/app/dashboard/page.tsx` | Delete | Content migrated to `(app)/dashboard/` |

## Landing Page Structure

LandingNav (sticky) → Hero (eyebrow, h1, CTAs, phone mock) → TrustStrip (4-col) → HowItWorks (3 steps) → FeatureGrid (2×2) → Pricing (3 tiers) → CTABand → Footer. Grids collapse at 980/760/480px.

## AppShell Design

**Desktop (≥768px)**: Sidebar fixed 248px, nav items 44px tall, active state uses `--accent-dim` background + 3px accent left indicator. Main area `margin-left: 248px`, max-width `1200px + 248px`. User area at sidebar bottom with avatar + name + plan badge.

**Mobile (<768px)**: Bottom tab bar with Home/Plan/Create(+)/Stats/Profile. FAB is a 48px lime filled circle centered in the bar, elevated. Content area has `padding-bottom` for bar clearance.

Nav items (desktop): Dashboard, My Plan, Statistics, Create Plan, Exercises. Labels in English per project convention.

## Testing Strategy

| Layer | What | Approach |
|---|---|---|
| Unit | Landing components render correct i18n + structure | Vitest + @testing-library/react |
| Unit | Shell shows sidebar on ≥768px, hidden on <768px | Mock `window.matchMedia` |
| Unit | Nav active state highlights correct item | Assert `active` class via `usePathname()` |
| Unit | MobileNav FAB href is `/create-plan` | Assert link + class |
| Integration | Proxy matcher covers new routes | Extend `evaluateAuthGate` tests (13 existing) |

Playwright E2E deferred — no infra exists yet.

## PR Slicing

| PR | Focus | Est. lines |
|---|---|---|
| **#1** | Tokens + Landing page + i18n + landing components | ~380 |
| **#2** | AppShell + `(app)` layout + dashboard migration + proxy matcher | ~280 |
| **#3** | Scaffold pages (5 routes) | ~150 |

Dependencies: #3 needs #2. #1 and #2 are independent (different files).

## Open Questions

- **User identity in shell**: Placeholder initials until profile endpoint exists.
- **Mobile max-width**: Recommend `max-width: 480px; margin: 0 auto` on mobile shell to preserve design proportions on larger phones.
