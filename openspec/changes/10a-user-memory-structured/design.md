# Design: 10a — User Memory Structured

## Technical Approach

Two new user-scoped Drizzle tables (`user_profiles`, `user_preferences`) with REST CRUD endpoints, wired into the existing Fastify route pattern. Registration auto-provisions a default profile row inside the existing `provisionTenantForUser` transaction. Profile page becomes a client component with form state. Wizard reads preferences on mount with graceful fallback.

## Architecture Decisions

| Decision | Options Considered | Tradeoff | Choice |
|----------|-------------------|----------|--------|
| User-scoped vs tenant-scoped | User-scoped unique on `userId` vs tenant+user unique | Personal data (name, goal) doesn't change per tenant; user-scoped avoids duplication and simplifies queries | **User-scoped** — profiles/preferences keyed by `userId` only |
| Separate tables vs extending `users` | `user_profiles`/`user_preferences` tables vs adding columns to `users` | Separation keeps identity (auth) separate from domain data (training context); avoids widening the auth-critical `users` table | **Separate tables** |
| PUT with upsert vs PATCH for preferences | Full PUT replace vs partial PATCH | Spec requires partial updates; PUT with `ON CONFLICT` merge is simpler than PATCH semantics | **PUT with partial merge** — undefined fields stay unchanged |
| Repository pattern | Dedicated repos vs inline DB calls in routes | Existing codebase uses repo-per-domain pattern (CredentialsRepository, WorkoutSessionRepository, etc.) | **Repository per table** — follows established pattern |

## Data Model

### Drizzle Schema (add to `apps/api/src/db/schema.ts`)

```ts
export const goalEnum = pgEnum("user_goal", [
  "strength",
  "hypertrophy",
  "fat_loss",
  "general_fitness",
]);

export const experienceLevelEnum = pgEnum("user_experience_level", [
  "beginner",
  "intermediate",
  "advanced",
]);

export const userProfiles = pgTable(
  "user_profiles",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    goal: goalEnum("goal"),
    experienceLevel: experienceLevelEnum("experience_level"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdUnique: uniqueIndex("user_profiles_user_id_unique").on(table.userId),
  })
);

export const userPreferences = pgTable(
  "user_preferences",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    defaultLocation: text("default_location"),
    defaultDuration: integer("default_duration"),
    defaultEquipment: jsonb("default_equipment").$type<string[]>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdUnique: uniqueIndex("user_preferences_user_id_unique").on(table.userId),
  })
);
```

Key: `userId` unique index (not tenant+user) — profiles are global per user, not per tenant. `defaultEquipment` is `jsonb` typed as `string[]` (PostgreSQL supports array operations on jsonb; simpler than `text[]` for Drizzle).

## API Design

### Profile Endpoints

| Method | Path | Body | Response | Status |
|--------|------|------|----------|--------|
| `GET` | `/user-profile` | — | `{ name, goal, experienceLevel }` | 200 |
| `PUT` | `/user-profile` | `{ name, goal?, experienceLevel? }` | `{ name, goal, experienceLevel }` | 200 |

**Validation**: `name` required, non-blank string. `goal` must be valid enum or absent. `experienceLevel` must be valid enum or absent. 422 on invalid input.

### Preferences Endpoints

| Method | Path | Body | Response | Status |
|--------|------|------|----------|--------|
| `GET` | `/user-preferences` | — | `{ defaultLocation, defaultDuration, defaultEquipment }` | 200 |
| `PUT` | `/user-preferences` | Partial: any subset of fields | `{ defaultLocation, defaultDuration, defaultEquipment }` | 200 |

**Validation**: `defaultDuration` must be positive integer when present. `defaultEquipment` must be array of strings when present. Partial update — unsent fields remain unchanged (upsert with merge semantics).

### Workout Session Delete Endpoints

| Method | Path | Response | Status |
|--------|------|----------|--------|
| `DELETE` | `/workout-sessions/:id` | — | 204 (no content) |
| `DELETE` | `/workout-sessions` | `{ deletedCount: number }` | 200 |

**Validation**: Active sessions return 409. Nonexistent/other-user returns 404. Cross-tenant returns 404. Bulk returns count=0 when no sessions.

## Registration Integration

Modify `provisionTenantForUser` in `apps/api/src/tenant/provisioning.ts`:

```ts
// Inside the existing transaction, after membership insert:
await tx.insert(userProfiles).values({
  userId: userRow.id,
  name: input.userEmail.split("@")[0] ?? "user",
});
```

Single INSERT, zero overhead on existing flow. Profile row is created with `goal=NULL`, `experienceLevel=NULL` — user completes these on the profile page.

## Wizard Pre-fill

In the wizard component (likely `apps/web/src/app/(app)/create-plan/`):
- On mount, call `GET /user-preferences`
- If 200 with data → pre-fill `defaultLocation`, `defaultDuration`, `defaultEquipment` into wizard state
- If 204/404 → no-op, wizard behaves exactly as today
- No blocking — wizard renders immediately, preferences load async

## UI Changes

### Profile Page (`apps/web/src/app/(app)/profile/page.tsx`)

Convert from Server Component to Client Component:
- Fetch `GET /user-profile` and `GET /user-preferences` on mount
- Render editable form: name (text input), goal (select), experienceLevel (select)
- Preferences section: defaultLocation (select: home/gym/outdoor), defaultDuration (number input, minutes), defaultEquipment (multi-select or tag input)
- Save button calls `PUT /user-profile` + `PUT /user-preferences`
- Loading skeleton during fetch, success toast on save

### Sidebar (`apps/web/src/components/AppShell/SidebarNav.tsx`)

Modify `GET /auth/profile` to return `name` from `user_profiles` instead of deriving initials from email. Fallback to email-derived initials when profile row doesn't exist yet (migration edge case).

## i18n

New keys in `packages/i18n/src/messages/en.json` and `es.json`:

```json
"profile": {
  "title": "Profile",
  "description": "Manage your account settings and preferences.",
  "name": "Name",
  "namePlaceholder": "Your name",
  "goal": "Training Goal",
  "experienceLevel": "Experience Level",
  "preferences": "Default Preferences",
  "defaultLocation": "Default Location",
  "defaultDuration": "Default Duration (minutes)",
  "defaultEquipment": "Default Equipment",
  "save": "Save Changes",
  "saved": "Profile updated successfully",
  "error": "Failed to save profile"
}
```

## Affected Files

| File | Action | Description |
|------|--------|-------------|
| `apps/api/src/db/schema.ts` | Modify | Add `goalEnum`, `experienceLevelEnum`, `userProfiles`, `userPreferences` |
| `apps/api/src/db/repositories/user-profile.ts` | Create | Profile CRUD repository |
| `apps/api/src/db/repositories/user-preferences.ts` | Create | Preferences CRUD repository |
| `apps/api/src/routes/user-profile.ts` | Create | GET/PUT profile routes |
| `apps/api/src/routes/user-preferences.ts` | Create | GET/PUT preferences routes |
| `apps/api/src/routes/workout-session.ts` | Modify | Add DELETE individual + bulk endpoints |
| `apps/api/src/db/repositories/workout-session.ts` | Modify | Add `deleteById` and `deleteAllByUser` methods |
| `apps/api/src/tenant/provisioning.ts` | Modify | Insert default profile row in transaction |
| `apps/api/src/app.ts` | Modify | Register new route plugins |
| `apps/web/src/app/(app)/profile/page.tsx` | Modify | Replace placeholder with client form component |
| `apps/web/src/app/(app)/profile/ProfileForm.tsx` | Create | Client component with form state |
| `packages/contracts/src/index.ts` | Modify | Add `UserProfile`, `UserPreferences` types |
| `packages/i18n/src/messages/en.json` | Modify | Add profile form i18n keys |
| `packages/i18n/src/messages/es.json` | Modify | Add profile form i18n keys (Spanish) |

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | Profile/preferences repo CRUD, validation | Vitest + mock DB |
| Unit | Registration creates profile row | Vitest, verify transaction inserts profile |
| Integration | GET/PUT profile routes, error cases | Vitest + Fastify test client |
| Integration | PUT preferences partial update, duration validation | Vitest + Fastify test client |
| Integration | DELETE session endpoints (owned, cross-user, active guard, bulk) | Vitest + Fastify test client |
| E2E | Profile page renders, form saves, sidebar shows name | Playwright |
| E2E | Wizard pre-fills from preferences | Playwright |

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary.

## Migration / Rollout

Drizzle migration adds tables + enums. Existing users get no profile row until registration or first profile visit. `GET /auth/profile` falls back to email-derived initials when profile row is absent. No data migration needed — purely additive.

## Resolved Questions

- [x] `GET /user-profile` lazily provisions a default row if none exists (defensive, avoids 404 on first load).
- [x] Wizard gets a NEW preferences step (not just pre-fill on existing steps) — new plumbing + new step.
