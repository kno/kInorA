CREATE TYPE "public"."billing_audit_action" AS ENUM('member_allocation_set', 'admin_override_created', 'admin_override_expired');--> statement-breakpoint
CREATE TYPE "public"."billing_decision" AS ENUM('allowed', 'denied');--> statement-breakpoint
CREATE TYPE "public"."billing_feature" AS ENUM('plan_generation', 'plan_regeneration', 'memory_write', 'memory_retrieval');--> statement-breakpoint
CREATE TYPE "public"."billing_source" AS ENUM('system', 'backfill', 'admin_override');--> statement-breakpoint
CREATE TYPE "public"."billing_status" AS ENUM('active', 'trialing', 'expired', 'overridden');--> statement-breakpoint
CREATE TYPE "public"."billing_tier" AS ENUM('free', 'pro');--> statement-breakpoint
CREATE TABLE "billing_audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"subject_user_id" uuid,
	"action" "billing_audit_action" NOT NULL,
	"feature" "billing_feature",
	"period" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_usage_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"feature" "billing_feature" NOT NULL,
	"period" text NOT NULL,
	"operation_key" text NOT NULL,
	"decision" "billing_decision" NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member_quota_allocations" (
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"feature" "billing_feature" NOT NULL,
	"period" text NOT NULL,
	"limit" integer NOT NULL,
	"updated_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_quota_allocations_limit_non_negative_chk" CHECK ("member_quota_allocations"."limit" >= 0)
);
--> statement-breakpoint
CREATE TABLE "member_quota_counters" (
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"feature" "billing_feature" NOT NULL,
	"period" text NOT NULL,
	"used" integer DEFAULT 0 NOT NULL,
	"limit" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_quota_counters_used_non_negative_chk" CHECK ("member_quota_counters"."used" >= 0),
	CONSTRAINT "member_quota_counters_limit_non_negative_chk" CHECK ("member_quota_counters"."limit" >= 0),
	CONSTRAINT "member_quota_counters_usage_within_limit_chk" CHECK ("member_quota_counters"."used" <= "member_quota_counters"."limit")
);
--> statement-breakpoint
CREATE TABLE "tenant_billing_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"tier" "billing_tier" NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_billing_overrides_active_window_chk" CHECK ("tenant_billing_overrides"."ends_at" > "tenant_billing_overrides"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "tenant_billing_states" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"tier" "billing_tier" NOT NULL,
	"status" "billing_status" NOT NULL,
	"source" "billing_source" NOT NULL,
	"trial_started_at" timestamp with time zone,
	"trial_ends_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_billing_states_trial_window_chk" CHECK ("tenant_billing_states"."trial_started_at" is null or "tenant_billing_states"."trial_ends_at" is null or "tenant_billing_states"."trial_ends_at" > "tenant_billing_states"."trial_started_at")
);
--> statement-breakpoint
CREATE TABLE "tenant_quota_counters" (
	"tenant_id" uuid NOT NULL,
	"feature" "billing_feature" NOT NULL,
	"period" text NOT NULL,
	"used" integer DEFAULT 0 NOT NULL,
	"limit" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_quota_counters_used_non_negative_chk" CHECK ("tenant_quota_counters"."used" >= 0),
	CONSTRAINT "tenant_quota_counters_limit_non_negative_chk" CHECK ("tenant_quota_counters"."limit" >= 0),
	CONSTRAINT "tenant_quota_counters_usage_within_limit_chk" CHECK ("tenant_quota_counters"."used" <= "tenant_quota_counters"."limit")
);
--> statement-breakpoint
ALTER TABLE "billing_audit_events" ADD CONSTRAINT "billing_audit_events_subject_user_id_users_id_fk" FOREIGN KEY ("subject_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_audit_events" ADD CONSTRAINT "billing_audit_events_tenant_actor_memberships_fk" FOREIGN KEY ("tenant_id","actor_user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_usage_ledger" ADD CONSTRAINT "billing_usage_ledger_tenant_user_memberships_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_quota_allocations" ADD CONSTRAINT "member_quota_allocations_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_quota_allocations" ADD CONSTRAINT "member_quota_allocations_tenant_user_memberships_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_quota_counters" ADD CONSTRAINT "member_quota_counters_tenant_user_memberships_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_billing_overrides" ADD CONSTRAINT "tenant_billing_overrides_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_billing_overrides" ADD CONSTRAINT "tenant_billing_overrides_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_billing_states" ADD CONSTRAINT "tenant_billing_states_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_quota_counters" ADD CONSTRAINT "tenant_quota_counters_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "billing_audit_events_tenant_created_idx" ON "billing_audit_events" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_usage_ledger_operation_unique" ON "billing_usage_ledger" USING btree ("tenant_id","user_id","feature","period","operation_key");--> statement-breakpoint
CREATE INDEX "billing_usage_ledger_period_idx" ON "billing_usage_ledger" USING btree ("tenant_id","user_id","period");--> statement-breakpoint
CREATE UNIQUE INDEX "member_quota_allocations_scope_unique" ON "member_quota_allocations" USING btree ("tenant_id","user_id","feature","period");--> statement-breakpoint
CREATE UNIQUE INDEX "member_quota_counters_scope_unique" ON "member_quota_counters" USING btree ("tenant_id","user_id","feature","period");--> statement-breakpoint
CREATE INDEX "member_quota_counters_period_idx" ON "member_quota_counters" USING btree ("tenant_id","user_id","period");--> statement-breakpoint
CREATE INDEX "tenant_billing_overrides_active_window_idx" ON "tenant_billing_overrides" USING btree ("tenant_id","starts_at","ends_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_quota_counters_scope_unique" ON "tenant_quota_counters" USING btree ("tenant_id","feature","period");--> statement-breakpoint
CREATE INDEX "tenant_quota_counters_period_idx" ON "tenant_quota_counters" USING btree ("tenant_id","period");
--> statement-breakpoint
INSERT INTO "tenant_billing_states" ("tenant_id", "tier", "status", "source")
SELECT "id", 'free', 'active', 'backfill' FROM "tenants"
ON CONFLICT ("tenant_id") DO NOTHING;
