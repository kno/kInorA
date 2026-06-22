# Archive Report: 04-v1-ai-operation

## Status

Closed as an intentional atomic documentation implementation.

## Reason for SDD exception

This change only creates the root `AGENTS.md` operating guide and does not alter product behavior, runtime code, contracts, persistence, security mechanisms, or public UI. The source specification already existed in `openspec/specs/04-v1-ai-operation/spec.md`, so a full proposal/design/tasks/apply cycle would add process noise without improving review quality.

## Implemented

- Created `AGENTS.md` at the repository root.
- Documented the required SDD lifecycle: propose → spec → design → tasks → apply → verify → archive.
- Linked implementation expectations to strict TDD from `openspec/specs/03-v1-quality-tdd/spec.md`.
- Added guardrails for Clean Architecture, security by design, frontend/design-system use, component separation, dependency reuse, KISS, YAGNI, and completion checks.

## Verification

- `openspec/specs/04-v1-ai-operation/spec.md` requires a root `AGENTS.md`; the file now exists.
- `AGENTS.md` references the SDD pipeline and phase order.
- `AGENTS.md` rejects uncovered implementation work and requires tests/checks before completion.
- No runtime tests were run because this is documentation-only and does not change executable code.

## Source of truth

- Active spec: `openspec/specs/04-v1-ai-operation/spec.md`
- Supporting TDD spec: `openspec/specs/03-v1-quality-tdd/spec.md`
- Implemented guide: `AGENTS.md`

## Outcome

The AI operation specification is considered closed for the current baseline. Future changes to AI behavior, project skills, or workflow guardrails should update `AGENTS.md` and add a new OpenSpec change record when the change is non-trivial.
