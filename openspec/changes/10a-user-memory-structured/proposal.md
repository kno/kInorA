# Proposal: 10a — User Memory Structured

## Intent

kInorA has zero user profile or preference storage. The `users` table only stores id/email/isAdmin. User training context (name, goals, experience level, preferred location/duration/equipment) lives nowhere persistent — it exists only inside individual `PlanSpec` JSON blobs, per-plan, not reusable across sessions. This change introduces first-class user memory so the app can personalize without re-asking, the wizard can pre-fill from saved preferences, and users see their name in the sidebar and dashboard.

## Target Users

- **Primary**: Any logged-in user who wants a personalized experience without re-entering context every time they create a plan or visit the dashboard.
- **Secondary**: Users who want to delete workout history (individual or bulk) — currently impossible despite cascade DDL existing.

## Scope

### In Scope

- **Two new user-scoped tables**: `user_profiles` (name, goal, experienceLevel) and `user_preferences` (defaultLocation, defaultDuration, defaultEquipment), both unique on `userId`.
- **CRUD API routes** for profile and preferences (GET/PUT per user).
- **DELETE endpoints** for workout sessions: individual (`DELETE /workout-sessions/:id`) and bulk (`DELETE /workout-sessions`).
- **Profile creation during registration**: extend `provisionTenantForUser` to insert a default `user_profiles` row.
- **Wizard pre-fill**: plan wizard reads `user_preferences` and pre-fills defaultLocation/defaultDuration/defaultEquipment steps.
- **Profile page UI**: replace the placeholder at `apps/web/src/app/(app)/profile/page.tsx` with an editable form (name, goal, experience level, preferences).
- **i18n keys** for all new profile form fields (en.json + es.json).
- **Name in sidebar/dashboard**: display user name from profile instead of deriving from email.

### Out of Scope

- **Vector/RAG memory** (change 10b) — separate spec, separate change.
- **Onboarding wizard flow** — wizard already exists; this change only adds pre-fill reads.
- **User avatar uploads** — not requested; can be a future additive change.
- **Multi-tenant profile sharing** — profiles are user-scoped, no cross-tenant view.

## Current State

| Area | Today | Gap |
|------|-------|-----|
| `users` table | id, email, isAdmin, timestamps only | No name, goal, experience, preferences |
| Profile page | Placeholder title + description | No editable fields, no API integration |
| Wizard | Reads from PlanSpec JSON only | No persistent per-user defaults to pre-fill |
| Workout DELETE | Cascade DDL exists | No API endpoints to trigger deletion |
| Registration | Creates user + tenant + membership | No profile row created |

## Proposed Solution

Two new Drizzle tables with unique indexes on `userId`:

- `user_profiles`: name (text, required), goal (enum: strength/hypertrophy/fat_loss/general_fitness), experienceLevel (enum: beginner/intermediate/advanced)
- `user_preferences`: defaultLocation (text), defaultDuration (integer minutes), defaultEquipment (text[] or jsonb)

API layer adds REST endpoints under the existing auth middleware. Profile page becomes a client component that fetches/PUTs profile and preferences. Registration flow adds a single INSERT for a default profile row. Wizard reads preferences on mount to pre-fill.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `apps/api/src/db/schema.ts` | New | Add `user_profiles` and `user_preferences` tables |
| `apps/api/src/db/repositories/` | New | Repository for profile + preferences CRUD |
| `apps/api/src/auth/service.ts` | Modified | Extend `provisionTenantForUser` to create default profile |
| `apps/api/src/` (routes) | New | Profile/preferences REST endpoints + session DELETE endpoints |
| `apps/web/src/app/(app)/profile/page.tsx` | Modified | Replace placeholder with editable form |
| `apps/web/src/app/` (components) | New | Profile form component |
| `apps/web/src/i18n/messages/en.json` | Modified | Add profile form i18n keys |
| `apps/web/src/i18n/messages/es.json` | Modified | Add profile form i18n keys (Spanish) |
| `packages/contracts/src/` | Modified | Add profile/preferences types and validation |

## Success Criteria

- [ ] User can view and edit their name, goal, and experience level on the profile page.
- [ ] User can view and edit default location, duration, and equipment preferences.
- [ ] Sidebar and dashboard display the user's name (not email-derived).
- [ ] Wizard pre-fills location/duration/equipment from saved preferences.
- [ ] User can delete a single workout session via UI button.
- [ ] User can bulk-delete workout sessions via UI action.
- [ ] Registration creates a default profile row automatically.
- [ ] All new endpoints enforce user isolation (user A cannot see user B's data).
- [ ] i18n parity test passes with new keys in both en.json and es.json.
- [ ] `pnpm type-check && pnpm test && pnpm architecture && pnpm deps-guard` all pass.

## Risks and Tradeoffs

- **Profile row on registration**: inserting during `provisionTenantForUser` adds a write to an existing transaction. Mitigation: single INSERT, negligible overhead, consistent with existing provisioning pattern.
- **Wizard pre-fill coupling**: wizard now depends on preferences table. Mitigation: graceful fallback — if no preferences row exists, wizard behaves exactly as today (null defaults).
- **Bulk delete UX**: users could accidentally delete all history. Mitigation: confirmation dialog with session count before executing bulk delete.
- **Goal enum extensibility**: 4 goals today, more tomorrow. Mitigation: PostgreSQL enum supports `ALTER TYPE ... ADD VALUE`; Drizzle migration is straightforward.

## Non-Goals

- Vector/embedding-based memory (10b handles this).
- Social features, profile sharing, or public profiles.
- Goal-specific training logic — goal is metadata, not a behavior trigger in this change.
- Profile completeness prompts or gamification.

## Rollback

1. Drop `user_profiles` and `user_preferences` tables via migration rollback.
2. Revert profile page to placeholder.
3. Remove profile/preferences API routes.
4. Revert wizard to non-pre-filled state.
5. No data loss risk: these are additive tables with no dependencies from existing tables.
