# Archive Report: 07-v1-plan-wizard

**Change**: `07-v1-plan-wizard`
**Archived to**: `openspec/changes/archive/2026-06-27-07-v1-plan-wizard/`
**Archive date**: 2026-06-27
**Artifact store**: openspec (file)
**Verdict**: PASS WITH WARNINGS — archived cleanly; 0 CRITICAL issues; 2 WARNINGs addressed in this report; 2 SUGGESTIONs carried forward as follow-up notes

---

## Task Completion Gate

All 37 implementation tasks verified `[x]` in `tasks.md` before archive. No stale unchecked tasks. No exceptional reconciliation was required.

| Phase | Tasks | Complete |
|-------|-------|----------|
| PR 1 — Contracts + Domain (Phases 1–3) | 11 | 11 |
| PR 2 — API (Phases 4–6) | 14 | 14 |
| PR 3 — Web (Phases 7–11) | 12 | 12 |
| **Total** | **37** | **37** |

---

## Archive Contents

| Artifact | Status |
|----------|--------|
| `exploration.md` | Present |
| `proposal.md` | Present |
| `specs/07-v1-plan-wizard/spec.md` | Present (delta spec — source for main spec merge) |
| `design.md` | Present |
| `tasks.md` | Present — 37/37 tasks `[x]` |
| `apply-progress.md` | Present — cumulative PR 1 + PR 2 + PR 3; deviation note clarified (see WARNING-01 below) |
| `verify-report.md` | Present — PASS WITH WARNINGS, 0 CRITICAL |

---

## Specs Synced

| Domain | Action | Details |
|--------|--------|---------|
| `07-v1-plan-wizard` | Updated | Applied 2 MODIFIED requirements + 1 ADDED requirement from delta spec |

**Changes applied to `openspec/specs/07-v1-plan-wizard/spec.md`:**

### MODIFIED: Wizard Step Progression
The old spec described five steps (goal, frequency, duration, equipment, limitations) with no explicit completion gate. The merged spec now mandates six steps in order (goal, location, frequency, duration, equipment, limitations), requires `location` to precede `equipment` because location constrains available equipment, and adds an explicit required-inputs-before-confirm gate: goal, location, frequency, and duration must each carry a non-null value; equipment and limitations must be visited but may resolve to empty arrays. New scenarios added: "Confirm blocked when required step incomplete" and "Equipment step visited with empty selection".

### MODIFIED: PlanSpec Output
The old spec omitted `location` from the field list, typed `limitations` as `string[]`, did not mention `preferenceScores`, and did not distinguish the confirmed `PlanSpec` from a generated workout program. The merged spec now lists all seven output fields explicitly (goal, location, daysPerWeek, sessionDurationMinutes, equipment, limitations as `{ text: string; isWarning: boolean }[]`, preferenceScores), states that `isWarning` defaults to `true`, states that `preferenceScores` is derived deterministically from wizard answers and is not user-entered, and adds an explicit boundary note that 07 produces and persists a confirmed `PlanSpec` ONLY — generating the actual workout program (exercises, sets, reps, rest, weekly schedule) is OUT OF SCOPE and is the responsibility of change 08. New scenarios added: "Location captured in output", "preferenceScores derived from answers".

### ADDED: Draft Persistence and Resume
This requirement was not present in the original spec. The merged spec now mandates server-persisted single active draft per user per tenant, resume at the exact step after exit, promotion of draft to confirmed `plan_specs` on Finish (with no workout program generated), and an overwrite/continue prompt on re-entry with an existing draft. Four scenarios added covering: draft saved after each step, resume restores exact position, draft promoted to confirmed PlanSpec on Finish (with explicit 07-does-not-generate-program note), overwrite prompt on re-entry.

**Purpose section** was also updated to clarify that 07 produces a confirmed `PlanSpec` (training requirements) ONLY, and that change 08 (AI plan generation) is the exclusive owner of the actual workout program.

**Delta applied from**: `openspec/changes/07-v1-plan-wizard/specs/07-v1-plan-wizard/spec.md`
**Updated main spec**: `openspec/specs/07-v1-plan-wizard/spec.md`

---

## WARNING-01 Resolution: preferenceScores derivation — final shipped approach

The verify report flagged WARNING-01: the apply-progress artifact contained a "Key discovery / deviation" note stating the client enriched drafts with `derivePreferenceScores` via `@kinora/domain/plan`. This documented an intermediate workaround that was SUPERSEDED before the final PR 3 merge.

**Final shipped behavior (authoritative):**
- The client (`StepperShell.tsx`, `plan-draft-client.ts`, `actions.ts`) sends raw wizard input to the API at every step save and on promote. The client NEVER calls `derivePreferenceScores`.
- `derivePreferenceScores` is called SERVER-SIDE ONLY, inside the `POST /plan-specs` promote handler in `apps/api/src/routes/plan.ts`, after `assertPlanSpecInput` validates the raw input.
- This is fully consistent with design §2 ("server is the source of truth for preferenceScores") and is MORE correct than the original intermediate plan.

The intermediate workaround was a transitional implementation path that existed while the PR2 `assertPlanSpecShape`/`assertPlanSpecInput` split was being worked out. It was removed before merging and does not appear in any shipped file. The apply-progress note was stale artifact documentation of a superseded approach.

The `@kinora/domain/plan` subpath (`packages/domain/package.json`) WAS shipped — it exposes the plan-only barrel (no-crypto, dist-resolved) for use in the Next.js app bundle. However, it is used by the web package for `isSpecComplete` and related pure logic, NOT for client-side score derivation.

---

## WARNING-02 Note: `plan_specs.confirmed` column default

The `plan_specs` table has `confirmed boolean NOT NULL DEFAULT false`. The `PlanSpecRepository.create` method always passes `confirmed: true` explicitly — behavior is correct. The default-false value is a design trade-off documented here for the next API owner: a future refactoring of the repository or a new insert path that omits the field would silently persist unconfirmed specs. Consider changing the column default to `true` in a future migration, or removing the default entirely, since all `plan_specs` inserts are expected to set `confirmed: true`. This is low priority and not a regression.

---

## SUGGESTION-01 Note: `@kinora/domain/plan` subpath for change 08

`packages/domain/package.json` now exports `@kinora/domain/plan` as a named subpath that resolves to the built `dist/plan/index.js` (no-auth barrel, safe for Next.js / Turbopack bundle). This subpath is the correct import for consumers that need plan domain logic (e.g., `derivePreferenceScores`, plan fixtures) without the crypto-dependent auth barrel.

Change 08's apply phase should import from `@kinora/domain/plan` (not from `@kinora/domain` root) when accessing plan-related pure functions. The design document for 07 did not mention this subpath — it emerged as a necessary Turbopack-compatibility decision during PR 3 implementation. It is documented here so the 08 apply agent does not need to rediscover it.

---

## SUGGESTION-02 Note: `plan-draft-client.test.ts` function coverage

The apply-progress TDD table referenced `enrichDraftSpec` as a tested function in `plan-draft-client.ts`. This function was an intermediate step from the superseded workaround approach. The final `plan-draft-client.ts` does not export `enrichDraftSpec`. The 10 passing tests cover `submitDraft`, `promotePlanSpec`, `loadCurrentDraft`, `isSpecComplete`, and related helpers. No runtime issue — purely stale documentation from the superseded intermediate approach.

---

## Open Follow-Ups

| ID | Item | Owner | Priority |
|----|------|-------|----------|
| #23 | Auth hardening: rotate tokens on session renewal; audit `requireAuth` call sites for 09/10 reuse correctness | API/Security | Medium |
| — | `plan_specs.confirmed` column default: consider changing to `true` or removing default | API | Low |
| — | `@kinora/domain/plan` subpath: document in design doc or package README for 08 apply phase | Domain | Low |

---

## Verify Report Summary

| Verdict | CRITICAL | WARNING | SUGGESTION |
|---------|----------|---------|------------|
| PASS WITH WARNINGS | 0 | 2 (both addressed above) | 2 (both noted above) |

**Repo-wide guards passed at verify time:**
- `pnpm test`: 534/534 tests pass (76 test files, 5 packages)
- `pnpm architecture`: 647 modules, 1765 dependencies, 0 violations
- `pnpm deps-guard`: 0 prohibited packages
- `pnpm build`: TypeScript 0 errors, Next.js output includes `/create-plan` (dynamic)
- `pnpm test:e2e`: 27/28 pass; 1 pre-existing non-blocker (pwa.spec.ts SW-offline, unrelated to this change)

---

## Source of Truth Updated

The following spec now reflects the implemented and verified behavior:

- `openspec/specs/07-v1-plan-wizard/spec.md`

Key corrections applied vs. the original spec:
1. Six steps (added `location` as step 2, preceding equipment)
2. `PlanSpec` output includes `location` field explicitly
3. `limitations` typed as `{ text: string; isWarning: boolean }[]` (was implicit `string[]`)
4. `preferenceScores` included in output, described as server-derived
5. Explicit scope boundary: 07 produces a confirmed `PlanSpec` only; 08 owns the workout program
6. Draft persistence and resume requirements (new requirement, now in main spec)

---

## Delivery Summary

| Slice | PR | Commits | Scope |
|-------|----|---------|-------|
| PR 1 — Contracts + Domain | #20 | 5 commits | Extend PlanSpec, derivePreferenceScores, fixtures, assertPlanSpecShape |
| PR 2 — API | #24 | 3 commits (9090aba, a879940, fad7bfe) | plan_drafts + plan_specs tables, migration 0002, repositories, routes, register |
| PR 3 — Web | #25 | 4 commits (ee48a17, 337809a, f241ddc, eb70a64) | OrbitProgress, OrbitSelectableCard, 6 step components, StepperShell, server actions, E2E |

**Chain strategy**: stacked-to-main — all 3 PRs (#20, #24, #25) merged to main independently in order.

---

## SDD Cycle Complete

The change has been fully planned, implemented, verified, and archived.
No CRITICAL issues. No scope drift (no 08 entities). Spec source of truth updated with all corrections.
Ready for the next change (`08-v1-ai-plan-generation`).
