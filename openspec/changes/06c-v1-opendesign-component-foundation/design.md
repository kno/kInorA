# Design: 06c Open Design Component Foundation

## Technical Approach

Implement the accepted `06c-v1-opendesign-component-foundation` spec as a foundation-only visual bridge before `07-v1-plan-wizard`. First refresh `docs/open-design/kinora/` from the live `kiNorA` Open Design project (`ceeff5f6-0930-4e48-a0b0-17a6a5c9b9ad`) and record provenance. Then add a shared web icon layer and reusable Orbit primitives that replace repeated ad-hoc SVG/component patterns without implementing plan, analytics, tracking, billing, or chat behavior. Current Open Design HTTP tools are unavailable in this agent; implementation is blocked until the working sidecar/stdio MCP path can fetch current files.

## Architecture Decisions

| Decision | Choice | Alternatives considered | Rationale |
|---|---|---|---|
| Open Design refresh gate | Refresh via live MCP before web code changes; update manifest/source docs | Use stale snapshot; hand-copy design details | The spec requires current source synchronization and user explicitly rejected stale snapshot fallback. |
| Icon foundation | Create app-level `components/icons` exports that can wrap imported SVGs and approved library glyphs | Keep inline SVGs; import libraries directly in screens | Stable exports remove ad-hoc imports while preserving source flexibility and accessibility defaults. |
| Primitive scope | Add only recurring Orbit primitives visible in refreshed designs and existing screens | Full component library extraction | Keeps review below budget and avoids product behavior/spec creep. |
| Styling model | Prefer existing CSS tokens/global `kin-*` contracts plus component CSS modules where state/variants belong | Rewrite token system | Existing 06b Orbit tokens in `globals.css` are already the app contract. |

## Data Flow

```text
Open Design MCP ──> docs/open-design/kinora snapshot + manifest
        │                         │
        └── source/deviation log ─┴──> docs/open-design-kinora.md

snapshot references ──> icons + primitives ──> AppShell / landing proof usage
```

## File Changes

| File | Action | Description |
|---|---:|---|
| `docs/open-design/kinora/**` | Modify | Refresh live snapshot files and manifest with imported screens/icons/component references. |
| `docs/open-design-kinora.md` | Modify | Add refresh trace, source/deviation workflow, and visual verification checklist. |
| `apps/web/src/components/icons/*` | Create | Shared icon component, named exports, imported SVG/library wrappers, and tests. |
| `apps/web/src/components/orbit/*` | Create | Reusable card, section header, metric block, nav affordance, empty state, and CTA surface primitives. |
| `apps/web/src/components/AppShell/{SidebarNav,MobileNav}.tsx` | Modify | Replace duplicated nav/FAB inline SVGs with shared icons as the smallest proof. |
| `apps/web/src/components/landing/*.tsx` | Modify | Replace only repeated icon/primitive usage needed to prove the foundation. |
| `apps/web/src/app/globals.css` | Modify | Add minimal shared visual classes only when primitives cannot be isolated in CSS modules. |

## Interfaces / Contracts

```ts
export type KinIconName = "home" | "plan" | "stats" | "create" | "exercises" | string;
export interface KinIconProps extends React.SVGProps<SVGSVGElement> {
  name: KinIconName;
  size?: 16 | 20 | 24 | 32;
  decorative?: boolean;
  title?: string;
}
```

Icons default to `decorative: true`, `aria-hidden`, `currentColor`, consistent viewBox/sizing, and no direct screen-level third-party icon imports. Orbit primitives expose semantic React components with `className` escape hatches, not business-state props.

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | Icon accessibility, sizing, currentColor, stable export names | Vitest render/tree or `renderToString` tests under `components/icons/__tests__`. |
| Unit | Primitive structure, classes, semantic tags, CTA/link accessibility | Existing React element inspection pattern in `components/orbit/__tests__`. |
| Integration | AppShell/landing proof consumers keep routes, labels, active state | Existing component tests updated after RED failures. |
| Visual/manual | Pixel alignment and deviations | Checklist in `docs/open-design-kinora.md`; compare refreshed snapshot to implemented proof surfaces. |

## Migration / Rollout

No data migration required. Roll out as review slices if snapshot diff plus code exceeds 400 changed lines: first snapshot/docs, then icon/primitive foundation and proof migrations.

## Open Questions

- [ ] Blocker: current Open Design details could not be fetched through available HTTP tools; implementation must use the working sidecar/stdio MCP before proceeding.
- [ ] Exact recurring primitive list must be finalized from the refreshed live snapshot, not the stale local copy.
