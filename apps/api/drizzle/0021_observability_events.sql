CREATE TYPE "public"."observability_level" AS ENUM('info', 'warn', 'error');--> statement-breakpoint
CREATE TABLE "observability_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"actor_user_id" uuid,
	"level" "observability_level" NOT NULL,
	"event" text NOT NULL,
	"outcome" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "observability_events_tenant_created_idx" ON "observability_events" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "observability_events_created_idx" ON "observability_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "observability_events_level_created_idx" ON "observability_events" USING btree ("level","created_at");
