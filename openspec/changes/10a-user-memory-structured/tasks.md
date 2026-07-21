# Tasks: 10a — User Memory Structured

## Review Workload Forecast

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | DB schema + contracts + repos | PR 1 | `pnpm --filter api test -- --testPathPattern 'user-profile|user-preference'` | N/A — repo tests with mock DB | Revert migration + remove repos/contract types |
| 2 | Profile + preferences API routes | PR 2 | `pnpm --filter api test -- --testPathPattern 'user-profile|user-preference'` | N/A — Fastify test client | Revert route files + app.ts registration |
| 3 | DELETE sessions + registration integration | PR 3 | `pnpm --filter api test -- --testPathPattern 'workout-session|provisioning|auth'` | Start session, then DELETE via API | Revert route changes + provisioning.ts |
| 4 | Profile page UI + navigation | PR 4 | `pnpm --filter web test` | Run `pnpm --filter web dev`, visit /profile | Revert page.tsx + ProfileForm + SidebarNav + MobileNav |
| 5 | Wizard pre-fill + new preferences step | PR 5 | `pnpm --filter web test` | Run `pnpm --filter web dev`, use wizard | Revert wizard step + pre-fill hook |
| 6 | i18n keys en + es | PR 6 | `pnpm test -- --testPathPattern 'catalog-parity'` | N/A — static JSON only | Revert en.json + es.json changes |

## Slice 1: DB Schema + Contracts + Repos (~310 LoC)

- [x] 1.1 Add `goalEnum` and `experienceLevelEnum` pgEnums to schema.ts
- [x] 1.2 Add `userProfiles` table (userId unique, name required, goal/experienceLevel nullable)
- [x] 1.3 Add `userPreferences` table (userId unique, defaultLocation/defaultDuration/defaultEquipment nullable)
- [x] 1.4 Generate Drizzle migration: `pnpm --filter api db:generate`
- [x] 1.5 Add `UserProfile` and `UserPreferences` types to `packages/contracts/src/index.ts`
- [x] 1.6 [RED] Write failing tests for `UserProfileRepository`: findByUserId returns profile, returns undefined when missing, upsert creates, upsert updates
- [x] 1.6 [GREEN] Create `apps/api/src/db/repositories/user-profile.ts` (findByUserId + upsert)
- [x] 1.6 [TRIANGLE] Test: user isolation (user A cannot read user B's profile)
- [x] 1.7 [RED] Write failing tests for `UserPreferencesRepository`: findByUserId, upsert creates, upsert partial merge keeps existing fields, upsert overwrites sent fields
- [x] 1.7 [GREEN] Create `apps/api/src/db/repositories/user-preferences.ts` (findByUserId + upsert)
- [x] 1.7 [TRIANGLE] Test: duration validation at repo level, empty equipment array

## Slice 2: Profile + Preferences API Routes (~280 LoC)

- [x] 2.1 [RED] Test: `GET /user-profile` returns profile, lazy-provisions default row when missing, user isolation
- [x] 2.1 [GREEN] Route: `GET /user-profile` with lazy provision (default name = email prefix)
- [x] 2.2 [RED] Test: `PUT /user-profile` — 422 on blank name, 422 invalid goal/experienceLevel, valid update persists
- [x] 2.2 [GREEN] Route: `PUT /user-profile` with validations
- [x] 2.3 [RED] Test: `GET /user-preferences` returns preferences, user isolation, empty returns null fields
- [x] 2.3 [GREEN] Route: `GET /user-preferences`
- [x] 2.4 [RED] Test: `PUT /user-preferences` — 422 on non-positive duration, partial merge preserves unsent, empty equipment array OK
- [x] 2.4 [GREEN] Route: `PUT /user-preferences` with partial merge
- [x] 2.5 Register `userProfileRoutes` and `userPreferencesRoutes` in `apps/api/src/app.ts`

## Slice 3: DELETE Sessions + Registration Integration (~220 LoC)

- [ ] 3.1 [RED] Test: `deleteById` deletes owned completed session, returns 404 for nonexistent, 404 for other user's session, 409 for active
- [ ] 3.1 [GREEN] Add `deleteById(tenantId, userId, id)` to `WorkoutSessionRepository` with active guard
- [ ] 3.2 [RED] Test: `deleteAllByUser` deletes all completed sessions, returns count, returns 0 when none, 409 when active exists, cascade removes exercises+sets
- [ ] 3.2 [GREEN] Add `deleteAllByUser(tenantId, userId)` to `WorkoutSessionRepository` with active guard
- [ ] 3.3 [RED] Test route: `DELETE /workout-sessions/:id` — 204 on success, 404/409 as above
- [ ] 3.3 [GREEN] Add `DELETE /workout-sessions/:id` to workout-session routes
- [ ] 3.4 [RED] Test route: `DELETE /workout-sessions` — 200 + `{ deletedCount }`, 409 on active, 200 + `{ deletedCount: 0 }` when empty
- [ ] 3.4 [GREEN] Add `DELETE /workout-sessions` to workout-session routes
- [ ] 3.5 [RED] Test: `provisionTenantForUser` inserts default profile row inside transaction
- [ ] 3.5 [GREEN] Add `userProfiles` insert to `provisionTenantForUser` inside existing transaction
- [ ] 3.6 Modify `AuthService.getProfile` to return `name` from `userProfiles` with email-derived initials fallback

## Slice 4: Profile Page UI + Navigation (~280 LoC)

- [ ] 4.1 Create `apps/web/src/app/(app)/profile/ProfileForm.tsx` — client component fetching GET /user-profile and GET /user-preferences
- [ ] 4.2 Render editable form: name (text), goal (select), experienceLevel (select), preferences section
- [ ] 4.3 Save button: calls PUT /user-profile + PUT /user-preferences, success toast on save
- [ ] 4.4 Loading skeleton during fetch, error state if API fails
- [ ] 4.5 Convert `profile/page.tsx` from Server Component to Client Component rendering ProfileForm
- [ ] 4.6 Make sidebar user area clickable: wrap avatar+name in a `<Link href="/profile">` so clicking navigates to profile page
- [ ] 4.7 Add profile link to mobile nav (e.g. user menu or settings icon linking to /profile)

## Slice 5: Wizard Pre-fill + New Preferences Step (~190 LoC)

- [ ] 5.1 Create wizard preferences step component (defaultLocation, defaultDuration, defaultEquipment selects/inputs)
- [ ] 5.2 Add pre-fill hook: fetch `GET /user-preferences` on wizard mount, pre-fill step state, no-op on 204/404
- [ ] 5.3 Wire new step into wizard step sequence (between existing equipment and limitations steps)
- [ ] 5.4 [RED] Test: wizard pre-fills from preferences when row exists, shows null/empty defaults when missing
- [ ] 5.4 [GREEN] Verify pre-fill integration

## Slice 6: i18n Keys (~30 LoC)

- [ ] 6.1 Add profile form i18n keys to `packages/i18n/src/messages/en.json`
- [ ] 6.2 Add profile form i18n keys to `packages/i18n/src/messages/es.json` (neutral Spanish)
- [ ] 6.3 Verify `catalog-parity` test passes

## Implementation Order

Slice 1 → Slice 2 → Slice 3 → Slice 4 → Slice 5 → Slice 6. Slices 3 (DELETE sessions) and 6 (i18n) can be parallelized: 3 has no deps on 1/2, 6 has no deps on anything. But in stacked-to-main, keep order clean: 1→2→3→4→5, and squash 6 into any UI PR.

## Next Step

Ready for implementation (sdd-apply) — user pre-selected stacked-to-main chained PRs. Start with Slice 1.
