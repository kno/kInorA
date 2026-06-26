## Exploration: 06c-v1-opendesign-component-foundation

### Current State
The accepted source spec already exists at `openspec/specs/06c-v1-opendesign-component-foundation/spec.md` and is listed in the README roadmap as the bridge between the Orbit shell and later product screens. OpenSpec is configured for strict TDD, Clean Architecture boundaries, and OpenSpec filesystem persistence under `openspec/changes/{change-name}/`.

The local Open Design snapshot lives under `docs/open-design/kinora/` with `snapshot-manifest.json`, `DESIGN.md`, `assets/kinora.css`, `index.html`, and screen HTML files. The manifest was last pulled on `2026-06-22T04:28:15.227Z`, with a partial brand-file refresh at `2026-06-22T04:32:59.543Z`. `docs/open-design-kinora.md` documents the refresh workflow and the `kiNorA` MCP project id `ceeff5f6-0930-4e48-a0b0-17a6a5c9b9ad`. During exploration, the Open Design daemon was not reachable at `http://127.0.0.1:7456`, so implementation must start by restoring MCP access before refreshing the snapshot.

The web app already has the Orbit shell baseline from 06b: global `kin-*` tokens and landing CSS in `apps/web/src/app/globals.css`, app shell components under `apps/web/src/components/AppShell/`, and scaffolded protected pages under `apps/web/src/app/(app)/`. Icon usage is currently ad hoc: repeated inline SVGs exist in `SidebarNav.tsx`, `MobileNav.tsx`, and landing components. There is no shared app-level icon foundation and no reusable component primitive layer for Orbit cards, pills, metric blocks, section headers, empty states, or CTA surfaces beyond broad CSS utility classes.

Testing is Vitest-based. UI tests currently inspect React trees or rendered HTML for text, classes, accessibility attributes, links, and route state. Quality guards expected for this slice are `pnpm --filter web test`, `pnpm --filter web type-check`, and the repo-level `pnpm architecture`, `pnpm deps-guard`, and `pnpm build` before completion.

### Affected Areas
- `openspec/specs/06c-v1-opendesign-component-foundation/spec.md` — accepted requirements this change implements.
- `docs/open-design-kinora.md` — refresh instructions, MCP project id, and source-of-truth rules.
- `docs/open-design/kinora/` — snapshot files to refresh and review for imported screens/icons/component references.
- `apps/web/src/app/globals.css` — existing global token and landing primitive layer; likely needs small shared visual class additions only if CSS modules are insufficient.
- `apps/web/src/components/AppShell/SidebarNav.tsx` — has inline nav SVGs that should move to shared icons.
- `apps/web/src/components/AppShell/MobileNav.tsx` — duplicates nav/FAB inline SVGs and should consume shared icons.
- `apps/web/src/components/landing/*.tsx` — uses repeated inline SVGs for benefits, pricing, footer, and hero details.
- `apps/web/src/components/` — likely home for new shared `icons` and `ui`/visual primitives.
- `apps/web/src/components/**/__tests__/*.test.tsx` and `apps/web/src/app/**/__tests__/*.test.tsx` — current UI TDD pattern for component contracts.
- `apps/web/package.json`, `package.json` — confirm no existing icon dependency; adding one would need explicit proposal justification.

### Approaches
1. **Local shared SVG foundation plus focused visual primitives** — Create a small typed icon registry from Open Design-relevant SVG paths/components and a narrow set of reusable Orbit visual primitives, then migrate existing repeated inline icons to prove the foundation.
   - Pros: Keeps dependencies unchanged, aligns with current inline SVG style, minimizes bundle/security risk, and can fit the 400-line review budget if sliced carefully.
   - Cons: Manual icon curation requires discipline and visual review against refreshed Open Design; too many primitives could still exceed the review budget.
   - Effort: Medium

2. **Introduce a third-party icon library wrapper** — Add a maintained icon package behind app-level exports and build primitives around those exports.
   - Pros: Faster icon breadth and consistent SVG behavior.
   - Cons: Current app has no icon dependency; matching Open Design may be imperfect, dependency policy requires justification, and replacing Open Design-specific glyphs may reduce pixel alignment.
   - Effort: Medium

3. **Full component extraction from refreshed Open Design screens** — Translate the refreshed screen HTML into a broad component library in one change.
   - Pros: Maximizes future reuse and direct visual coverage.
   - Cons: High risk of copying generated HTML patterns, exceeding the 400-line review budget, and accidentally implementing product behavior reserved for later specs.
   - Effort: High

### Recommendation
Use Approach 1 and keep the proposal scoped to a first foundation slice: restore Open Design MCP access, refresh the local snapshot, document imported/changed design references, add a typed shared icon foundation, and add only the visual primitives repeatedly needed by 07+ screens. The first slice should migrate existing shell/landing inline icons just enough to prove the icon API, plus add tests for icon accessibility defaults and primitive class/structure contracts. Defer product-specific create-plan, workout, analytics, billing, and conversational behavior.

Recommended review boundary: split implementation if necessary into (1) snapshot refresh artifact-only changes and (2) web icon/component foundation changes. With the ask-always chained PR strategy and 400-line budget, proposal/tasks should flag chained PRs as likely if the Open Design refresh produces large diffs.

### Risks
- Open Design MCP is currently unreachable via the HTTP bridge; implementation cannot satisfy the refresh requirement until the daemon/stdio MCP access works.
- Snapshot refresh may produce large HTML/CSS diffs that consume the 400-line review budget before code changes start.
- Icon migration can balloon if every landing glyph is replaced at once; prove the foundation with a limited migration and leave full adoption to later screens where possible.
- Pixel-perfect alignment is hard to prove with current Vitest-only UI tests; visual deviations should be documented manually unless a visual regression tool is added later.
- Broad primitives can become speculative abstractions; define only recurring Orbit patterns visible across refreshed web dashboard, create-plan, plan, stats, and landing references.

### Ready for Proposal
Yes — propose a narrow 06c change that refreshes Open Design, establishes shared visual primitives/icons, documents deviations, and explicitly excludes product behavior. The orchestrator should surface the MCP connectivity issue and the likely need for chained PR review slices if snapshot diffs are large.
