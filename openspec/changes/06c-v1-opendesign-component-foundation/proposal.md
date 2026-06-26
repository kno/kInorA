# Proposal: 06c Open Design Component Foundation

## Intent

Implement the roadmap bridge between `06b-v1-orbit-ui-shell` and `07-v1-plan-wizard`: refresh the authoritative Open Design source, then establish shared icons and reusable Orbit visual primitives so future screens stay pixel-aligned instead of inventing UI per feature.

## Scope

### In Scope
- Refresh `docs/open-design/kinora/` from the live Open Design MCP source and make imported screens/icons/component references traceable.
- Create a shared app-level icon foundation that can expose imported Open Design SVGs and wrapped library icons behind one API.
- Define reusable visual primitives for recurring patterns visible across existing implemented screens and refreshed Open Design designs.
- Document visual deviations and component usage guidance for future screen work.

### Out of Scope
- Plan wizard behavior, AI generation, tracking, analytics, billing, memory, or chat workflows.
- Broad design-system rewrite beyond recurring Orbit patterns needed by upcoming screens.
- Proceeding from stale local snapshots when Open Design MCP/source is unavailable.

## Capabilities

### New Capabilities
- None

### Modified Capabilities
- None — this change implements the accepted `06c-v1-opendesign-component-foundation` source spec without changing spec-level requirements.

## Approach

Restore Open Design MCP access first, refresh the local snapshot, then compare refreshed assets with already implemented shell/landing screens. Add a typed icon registry and a narrow primitive layer for cards, section headers, metric blocks, navigation affordances, empty states, CTA surfaces, and other recurring patterns confirmed in Open Design. Prove the foundation with focused usage/tests, not product behavior.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `docs/open-design/kinora/` | Modified | Refreshed snapshot and traceable source artifacts. |
| `docs/open-design-kinora.md` | Modified | Refresh/source and deviation guidance if needed. |
| `apps/web/src/components/` | New/Modified | Shared icon exports and visual primitives. |
| `apps/web/src/components/AppShell/` | Modified | Consume shared icons where useful to prove API. |
| `apps/web/src/components/landing/` | Modified | Replace only repeated ad-hoc icon/pattern usage needed to prove foundation. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Open Design MCP remains unavailable | High | Block implementation until source can be refreshed and verified. |
| Snapshot refresh exceeds review budget | Med | Slice artifact refresh separately from component foundation. |
| Primitive scope grows speculative | Med | Include only recurring patterns visible in refreshed designs. |
| Icon source mismatch | Med | Wrap both Open Design SVGs and approved library icons behind shared exports. |

## Rollback Plan

Revert the OpenSpec change implementation, refreshed snapshot files, shared icon/primitive additions, and any limited consumer migrations. Existing shell/landing behavior should return to pre-foundation inline icons and classes.

## Dependencies

- Live Open Design MCP/source access for `kiNorA` before implementation.
- Existing 06b Orbit shell and roadmap placement before 07 plan wizard.

## Success Criteria

- [ ] Local Open Design snapshot is refreshed from MCP and traceable.
- [ ] Shared icons provide consistent naming, sizing, stroke/fill, and accessibility defaults.
- [ ] Recurring Orbit primitives exist with usage guidance and focused tests.
- [ ] No product behavior from later specs is implemented.
- [ ] Review plan flags likely slicing for snapshot refresh plus component foundation.
