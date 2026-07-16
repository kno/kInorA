# Proposal: Offline Workout Capture, Reconnect Sync & Session History (09b)

## Intent

Today the tracker (09a) writes every set/complete straight to the network on both web (via Server Actions) and mobile (direct API). A dropped connection surfaces as an inline error; nothing is queued or retried, so mid-gym data is lost. This change makes workout logging offline-first on both platforms, syncs safely on reconnect, and adds the historical progress view the roadmap promises for v1. Addresses README roadmap item 09b.

## Scope

### In Scope
- Offline capture of set records + session completion on **web AND mobile** (local queue + optimistic UI).
- Reconnect sync: flush queued mutations through existing idempotent endpoints, last-write-wins per `setId`.
- Bugfix: `POST /workout-sessions/:id/complete` retried after success must be idempotent (no-op success, not 404).
- Session History: new read endpoint + pure domain aggregation (total volume, avg RPE, trend) with web + mobile surfaces. Independent, lower-risk slice — MUST NOT depend on the sync layer.
- Shared connectivity-detection abstraction (`navigator.onLine` vs Expo NetInfo).

### Out of Scope (Non-Goals)
- Event-sourcing / append-only mutation log.
- Multi-device merge or concurrent-session reconciliation.
- Conflict-resolution UI (last-write-wins is silent, no prompts).
- Signed short-lived client tokens / browser-calls-API-directly security model.
- New offline `POST /workout-sessions` start (start still requires connectivity — server snapshot needed).

## Capabilities

### New Capabilities
- None (all three requirements already live in `openspec/specs/09b-v1-workout-offline-history/spec.md`).

### Modified Capabilities
- `09b-v1-workout-offline-history`: refine the three existing requirements — clarify **Offline Workout Capture** covers web+mobile; strengthen **Reconnect Sync** to mandate idempotent complete + last-write-wins per setId (no loss/duplication); scope **Session History** as sync-independent domain aggregation.

## Approach

Client-side **mutation queue over the existing endpoints** (not an event log), per exploration Approach 1. Server pre-assigns `setId`s at session start; PATCH is idempotent by full-state overwrite, so replay is safe. Queue writes locally, apply optimistically, flush on reconnect. Fix the complete-endpoint idempotency gap. History is a separate read endpoint feeding pure aggregation in `packages/domain`, DTOs in `packages/contracts`. Strict TDD: specs/tasks/apply are test-first.

### Architectural Exception Decision (must be formalized in sdd-design)
Web convention "browser never calls the API directly; Server Actions carry the httpOnly token" is incompatible with offline capture (a Server Action is itself a network hop). We accept a **narrow, documented exception**: an offline mutation queue in the browser (IndexedDB) that only invokes existing Server Actions on flush/reconnect. Design MUST formalize the allowed exception scope and whether the queue relays via Server Actions or a scoped direct call. No move to client tokens.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `apps/api/src/routes/workout-session.ts`, `.../repositories/workout-session.ts` | Modified | Idempotent complete; new history read endpoint |
| `apps/api/src/db/schema.ts` | Possibly Modified | Optional `syncedAt` marker if design needs it |
| `apps/web/.../plan/use-workout-session.ts`, `tracker-client.ts`, `actions.ts` | Modified | Offline queue layer between UI and Server Actions |
| `apps/mobile/src/api/workout-session.ts`, `WorkoutTrackerScreen.tsx` | Modified | Local queue/store + reconnect flush |
| `packages/domain/src/plan/` | New | Pure volume/avg-RPE/trend aggregation |
| `packages/contracts/src/index.ts` | New | History + offline-queue payload DTOs |
| `scripts/deps-guard.mjs` | Modified | Allow-list chosen storage libs (mobile expo-sqlite blocked today; web IndexedDB) |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Web Server-Action-only convention exception mis-scoped | Med | Formalize narrow exception in sdd-design before apply |
| Complete-endpoint idempotency regression | Med | Test-first fix; treat completed-session retry as success |
| Storage lib not allow-listed (deps-guard blocks expo-sqlite) | High | Update deps-guard/cruiser; lib choice deferred to design |
| Connectivity detection differs per runtime | Med | Single shared abstraction, not duplicated per app |
| History aggregation untested (no existing domain code) | Med | Pure functions unit-tested in `packages/domain` |

## Rollback Plan

Additive and feature-gated. Revert per slice: (1) offline queue is client-only — removing it restores direct online writes; (2) complete-endpoint fix is a small isolated route change, revertible independently; (3) History is a new endpoint + route, removable without touching the tracker. No destructive schema migration required (any `syncedAt` column is additive/nullable).

## Dependencies

- `09a-v1-workout-tracking-core` (implemented, archived)
- `06-v1-mobile-foundation` (implemented — provides web PWA/service worker, mobile shell)
- Storage lib selection (web IndexedDB helper, mobile expo-sqlite/AsyncStorage) — decided in sdd-design.

## Success Criteria

- [ ] Sets/RPE/notes logged offline persist locally and stay visible (web + mobile).
- [ ] On reconnect, queued mutations sync exactly once — no loss, no duplication.
- [ ] Retrying `complete` after success returns success, not 404.
- [ ] History shows date, duration, exercises, total volume, avg RPE, and trend.
- [ ] History works independently of the sync layer.
- [ ] `pnpm test`, `pnpm type-check`, `pnpm architecture` pass; deps-guard allows chosen storage libs.
