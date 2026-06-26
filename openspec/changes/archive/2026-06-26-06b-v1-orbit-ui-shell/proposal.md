# Proposal: 06b-v1-orbit-ui-shell

## Intent

Apply the **Orbit** brand. Current app has no brand identity, navigation, or shell — users see a bare hero and text-only dashboard.

## Scope

### In Scope
- Add `--accent-dim` token + landing CSS to globals.css
- Rebuild landing page: sticky nav, hero, trust strip, how-it-works, feature grid, pricing, CTA, footer
- Create AppShell (desktop sidebar + mobile bottom nav + FAB)
- Create `(app)` route-group layout with auth-aware shell
- Scaffold pages: plan, stats, create-plan, exercises, profile (non-functional)
- Migrate dashboard into shell with placeholder content
- Enrich i18n messages (English) for landing
- Update proxy matcher for new routes

### Out of Scope
- Data-backed features, real metrics, Tailwind migration, light theme, landing forms beyond CTA, offline page refresh

## Capabilities

### New Capabilities
- `orbit-design-system`: Brand tokens, typography, spacing, dark-only surfaces, accent rules from Open Design
- `landing-page`: Public marketing landing page
- `app-shell`: Responsive authenticated shell with sidebar (desktop) and bottom nav (mobile)
- `screen-scaffolds`: Non-functional placeholder pages for future feature routes

### Modified Capabilities
- None — auth proxy matcher additions are implementation-only

## Approach

1. Add `--accent-dim` + landing classes to `globals.css`
2. Create `apps/web/src/components/AppShell/` (AppShell, SidebarNav, MobileNav)
3. Create `apps/web/src/app/(app)/layout.tsx` — session check + AppShell wrapper
4. Translate `web-landing.html` into page components with `kin-*` classes
5. Scaffold each missing route under `(app)/` with placeholder
6. Expand `en.json` with landing section keys
7. Add `/stats`, `/create-plan`, `/exercises` to proxy matcher

## Delivery Plan (Chained PRs)

| PR | Focus | Est. lines |
|----|-------|-----------|
| #1 | Tokens + Landing page + i18n | ~350 |
| #2 | AppShell + route group + dashboard + proxy | ~250 |
| #3 | Scaffold pages (5 routes) | ~200 |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Landing design is ~724 lines, oversized PR | Med | Slice into components, budget PR #1 at 350 |
| Shell auth detection gaps | Low | Use `(app)` group with `cookies()` — standard Next.js |

## Rollback Plan

Revert each PR merge commit in reverse order. UI-only change — no DB or API rollback needed.

## Dependencies

Open Design snapshot at `docs/open-design/kinora/` (local, no MCP required)

## Success Criteria

- [ ] Landing renders hero, features, how-it-works, pricing, CTA, footer with Orbit tokens
- [ ] Desktop sidebar shows 5 nav items; mobile shows 5 tabs with FAB
- [ ] All 6 protected routes render inside shell with correct active nav state
- [ ] Unauthenticated visitors see landing → reach login
- [ ] Proxy matcher covers all new routes
- [ ] `--accent-dim` visible in active nav items / pill backgrounds
