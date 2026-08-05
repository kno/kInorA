-- #354 — user-attribution FKs become ON DELETE SET NULL so an account can be
-- deleted in one statement (GDPR erasure prerequisite) without erasing the
-- billing audit trail or a tenant's configured entitlements.
--
-- Hand-scoped delta: `drizzle-kit generate` diffs from `meta/0011_snapshot.json`
-- (migrations 0012–0023 were hand-authored with no snapshot), so its cumulative
-- output re-emits already-applied DDL. Only the four attribution FKs below are
-- new; `meta/0024_snapshot.json` records the true resulting state.
ALTER TABLE "billing_audit_events" ALTER COLUMN "actor_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "member_quota_allocations" ALTER COLUMN "updated_by_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_billing_overrides" ALTER COLUMN "created_by_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_audit_events" DROP CONSTRAINT "billing_audit_events_actor_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "billing_audit_events" DROP CONSTRAINT "billing_audit_events_subject_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "member_quota_allocations" DROP CONSTRAINT "member_quota_allocations_updated_by_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "tenant_billing_overrides" DROP CONSTRAINT "tenant_billing_overrides_created_by_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "billing_audit_events" ADD CONSTRAINT "billing_audit_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_audit_events" ADD CONSTRAINT "billing_audit_events_subject_user_id_users_id_fk" FOREIGN KEY ("subject_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_quota_allocations" ADD CONSTRAINT "member_quota_allocations_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_billing_overrides" ADD CONSTRAINT "tenant_billing_overrides_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
