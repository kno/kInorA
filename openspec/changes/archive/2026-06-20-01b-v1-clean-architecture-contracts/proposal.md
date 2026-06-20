# Proposal: 01b V1 Clean Architecture Contracts

## Intent

Activate the README roadmap's second implementation slice by turning the existing `01b-v1-clean-architecture-contracts` baseline spec into enforced Clean Architecture boundaries on top of the `01a-v1-monorepo-setup` foundation. This change gives the monorepo inward-pointing dependency rules, a shared `PlanSpec` contract reusable by web and API, and a domain package testable in isolation — before feature code lands in later specs.

## Scope

### In Scope
- Layer dependency direction enforcement: infrastructure/adapters MAY depend on use cases and domain; domain MUST NOT depend on infrastructure. The enforcement mechanism (tool choice) is decided in the design phase.
- Shared `PlanSpec` contract exported from `packages/contracts` and usable by `apps/web`, `apps/api`, and future mobile shell integration.
- Domain isolation: a `packages/domain` (or equivalent inner layer) whose entities and use cases are testable without network, database, framework, or UI dependencies.
- A failing check (lint or build) when a domain file imports from an infrastructure package.
- A passing isolation test proving a use case test imports only domain and contract packages.

### Out of Scope
- Concrete domain entities beyond the `PlanSpec` shape (defer to `07-v1-plan-wizard`, `08-v1-ai-plan-generation`, etc.).
- Use case implementations with real business logic (this slice defines boundaries and one trivial isolation test, not features).
- Database, auth, Stripe, AI, Docker, CI/CD, mobile, and tenant capabilities (defer to their respective specs).
- Multi-tenant schema (defer to `01c-v1-multi-tenant-schema`).
- Full test stack and coverage tooling (defer to `03-v1-quality-tdd`); this slice only wires the minimum vitest setup needed for the isolation test.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `01b-v1-clean-architecture-contracts`: Activate the existing baseline spec with delta requirements for layer enforcement, shared `PlanSpec` contract, and domain isolation.

## Approach

Build inward on top of `01a`. Extend or supplement the existing `scripts/deps-guard.mjs` (which currently blocks prohibited package categories) with layer-boundary rules, OR introduce a dedicated architecture enforcement tool — the exact mechanism is a design decision captured in the design phase. Add the `PlanSpec` contract type to `packages/contracts` so both `apps/web` and `apps/api` consume the same shape via `@kinora/contracts`. Introduce a `packages/domain` workspace for domain entities and use cases, with a vitest test that imports only domain and contract packages to prove isolation. Keep the slice thin: boundaries and contracts only, no feature logic.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `scripts/deps-guard.mjs` or new enforcement tool | Modified/New | Layer-boundary rules added alongside the existing prohibited-package guard. |
| `packages/contracts` | Modified | Add `PlanSpec` shared contract type. |
| `packages/domain` | New | Domain entities and use cases package, isolated from infrastructure. |
| `packages/domain` vitest config | New | Minimum test setup for the isolation test. |
| `apps/web`, `apps/api` | Modified | Consume `PlanSpec` from `@kinora/contracts` where relevant. |
| `openspec/specs/01b-v1-clean-architecture-contracts/spec.md` | Modified | Requirement activation through delta spec. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Enforcement mechanism too strict (false positives blocking valid imports) | Med | Design phase evaluates tool expressiveness; scope rules to layer boundaries only. |
| Enforcement mechanism too loose (misses real violations) | Med | Cover the spec's layer-violation scenario explicitly in the design and verify. |
| Tool choice introduces an unwanted dependency | Low-Med | Prefer extending the existing `deps-guard.mjs` unless a dedicated tool's value justifies the dependency. |
| `packages/domain` scope creeps into feature logic | Med | Keep domain to boundaries + isolation test only; defer entities to later specs. |

## Rollback Plan

Remove `packages/domain`, revert `packages/contracts` `PlanSpec` additions, revert the layer-boundary enforcement changes in `scripts/deps-guard.mjs` (or remove the new tool), and revert app consumption of `PlanSpec`. No persisted data or external services are involved; rollback is a pure file/revert operation before archive.

## Dependencies

- `01a-v1-monorepo-setup` (archived 2026-06-20) — provides the pnpm monorepo, `@kinora/contracts` alias, and vitest baseline in `apps/api` and `apps/web`.

## Success Criteria

- [ ] A domain file importing from an infrastructure package fails lint or build with a layer-boundary error.
- [ ] `PlanSpec` is exported from `packages/contracts` and importable by both `apps/web` and `apps/api` via `@kinora/contracts`.
- [ ] A use case unit test imports only domain and contract packages and runs without loading any framework or database module.
- [ ] `pnpm --filter <workspace> test` passes for the affected workspaces.
- [ ] Existing `pnpm deps-guard` capability guard still passes (no prohibited packages introduced).
