-- #353 — mark synthetic accounts so the retention funnel can exclude them.
--
-- Adds `is_test` to `tenants` and `users`. Nothing in the schema could
-- distinguish a throwaway automated-test sign-up from a real one: there was no
-- flag, no enforced email-domain convention and no exclusion list, so every
-- aggregate over `tenants`/`users` silently mixed the two. This is not a local
-- development problem — the same automated flows run against, and register
-- into, the deployed database.
--
-- BACKFILL — why every existing row is marked `true`:
-- the repository owner confirmed that every account that exists at the time of
-- this migration is a test account. The product has not yet onboarded a real
-- user, and the accounts present are registrations from manual QA, e2e suites
-- and demos. Marking them all is therefore not an approximation: it is the
-- accurate state of the data today, and it is also the only direction that is
-- safe to get wrong in bulk — a real account wrongly excluded would be
-- invisible, whereas a test account wrongly included corrupts every ratio the
-- funnel reports. From here on the flag is set explicitly at creation time
-- (see `apps/api/scripts/e2e-seed.mjs`), so the backfill is a one-off.
--
-- The column DEFAULT stays `false`, so the ordinary registration path keeps
-- producing real accounts without touching it.
ALTER TABLE "tenants" ADD COLUMN "is_test" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_test" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
UPDATE "tenants" SET "is_test" = true;
--> statement-breakpoint
UPDATE "users" SET "is_test" = true;
--> statement-breakpoint
-- Partial indexes on the real accounts only. Every funnel query filters
-- `is_test = false`, and after the backfill that predicate selects a tiny
-- minority of a table dominated by synthetic rows — exactly the shape a partial
-- index serves well, while staying far smaller than a full index on a boolean.
CREATE INDEX IF NOT EXISTS "tenants_real_accounts_idx" ON "tenants" ("created_at") WHERE "is_test" = false;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_real_accounts_idx" ON "users" ("created_at") WHERE "is_test" = false;
