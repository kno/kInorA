# kInorA AI Operating Guide

This file defines how AI agents must work in this repository. Treat it as the project contract: protect architecture, preserve product intent, and make every change reviewable.

## Quick rules

- Follow SDD for product or code changes: propose → spec → design → tasks → apply → verify → archive.
- Follow strict TDD for implementation: RED → GREEN → Triangle edge cases.
- Keep Clean Architecture boundaries intact. Dependency direction is not negotiable.
- Prefer existing project patterns, design-system primitives, and proven libraries over new abstractions.
- Keep changes small, explicit, and easy to review. KISS and YAGNI win by default.
- Do not commit or open PRs until tests, type checks, dependency guards, and architecture checks pass.

## Repository shape

| Area | Responsibility |
|---|---|
| `packages/domain` | Enterprise/domain rules. No framework, UI, database, network, or runtime dependencies. |
| `packages/contracts` | Shared API/data contracts and validation boundaries. |
| `apps/api` | Backend delivery layer and adapters. It depends inward on contracts/domain. |
| `apps/web` | Frontend delivery layer, UI composition, and client adapters. |
| `openspec/` | Source of truth for accepted specifications and archived change history. |

Run the existing guards before considering implementation complete:

```bash
pnpm type-check
pnpm test
pnpm architecture
pnpm deps-guard
pnpm build
```

## SDD workflow

Use SDD for every non-trivial product, behavior, architecture, data-model, security, or API change.

1. **Propose**: clarify the business problem, target users, scope, non-goals, and tradeoffs.
2. **Spec**: define observable requirements and scenarios in `openspec/specs/` or the active change folder.
3. **Design**: describe architecture, boundaries, risks, data flow, and alternatives rejected.
4. **Tasks**: break implementation into reviewable work units with verification steps.
5. **Apply**: implement only approved tasks, preserving task traceability.
6. **Verify**: prove behavior against specs with tests and checks.
7. **Archive**: close the change with an audit trail and updated source-of-truth specs.

Do not skip phases because a change looks easy. The only acceptable exception is a truly atomic maintenance change that does not alter product behavior, architecture, contracts, security, persistence, or public UI. Even then, document the reason in the final summary.

## Strict TDD contract

Implementation follows `openspec/specs/03-v1-quality-tdd/spec.md`.

- Start with a failing test for new behavior before production code.
- Make the smallest implementation pass the test.
- Add Triangle edge cases: empty, invalid, boundary, error, permission, offline, tenant-isolation, and regression cases where relevant.
- Keep coverage at or above 80% across packages; new code must meet or exceed that threshold.
- Use Vitest for unit/integration tests and Playwright for end-to-end flows.
- Do not mark work complete if tests are missing, skipped, flaky, or only manually verified.

## Clean Architecture rules

- Domain code must not import from apps, UI, HTTP frameworks, databases, environment/config modules, or infrastructure adapters.
- Use ports/interfaces at architectural boundaries; adapters implement them at the edge.
- Keep business decisions in use cases/domain services, not React components, route handlers, or database mappers.
- Contracts define cross-boundary shapes. Do not duplicate DTOs casually.
- Dependency direction must point inward: UI/API/adapters → contracts/use cases → domain.
- If a dependency-cruiser rule fails, fix the architecture; do not weaken the rule without an explicit architecture decision.

## Security by design

- Treat tenant isolation as a core invariant. Every tenant-scoped operation must validate tenant ownership at the boundary and at persistence access points.
- Validate all external input with shared contracts before it reaches domain logic.
- Never log secrets, tokens, credentials, personal health data, or sensitive tenant data.
- Prefer deny-by-default authorization. Make allowed actions explicit.
- Handle errors without leaking implementation details or sensitive records.
- Avoid adding dependencies that expand the attack surface unless the benefit is clear and documented.
- Do not bypass security checks for tests; use test fixtures that exercise the real guardrails.

## Frontend and design-system rules

- Use the project design system before creating new UI primitives.
- For web or mobile UI work, use the Open Design `kiNorA` project as the visual source of truth. Read `docs/open-design-kinora.md` first and use the local snapshot under `docs/open-design/kinora/`; only pull from Open Design MCP when refreshing stale or missing design artifacts.
- Reuse existing components and variants when they express the same intent.
- Keep components focused and placed in independent files when they have their own responsibility, state, styling variants, tests, or reuse potential.
- Separate container/data-fetching concerns from presentational components.
- Keep accessibility built in: semantic HTML, keyboard behavior, focus states, labels, and meaningful error text.
- Do not hardcode one-off colors, spacing, typography, or breakpoints when tokens or primitives exist.
- UI copy in source files defaults to English unless the product requirement explicitly says otherwise.

## Dependency and library policy

- Check existing dependencies and project utilities before adding or implementing anything new.
- Prefer mature, maintained libraries for solved problems: validation, date/time, security primitives, state synchronization, and testing utilities.
- Do not reinvent framework features, browser APIs, or standard library behavior.
- Add a dependency only when it reduces long-term complexity more than it increases maintenance, bundle, security, or review cost.
- Keep abstractions honest. Build the simplest thing that satisfies current specs; avoid speculative extension points.

## File and module discipline

- One file should have one clear reason to change.
- Split modules when responsibilities diverge, not just because a file is long.
- Keep tests near the behavior they prove, following existing package conventions.
- Prefer explicit names over clever names. Code should read like the domain language.
- Do not mix unrelated cleanup with feature work. If cleanup is necessary, make it a separate task or commit.

## AI agent behavior

- Read the relevant spec, design, tasks, and existing code before changing files.
- Ask one focused question when a requirement is ambiguous enough to affect architecture, security, UX, or data integrity.
- Preserve the user's intent, but challenge requests that weaken architecture, tests, security, or maintainability.
- Make small, reviewable edits. Avoid broad rewrites unless explicitly requested and justified.
- Explain important tradeoffs in the final summary; do not bury decisions in code.
- Never fabricate test results. If a command was not run, say so.
- Never commit without explicit user approval.
- Never add AI attribution or `Co-Authored-By` lines to commits.

## Completion checklist

Before calling work complete, confirm:

- [ ] SDD artifacts exist and are current, unless this is an explicitly justified atomic maintenance exception.
- [ ] Tests were written first for new behavior and include edge cases.
- [ ] `pnpm type-check` passes.
- [ ] `pnpm test` passes.
- [ ] `pnpm architecture` passes.
- [ ] `pnpm deps-guard` passes.
- [ ] `pnpm build` passes when the change affects buildable packages/apps.
- [ ] Security and tenant-isolation implications were reviewed.
- [ ] UI uses design-system primitives and accessible patterns where relevant.
- [ ] Specs or archive entries were updated when closing planned work.
