CREATE TYPE "public"."billing_cycle" AS ENUM('monthly', 'annual');--> statement-breakpoint
ALTER TYPE "public"."billing_source" ADD VALUE IF NOT EXISTS 'stripe';--> statement-breakpoint
CREATE TABLE "stripe_processed_events" (
	"event_id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"stripe_event_ts" timestamp with time zone,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenant_billing_states" ADD COLUMN "stripe_customer_id" text;--> statement-breakpoint
ALTER TABLE "tenant_billing_states" ADD COLUMN "stripe_subscription_id" text;--> statement-breakpoint
ALTER TABLE "tenant_billing_states" ADD COLUMN "stripe_subscription_status" text;--> statement-breakpoint
ALTER TABLE "tenant_billing_states" ADD COLUMN "current_period_end" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenant_billing_states" ADD COLUMN "cancel_at_period_end" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_billing_states" ADD COLUMN "billing_cycle" "billing_cycle";
