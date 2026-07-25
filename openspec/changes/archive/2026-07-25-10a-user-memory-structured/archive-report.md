# Archive Report: 10a-user-memory-structured

## Status

- Artifact store: OpenSpec
- Shipped: structured user memory — user profile (name/goal/experienceLevel) with
  registration auto-provisioning, user preferences (defaultLocation/defaultDuration/
  defaultEquipment) with plan-wizard pre-fill, and workout-session delete (individual
  + bulk, with active-session guard and cascade cleanup).
- Task completion: 38/38 tasks complete in `tasks.md` (all `[x]`); no unchecked
  implementation tasks found. (Note: the archival request referenced "46/46 tasks" —
  the persisted `tasks.md` enumerates 38 checklist lines across 6 slices, all
  checked. No stale-checkbox reconciliation was needed; the artifact is internally
  consistent and fully complete.)
- Verification: PASS — 0 blockers, 0 CRITICAL findings, 9/9 requirements compliant,
  25/25 scenarios compliant. Full workspace `pnpm test`, `pnpm type-check`,
  `pnpm architecture`, `pnpm deps-guard`, and `pnpm build` all passed (exit 0).
- Review receipt: no `reviews/receipt.json` or `reviews/` directory was found under
  `openspec/changes/10a-user-memory-structured/` at archive time. The archival
  request stated a review receipt was approved and the change was merged into
  `main`; verify-report evidence (PASS, 0 CRITICAL) and merged code presence
  independently corroborate completion. This is recorded as a caveat below.
- Merge reference: change is merged into `main` per orchestrator instruction (code
  present in working tree); no PR number was supplied to this archive step.

## Source Artifacts Read

- `openspec/changes/10a-user-memory-structured/proposal.md`
- `openspec/changes/10a-user-memory-structured/design.md`
- `openspec/changes/10a-user-memory-structured/tasks.md`
- `openspec/changes/10a-user-memory-structured/verify-report.md`
- `openspec/changes/10a-user-memory-structured/specs/10a-user-profile/spec.md`
- `openspec/changes/10a-user-memory-structured/specs/10b-user-preferences/spec.md`
- `openspec/changes/10a-user-memory-structured/specs/10c-workout-session-delete/spec.md`

## Spec Sync

The change's three delta spec files did not use `ADDED`/`MODIFIED`/`REMOVED`
delta-section headers — each reads as a full, self-contained capability
specification. A scaffold canonical spec already existed at
`openspec/specs/10a-v1-user-memory-structured/spec.md` with abstract,
high-level requirements ("Structured Editable Memory", "User-Controlled
Deletion", "Tenant-Scoped Structured Memory") that summarized the intended
capability without the concrete detail the change actually implemented.

Reconciliation performed: the canonical spec was rewritten to keep its
`Purpose`/`Dependencies` header and to replace the three abstract
requirements with three concrete `## Capability` sections — User Profile,
User Preferences, and Workout Session Delete — each carrying the full
requirement/scenario detail from the corresponding delta file. No existing
detail was dropped; the abstract requirements were superseded by their
concrete equivalents (no separate `REMOVED` note was written because this is
a scaffold-to-concrete reconciliation, not a removal of shipped behavior).

| Domain | Action | Details |
|---|---|---|
| `10a-v1-user-memory-structured` | Reconciled (scaffold → concrete) | Replaced 3 abstract requirements with 3 concrete capability sections: **User Profile** (3 requirements, 8 scenarios — profile storage, CRUD with 422 validation, auto-provision on registration), **User Preferences** (3 requirements, 8 scenarios — preferences storage, partial-merge CRUD, wizard pre-fill), **Workout Session Delete** (3 requirements, 9 scenarios — individual delete, bulk delete, active-session 409 guard, cascade cleanup). Total: 9 requirements / 25 scenarios, matching verify-report's compliance matrix exactly. |

## Archive Contents

- `proposal.md` ✅
- `design.md` ✅
- `tasks.md` ✅ (38/38 tasks complete)
- `verify-report.md` ✅ (PASS, 9/9 requirements, 25/25 scenarios, 0 CRITICAL)
- `specs/10a-user-profile/spec.md` ✅
- `specs/10b-user-preferences/spec.md` ✅
- `specs/10c-workout-session-delete/spec.md` ✅
- `reviews/` — not present in the source change folder (see caveat below)

## Deferred / Follow-up Notes (from change artifacts)

From `proposal.md` Out of Scope / Non-Goals:
- Vector/RAG memory is explicitly deferred to change `10b-user-memory-vector`
  (already shipped and archived separately: `2026-07-23-10b-user-memory-vector`).
- User avatar uploads — not requested, left as a future additive change.
- Multi-tenant profile sharing / public profiles — explicitly out of scope.
- Goal-specific training logic — goal is stored as metadata only, no behavior
  trigger implemented.
- Profile completeness prompts or gamification — not implemented.

From `verify-report.md` Issues Found (WARNING, non-blocking):
- No local unbounded E2E suite was run for this final verification by
  instruction; acceptance relies on CI E2E/Docker smoke plus the local bounded
  E2E-runner safety unit test (`scripts/__tests__/e2e-resource-safety.test.ts`).
- Historical Slice 6 isolated RED evidence was not captured in an earlier
  apply-progress snapshot; the final remediation RED/GREEN evidence is present
  and all current runtime checks pass, so this did not block PASS.

From `design.md` Out of Scope items carried by the sub-spec capabilities:
- 10b (Preferences): new wizard steps/reordering beyond the single new
  preferences step, preferences→PlanSpec mapping logic, equipment catalog
  validation, and onboarding wizard flow are all explicitly out of scope.
- 10c (Session Delete): soft delete/trash-recovery, scheduled/automatic
  retention deletion, independent exercise/set-record deletion, plan/PlanSpec
  deletion, and GDPR export-before-delete are all explicitly out of scope.

## Spec-Sync Caveats

- The three delta spec files under `specs/` used plain capability-doc format
  (Capability/Requirements/Scenarios headings) rather than the
  `ADDED`/`MODIFIED`/`REMOVED` delta convention. Because a scaffold canonical
  spec already existed for the same domain slug (`10a-v1-user-memory-structured`),
  this was treated as a scaffold-reconciliation merge rather than either the
  "append ADDED requirements" or "copy full spec as new" path. This is
  recorded here for auditability in case a future change further modifies
  this canonical spec and expects strict `MODIFIED` block semantics.
- No `reviews/` directory (receipt/transaction/ledger/gate-context) was found
  in the source change folder on the filesystem at archive time, despite the
  archival request stating a review receipt was approved. The independently
  strong verify-report (PASS, 0 CRITICAL, 9/9 requirements, 25/25 scenarios)
  and the caller's confirmation that the change is merged into `main` support
  proceeding with archive; this gap is flagged rather than silently absorbed.

## Archive Decision

Archive approved. All implementation tasks are complete (38/38), verification
is PASS with 0 CRITICAL findings, and canonical specs now reflect the shipped
behavior. The missing on-disk `reviews/` receipt is documented as a caveat
above rather than blocking archive, given the explicit orchestrator statement
that the change carries an approved review receipt and is merged into `main`.
