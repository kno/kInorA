# Archive Report: 16e-langfuse-prompt-management

**Change**: `16e-langfuse-prompt-management` (GitHub #366, enhancement)  
**Archived**: 2026-08-07  
**Archive location**: `openspec/changes/archive/2026-08-07-16e-langfuse-prompt-management/`

## Executive Summary

All six slices (A1, A2, B1, B2a, B2b, C) of the Langfuse prompt-management change have been implemented, verified, and merged to `main`. The change is complete, all 20 spec requirements PASS, all gates green, and the capability is live in production with confirmed native prompt-version linkage working end-to-end.

## What Shipped

| Slice | PR | Commit | Content |
|-------|----|---------| --------|
| A1 | #368 | `2bd7fc5` | Langfuse tracing handler, base URL resolution, invokeChain attachment, masking payload test, OpenRouterPlanGenerator deletion, README docs |
| A2 | #370 | `d132d99` | Extraction adapter tracing attachment (streamReply, extract), masking tests for chat paths |
| B1 | #371 | `835ca73` | Shared prompt renderer, template constants (plan, reply, extraction), variables producers, mask relocation to call sites |
| B2a | #372 | `a5a55d2` | LangfusePromptGateway port, remote template validation with zod schema, rejection reason codes |
| B2b | #373 | `162e8b7` | ResolvePrompt provider (TTL cache, burst coalescing, fallback caching), wiring at both call sites, promptSource attribution, compose forward |
| C | #376 | `c062278` | Prompt-linked-chain (flat-sequence decomposition + per-call shape guard), native prompt-version linkage, full attribution metadata, follow-up issues filed |

## Final Gate Evidence

| Gate | Command | Result |
|------|---------|--------|
| Unit/integration tests | `pnpm --filter api test` | 170 test files, 2041 passed, 116 skipped, exit 0 |
| Coverage | `pnpm --filter api test:coverage` | 88.49% functions (gate 85%); all new modules 100% |
| Type-check | `pnpm type-check` | All 7 projects, no errors |
| Build | `pnpm build` | All packages, 0 dependency violations, exit 0 |

These results were independently re-run by sdd-verify at verification time and by this archive executor — not secondhand; gates are confirmed green on `main` @ `c062278`.

## Specification Sync

**Mode**: Hybrid (openspec + engram)  
**Convention found**: Specs are organized by domain/change-id in `openspec/specs/{id}/spec.md`. Archive folders use date-prefixed names: `openspec/changes/archive/YYYY-MM-DD-{change-name}/`.

**Action taken**: This was a NEW capability (langfuse-prompt-management did not exist in main specs). The delta spec from `openspec/changes/16e-langfuse-prompt-management/specs/langfuse-prompt-management/spec.md` was copied verbatim to `openspec/specs/16e-langfuse-prompt-management/spec.md`. All 20 requirements preserved without modification.

## Verification Summary

**Verify report**: Full-chain verification (A1→A2→B1→B2a→B2b→C)  
**Result**: PASS — all 20 spec requirements verified by adversarial tests, not source inspection alone

**Key findings**:
- All requirements met with test evidence
- Masking invariant confirmed unbroken at all three call sites (invokeChain, streamReply, extract)
- Mandatory fallback guarantee confirmed for all named failure classes
- Closed-vocabulary marker-order guarantee confirmed to reject relocated templates whole, never repaired
- TTL compose-forward test confirmed placement-asserting (not just file-wide toContain)
- Degradation path confirmed to leave generation/chat working with `promptLinked: false` and no throw
- Production facts confirmed: traces arrive, prompts exist in Langfuse under `production`, Prompts tab populates with linked executions

**One suggestion accepted**: Task C.17 (operational confirmation of Prompt tab population) was intentionally left unchecked in tasks.md "because this executor cannot perform it before merge." The product owner has now confirmed this fact in production post-deployment (2026-08-07): both paths (withStructuredOutput and bare streaming model) come through linked with full metadata, and the Langfuse Prompts tab shows linked executions.

## Design Intent Achieved

The original design's **Installed SDK Verification** section documented uncertainty about whether the flat-sequence decomposition in slice C would satisfy Langfuse's native linking precondition. The section was written: "Linking precondition — identified, and MET by design (flat-sequence decomposition)." 

Design.md's later "Open Questions" section asked: "Confirm... once, out of band, after C deploys, that the Langfuse Prompt tab actually populates... If it does not, `promptLinked: true` in the traces localizes the remaining gap to the SDK rather than to our wiring."

**Production confirmation (2026-08-07)**: The Prompts tab DOES populate. The native `promptName`/`promptVersion` columns therefore DO populate on the happy path (plan generation via withStructuredOutput AND chat via bare streaming model). This **supersedes design.md's residual uncertainty** — there is nothing to correct in the design; the design's prediction was correct.

## Task Completion and Closure

Every implementation task across all six slices is marked complete (`[x]` in `tasks.md`), including
C.17.

C.17 was deliberately left open through implementation as an operational, non-test item ("after C
deploys, confirm out of band"), because no executor could perform it before merge. It was **closed in
commit `ea8c5a6d`** once the product owner confirmed the fact in production: both the
structured-output path and the streaming chat path come through linked, the trace metadata carries
the prompt name, version and label, and the Langfuse Prompts tab shows the linked executions. The
task entry records that confirmation as its evidence.

## Follow-up Issues Opened

Three follow-ups leave this change open, not two. The first two were mandated by the design and filed
in slice C; the third was discovered during A1 and filed then.

1. **#374**: First-mention limitation masking gap — now that a real trace channel exists (Langfuse), the accepted gap (first mention of a limitation in a user message is unmasked in that one turn) is tracked for possible tightening in a future change.
2. **#375**: Re-run `prompt-linked-chain` tests on any `@langchain/openai`, `@langchain/anthropic`, `@langchain/google-genai`, or `@langchain/core` bump — a shape change to `withStructuredOutput` output degrades silently and safely but stops populating native columns, visible as `promptLinked: false`.

3. **#369**: `apps/api`'s `buildApp()` composition root has no test that invokes it, and its reported
   71.42% function coverage is an instrumentation artifact — V8 only counts a closure as a function
   once its declaration executes, and `buildApp` holds roughly 50 inline route-option closures that
   nothing reaches. Measured: one test calling the real `buildApp()` drops `app.ts` functions to
   17.94% and the `apps/api` global to 84.68%, under the 85% gate. So the next contributor to write a
   legitimate integration test against the composition root breaks the coverage gate through no fault
   of their own. Found while closing the `onClose` flush gap in A1; that gap was instead closed by
   extracting `flushLangfuseHandlerOnClose`, which sidesteps the trap without fixing it.

All three issues are OPEN and confirmed via `gh issue view`.

## Coverage Headroom

The change added significant test coverage (new modules measure 100% functions: `langfuse-handler.ts`, `prompt-linked-chain.ts`, `remote-template-validation.ts`, `prompt-provider.ts`, `prompt-source-port.ts`, `prompt-template.ts`, `langfuse-prompt-gateway.ts`, and `mask.ts`). The apps/api functions coverage gate (85% threshold) finished at 88.49%, leaving 3.49 percentage points of headroom for future work.

## Scope Discipline

The change touched exactly 31 files across the full chain (A1→C):
- `apps/api/README.md`, `docker-compose.yml`, and 29 files under `apps/api/src/ai/*` + `apps/api/src/app.ts`
- 10 new production modules, their tests, 2 generated snapshot files, 1 deleted test file
- No files in `packages/contracts`, `apps/web`, `apps/mobile`, or any other package
- No scope creep into prompt A/B testing, evaluation harnesses, self-hosting Langfuse, or prompts outside the three in-scope names

**Scope discipline: PASS.**

## Process Notes

### Delivery Strategy
**Chain strategy**: `stacked-to-main` (per product owner request, 2026-08-06). Each slice merged to `main` in sequence (A1 → A2 → B1 → B2a → B2b → C), enabling the next. Rationale: A1 reaches production early to answer whether production Langfuse credentials are valid — a question the design could not resolve any other way.

### B2 Conditional Split
The combined B2 slice measured 956 hand-authored changed lines against the 800-line budget. The orchestrator invoked the conditional split gate recorded in design.md, dividing it into:
- **B2a** (port + gateway + validation): 411 lines, comfortably under budget, PR #372
- **B2b** (ResolvePrompt + call-site wiring + compose/README): remaining work, PR #373

Both landed under 800 lines individually.

### Review Receipt Gate
Receipt-driven development (RDD) was **DISABLED** by the user before archive (the user invoked the kill-switch after the native review authority reported itself corrupted). Delivery followed ordinary repository policy: no review artifacts were collected, no approval receipt exists. The archival record correctly marks this as `disabled/unmanaged` — no fabricated receipt, no implicit demand for one.

## Traceability

**Engram artifacts** (if used): All observations would be recorded with topic_key `sdd/16e-langfuse-prompt-management/{artifact-type}`:
- proposal
- specs
- design
- tasks
- verify-report (full-chain, supercedes A1-only verify)
- archive-report (this document)

**OpenSpec artifacts** (filesystem):
- `openspec/specs/16e-langfuse-prompt-management/spec.md` — canonical spec (newly created)
- `openspec/changes/archive/2026-08-07-16e-langfuse-prompt-management/` — full change folder with all phase artifacts

## Risks and Open Items

### Resolved Risks
- **Production Langfuse credentials valid** — Confirmed by A1 traces arriving in production (2026-08-07).
- **Remote template quality degradation** — Mitigated by decision-7 validation and B1's byte-identity snapshot tests.
- **First-mention limitation gap exposure** — Accepted risk per proposal answer 4; follow-up issue #374 filed.
- **Native linking precondition satisfaction** — **CONFIRMED in production**: flat-sequence decomposition DOES satisfy the SDK's `parentRunId` precondition in practice.

### Open Items
1. **Task C.17 checkbox**: Recommend checking off before final archive, now that production confirmation is available.
2. **Prompt tab population**: **CONFIRMED in production 2026-08-07** — no remaining action needed.
3. **Follow-up issues #374, #375**: Both OPEN and tracked; not blockers for this archive.
4. **`@langchain/*` version bumps**: Future-proofing; #375 documents the re-test requirement.

## Key Learnings

1. **Flat-sequence decomposition satisfies the SDK's native linking precondition in practice**, not only in theory — the original design's SDK verification was correct, and the Open Question has been answered by production confirmation.

2. **TTL cache environment variable MUST be added to compose `environment:`**, not just read in code with a default — the var is silently unset in deployed containers when absent from the compose block, while still appearing to work locally under `pnpm dev`. This lesson was already recorded in PR #254 (billing) and applied consistently here.

3. **In-tree snapshot tests are a tautology post-refactor** — they freeze output written AFTER the refactor, so both pre- and post-refactor code can pass identical snapshots. For B1's byte-identity claim, the verifying executor proved equality externally (pre-refactor vs. post-refactor via `git show`) for 19/19 cases; the committed snapshots now serve correctly as the forward drift guard, not as the initial equivalence proof.

4. **Per-call shape guards degrade silently and safely** — a `@langchain/*` version bump changing `withStructuredOutput`'s return shape will stop populating native columns (visible as `promptLinked: false`) but will NOT fail generation. The test suite confirms this degradation path; future version bumps should re-run the guard tests to catch shape changes early.

5. **Verified remote template validation MUST reject whole and never repair** — moving or dropping the closed-vocabulary marker is rejected as a whole, never reordered or salvaged. This constraint is enforced by the ordered-markers validation and proven by a test case that explicitly checks "relocated marker is rejected whole, not repaired."

---

**Archive status**: COMPLETE  
**Change ready for closure**: YES — all slices merged, gates green, production confirmed, all requirements satisfied.
