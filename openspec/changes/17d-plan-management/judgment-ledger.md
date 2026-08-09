# Judgment Day — frozen ledger

**Target**: `openspec/changes/17d-plan-management/` — 7 files, 1284 lines
**Identity**: `26ef7ee6b9f39003e734f2e23a17e2da1b91dd9ab5a78dd5c780f16ae6b49735`
**Mode**: judgment_day · **Round**: 1 · **Date**: 2026-08-09
**Judges**: two blind, parallel, identical scope. Neither saw the other's findings.

## Load-bearing claims — both judges verified independently

Every citation checked held exactly. Confirmed by A and B separately:

- `program_json` written in one place only — `workout-plan.ts:90-101`
- `tracker-model.ts` has zero `programJson` references — the tracker invariant holds
- `workoutPlanStatusEnum` is exactly `["generating","ready","failed"]`
- `resolveProgramCatalogIds` is pure and reusable with the claimed signature
- Muscle group is derived at session-start, not stored in `program_json`
- Next migration is `idx: 29`, including the `0011` duplicate-filename trap
- `MobileNav.PRIMARY_TABS` cannot take a fourth entry
- `findReadyPlan` has exactly one caller; `findAllByUser` filters tenant and user only

No false claim was found in any of the seven artifacts.

## Findings

| # | Severity | Judges | Disposition |
|---|---|---|---|
| 1 | WARNING | **A + B** | **Confirmed** — no concurrency control on the edit endpoint |
| 2 | CRITICAL | B only | **Suspect** — verified true by the orchestrator |
| 3 | WARNING | A only | Suspect |
| 4 | WARNING | A only | Suspect |
| 5 | WARNING | B only | Suspect |
| 6 | SUGGESTION | A only | Info |
| 7 | SUGGESTION | A only | Info |

**Contradictions between judges: 0.**

### 1 — Confirmed by both: no concurrency control on the edit endpoint

`updateProgram(tenantId, userId, id, program)` is a full-document replace with no version, etag or timestamp check. Two tabs or devices editing the same plan produce **silent last-write-wins**: the second save overwrites the first with no conflict signal to either user, and no test asserts or documents the behaviour.

Neither `proposal.md`'s risks table nor `design.md`'s open questions records this as an accepted risk. Both judges independently flagged it; both rated it WARNING.

### 2 — CRITICAL, single judge, independently verified

The archive-never-delete invariant is **not airtight**. The requirement (`specs/plan-management/spec.md:45-54`) and its guard test (`design.md:524`) are scoped to routes on `workout_plans` only.

But `workout_plans.planSpecId` references `plan_specs.id` **`ON DELETE CASCADE`** (`schema.ts:659-661`), and `workout_sessions` → `session_exercises` → `set_records` cascade onward from `workout_plans`.

A future `DELETE /plan-specs/:id` would destroy every plan for that spec and all associated training history **while fully complying with the letter of "no DELETE route for workout_plans"**, and would pass the proposed guard test because it never touches `/workout-plans*`.

**Orchestrator verification**: cascade confirmed at `schema.ts:659-661`. No `plan-specs` DELETE route exists today — the only `fastify.delete` calls are in `user-memories.ts:77` and two session-scoped ones in `workout-session.ts:298,321`. The gap is **latent, not exploited**.

### 3 — An archived plan stays reachable by URL

`specs/plan-management/spec.md:56-61` requires archived plans be "reachable only through an explicit show-archived affordance". But the pinned decision to keep `/plan?planId=X` deep links leaves the archived plan's full week view reachable by URL with no indication it is archived. `design.md`'s file-changes table modifies `findAllByUser` and the new progress query — **not** `findById`. No scenario tests an archived-plan deep link.

A pinned decision and a MUST requirement that were never reconciled.

### 4 — A design decision with no requirement behind it

`design.md:75` decides that editing a `generating` or `failed` plan returns `409 plan_not_ready`. No requirement or scenario in `specs/plan-management/spec.md:88-108` covers it. Under this project's strict TDD, an implementer following the spec alone would never be required to test it.

### 5 — The justification for that same gate is factually wrong

`design.md:75` justifies the ready-only gate as preventing "a real lost-update race" against an in-flight `markReady`. **No code path ever flips an existing row from `ready` back to `generating`.** `status='generating'` is only ever set by `createGenerating`'s INSERT (`workout-plan.ts:67-79`), and regenerate creates a **new row** rather than mutating the one being edited (`plan.ts:738`).

The guard is harmless defence-in-depth; its stated cause is not real, and it contradicts the design's own verified claim that `program_json` is written once per generation attempt.

Findings 4 and 5 concern the same gate from opposite directions — one says it lacks a requirement, the other says its rationale is wrong. They are complementary, not contradictory.

### 6, 7 — Suggestions

- `design.md:325` cites `repo.findSpecById`, which does not exist. The real method is `PlanSpecRepository.findConfirmedById` (`plan-spec.ts:29-65`).
- `design.md:583-586` leaves "no index on `workout_sessions(tenant_id, user_id)` confirmed" as an open question. The index exists: `workout_sessions_tenant_user_idx` at `schema.ts:723-724`.

## Correction rounds

**Zero correction work units executed.** The protocol fixes only severe findings confirmed by **both** judges. The single both-confirmed finding is a WARNING, and the only CRITICAL was raised by one judge — recorded as suspect, not auto-fixed.

No scoped re-judgment was run, because no correction round was triggered.

## Terminal state

**ESCALATED.** A CRITICAL completeness gap in a data-loss invariant was raised by one judge and independently verified by the orchestrator. It is latent rather than active, but approving a plan whose central safety constraint has a verified hole would misrepresent the review.

Nothing here blocks starting PR A; findings 2, 3 and 1 should be closed in the artifacts before PR B (archive) and PR D (edit) are built, since that is where they land.
