# Apply Progress: 08-v1-ai-plan-generation

**Batch**: 2 of N (PR 1 — Contract + PR 2 — Domain pure functions)
**Branch (PR2)**: feat/08-plan-gen-pr2-domain
**Mode**: Strict TDD
**Date**: 2026-06-29

---

## Completed Tasks (PR 1)

- [x] 1.1.1 Add `WorkoutPlanStatus`, `WorkoutExercise`, `WorkoutSession`, `WorkoutProgram` to `packages/contracts/src/index.ts`
- [x] 1.2.1 Create `packages/contracts/src/workout-program.schema.ts` exporting `WorkoutProgramSchema` (Zod) mirroring the TS types; include `limitationWarnings` array
- [x] 1.3.1 RED: wrote `packages/contracts/src/__tests__/workout-program.test.ts` — 12 test cases asserting types and schema behaviour
- [x] 1.3.2 GREEN: all 25 tests pass (13 baseline + 12 new)
- [x] 1.3.3 Re-export `WorkoutProgramSchema` from `packages/contracts/src/index.ts`
- [x] 1.4.1 Conventional commit: `feat(contracts): add WorkoutProgram types and Zod schema` (c4b8748)

---

## Completed Tasks (PR 2)

- [x] 2.1.1 RED: wrote `packages/domain/src/plan/__tests__/equipment-substitution.test.ts` — 9 test cases (no-op when equipment available, bodyweight substitution map, substitution note recorded, multi-session, pure fn, edge cases)
- [x] 2.1.2 GREEN: created `packages/domain/src/plan/equipment-substitution.ts` — `applyEquipmentSubstitutions(program, equipment): WorkoutProgram`; pure, no network imports
- [x] 2.1.3 REFACTOR: `SUBSTITUTION_MAP` extracted as a data constant in the same file (done as part of initial implementation)
- [x] 2.2.1 RED: wrote `packages/domain/src/plan/__tests__/limitation-warnings.test.ts` — 9 test cases (appends warnings, professional advisory language, multiple limitations, no hard-block, no duplicate warnings, pure fn)
- [x] 2.2.2 GREEN: created `packages/domain/src/plan/limitation-warnings.ts` — `injectLimitationWarnings(program, limitations): WorkoutProgram`; pure
- [x] 2.3.1 RED: wrote `packages/domain/src/plan/__tests__/diagnostic-guard.test.ts` — 10 test cases (clean programs pass, diagnostic patterns rejected from notes/titles/warnings/substitutionNotes, case-insensitive, error message quality)
- [x] 2.3.2 GREEN: created `packages/domain/src/plan/diagnostic-guard.ts` — `assertNoDiagnosticLanguage(program): void | throws`; pure, no network
- [x] 2.4.1 Exported all three functions from `packages/domain/src/plan/index.ts` and `packages/domain/src/index.ts` (`.js` extension — NodeNext)
- [x] 2.4.2 Conventional commit: `feat(domain): add equipment substitution, limitation warnings, diagnostic guard` (82aba2f)

---

## Status

All PRs (1–7b) complete and merged to main. Full apply-progress details stored in Engram.
