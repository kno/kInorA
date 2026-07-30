## Exploration: 14b-v1.1-adaptation-rpe-feedback (RPE/feedback-driven plan adaptation)

### Current State

**14a infrastructure on `main` (not archive) — all reusable:**
- Contract: `AdaptationRecommendation` in `packages/contracts/src/index.ts:870-881`, discriminated by `source: AdaptationSignalSource` (`index.ts:850`, `"adherence" | "rpe"` — **"rpe" already reserved for 14b**). Fields: `level`, `suggestedChange?` (only `{kind:"reduce_frequency", fromDays, toDays}` today, `index.ts:867`), `rationaleKey?`, `planSpecId?`, `adherence?: AdherenceSnapshot` (adherence-only signal context, `index.ts:856-864`, comment says "14b adds its own").
- Carried on `DashboardSummaryDTO.adaptation?` (`index.ts:906`) — a single recommendation slot, not an array. Archived design.md explicitly says both 14a and 14b "compose into ONE banner via this shape" (`design.md:8,39,215`) — 14b must decide precedence when both an adherence-low and an rpe signal fire simultaneously.
- Domain policy: `computeAdherenceAdaptation` (`packages/domain/src/progress/adherence-adaptation.ts:58-106`) — pure, deterministic, injectable `now`. No RPE equivalent exists yet.
- Composition point: `WorkoutSessionRepository.getDashboardSummary` (`apps/api/src/db/repositories/workout-session.ts:683-773`) folds `computeAdherenceAdaptation`'s output into `adaptation` (`:732-747`). Per-session `averageRpe` is ALREADY computed here for history (`:663`) but NOT fed into the adaptation fold — this is the natural insertion seam for 14b.
- Confirm route: `POST /plan-specs/:id/adapt` (`apps/api/src/routes/plan.ts:692-819`) — server-authoritative, re-derives the current recommendation from `getDashboardSummary`, accepts only when `level==="low" && suggestedChange.kind==="reduce_frequency" && planSpecId===id` (`:750-753`), 409 `no_adaptation` otherwise. Quota consumed with a **fresh `randomUUID()` idempotency key per request** (`:775` — deliberate, fixes a "N regenerations for 1 quota unit" bug). Registered only when `options.adherenceReader` + `repo.updateSpecDaysPerWeek` are wired (`:729-730`).
- UI: web `DashboardCoachCard`/`AdaptationBanner` (`apps/web/src/app/(app)/dashboard/DashboardCoachCard.tsx:41-164`) and mobile `AdherenceBanner` (`apps/mobile/src/screens/AdherenceBanner.tsx:84-258`) both gate ONLY on `level==="low" && suggestedChange.kind==="reduce_frequency" && planSpecId` — already source-agnostic, so an RPE-sourced recommendation with the same shape would render through the same banners with zero structural UI changes; only copy would need to branch (currently hardcoded to frequency phrasing, `rationaleKey` unused for copy branching).

**RPE capture — already exists, web-only:**
- `SetRecordDTO.rpe?: number` (`packages/contracts/src/index.ts:52`), persisted via `UpdateSetRecordInput.rpe` (`workout-session.ts:235`) → `recordSet` (`:364`) → `setRecords` table.
- Web: `ExerciseCard.tsx` (`apps/web/src/app/(app)/plan/[id]/tracker/ExerciseCard.tsx:47-234`) has a numeric RPE input (0-10, `:183-198`), sent on complete (`:78-93`).
- **Mobile capture GAP**: mobile `ExerciseCard.tsx` (`apps/mobile/src/screens/tracker/ExerciseCard.tsx:40-160`) has NO RPE input. `WorkoutTrackerScreen.tsx:661` builds `{ completed: true, weightKg: weight, actualReps: reps }` — `rpe` is never sent. Mobile-recorded sets always have `rpe: undefined`.
- Aggregation exists: `computeAverageRpe(session)` (`packages/domain/src/offline/session-aggregation.ts:34-49`) — pure per-session average, already wired into history (`workout-session.ts:663`) and shown in mobile `HistoryScreen.tsx:81`. No rolling-window RPE trend policy exists (the adherence equivalent is the 4-week window in `computeAdherenceAdaptation`).

**No structured "feedback"/"perceived intensity" surface exists** beyond per-set numeric RPE — grepped contracts for feedback/perceived/difficulty/effort/session-note, zero matches. The only free text is `SetRecordDTO.notes?` (`index.ts:54`, per-set, unstructured, web-only UI, never read back for adaptation). "Feedback" in the roadmap title is not an existing capture concept today.

### Affected Areas
- `packages/contracts/src/index.ts` — extend `AdaptationRecommendation`/`SuggestedChange` for an RPE signal (e.g. `RpeSnapshot`, and possibly a new `SuggestedChange` kind like `deload`).
- `packages/domain/src/progress/` — new pure policy analogous to `computeAdherenceAdaptation` (e.g. `computeRpeAdaptation`).
- `apps/api/src/db/repositories/workout-session.ts:725-747` — fold point; needs precedence logic between adherence-low and rpe-signal.
- `apps/api/src/routes/plan.ts:692-819` — `isConfirmable` (`:750-753`) is hardcoded to `reduce_frequency`; a new suggested-change kind needs its own confirm branch + a new repo mutation (today only `updateSpecDaysPerWeek` exists).
- `apps/web/.../DashboardCoachCard.tsx` and `apps/mobile/.../AdherenceBanner.tsx` — hardcode reduce-frequency copy; need new copy branches per suggested-change kind.
- `apps/mobile/src/screens/tracker/ExerciseCard.tsx` + `WorkoutTrackerScreen.tsx:661` — needs an RPE input to reach parity with web if RPE adaptation must work for mobile users.
- `packages/domain/src/offline/session-aggregation.ts` — may need a rolling-window RPE variant for trend detection.

### Approaches

1. **Reuse the 14a suggest-and-confirm `/adapt` flow; add RPE as a second signal competing for the same `AdaptationRecommendation` slot.**
   - Pros: near-zero new infrastructure (no new route/quota wiring/UI shell); reuses proven idempotency/quota/rollback correctness; contract already reserves `"rpe"`.
   - Cons: single-slot model forces a precedence decision (adherence-low vs. high-RPE simultaneously); RPE naturally implies a *load* change, not a *frequency* one, so `SuggestedChange`/`isConfirmable`/the mutation method need real extension, not just data substitution.
   - Effort: Medium.

2. **New dedicated RPE-adaptation flow**: separate recommendation slot + a new confirm sub-route (e.g. `POST /plan-specs/:id/adapt-load`) with its own suggested-change kind and banner slot.
   - Pros: no precedence collapsing; cleaner separation per signal type.
   - Cons: duplicates a large amount of 14a's proven machinery (idempotency discipline, consume-before-write ordering, rollback-on-failure, banner state machine) across two flows; breaks the "ONE banner shape" design intent; higher review surface for similar user value.
   - Effort: High.

3. **RPE-only signal, defer mobile parity** — build on existing web-only RPE data, explicitly document mobile exclusion as a follow-up rather than blocking.
   - Pros: smallest scope, ships on existing data.
   - Cons: asymmetric UX (web gets suggestions, mobile never does) that risks looking like a bug if not explicitly called out.
   - Effort: Low (a scoping decision layered onto Approach 1).

### Recommendation

Combine **Approach 1 + Approach 3's discipline**: extend the existing 14a fold point and confirm route with an RPE-sourced signal, reusing `AdaptationRecommendation`/`/adapt` machinery, and explicitly scope 14b v1 to RPE only (no new "feedback" capture surface — none exists today). Treat mobile RPE capture as an **explicit in-scope decision point**, not an implementation footnote — shipping RPE-adaptation without it makes roughly half the user base structurally unable to trigger it. Default precedence: adherence-low wins over an rpe signal (frequency is more foundational than load) unless product wants both surfaced — this needs an explicit decision in the proposal.

### Risks
- Mobile RPE capture gap: RPE adaptation is currently unreachable for mobile-only users (`WorkoutTrackerScreen.tsx:661` never sends `rpe`).
- Single-recommendation-slot precedence: `DashboardSummaryDTO.adaptation` holds ONE recommendation; simultaneous signals need an explicit rule or a contract-breaking shape change.
- Confirm-route generalization: extending `isConfirmable`/the mutation call for a load-based change must preserve the exact consume-before-write + rollback-on-failure discipline (`plan.ts:763-816`) to avoid reintroducing the #244 bug class.
- Quota interaction: any new confirm path must reuse the fresh-idempotency-key-per-request pattern (`plan.ts:775`).
- Scope ambiguity: if "feedback" means more than RPE (e.g. qualitative difficulty notes), that requires net-new capture (schema + UI on both platforms), which is out of reach of "reuse 14a infra" and needs clarification before scoping.

### Ready for Proposal
Yes — with one clarification the orchestrator should raise to the user before `sdd-propose`: should 14b ship RPE-based adaptation at mobile/web parity (requiring new mobile RPE-capture UI in scope), or web-only first with mobile explicitly deferred as a tracked follow-up? This materially changes task scope.
