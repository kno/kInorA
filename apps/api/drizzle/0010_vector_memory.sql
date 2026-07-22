CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TYPE "public"."user_memory_consent" AS ENUM('granted', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."user_memory_eligibility" AS ENUM('eligible', 'secret', 'raw_transcript', 'full_plan', 'sensitive_health', 'other');--> statement-breakpoint
CREATE TYPE "public"."user_memory_status" AS ENUM('candidate', 'confirmed', 'embedding_pending', 'active', 'rejected', 'failed', 'deleted');--> statement-breakpoint
CREATE TABLE "user_memory_vectors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"summary" text NOT NULL,
	"source" text NOT NULL,
	"status" "user_memory_status" NOT NULL,
	"eligibility" "user_memory_eligibility" NOT NULL,
	"consent_status" "user_memory_consent" NOT NULL,
	"consented_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"idempotency_key" text NOT NULL,
	"fingerprint" text NOT NULL,
	"schema_version" text DEFAULT '1' NOT NULL,
	"embedding_provider" text NOT NULL,
	"embedding_model" text NOT NULL,
	"embedding_version" text NOT NULL,
	"embedding_dimension" integer NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"disabled_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vector_memory_settings" (
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"settings_version" integer DEFAULT 1 NOT NULL,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_memory_vectors" ADD CONSTRAINT "user_memory_vectors_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_memory_vectors" ADD CONSTRAINT "user_memory_vectors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vector_memory_settings" ADD CONSTRAINT "vector_memory_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vector_memory_settings" ADD CONSTRAINT "vector_memory_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_memory_vectors_owner_status_idx" ON "user_memory_vectors" USING btree ("tenant_id","user_id","status");--> statement-breakpoint
CREATE INDEX "user_memory_vectors_owner_embedding_metadata_idx" ON "user_memory_vectors" USING btree ("tenant_id","user_id","embedding_provider","embedding_model","embedding_version","embedding_dimension");--> statement-breakpoint
CREATE UNIQUE INDEX "user_memory_vectors_tenant_user_idempotency_unique" ON "user_memory_vectors" USING btree ("tenant_id","user_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "user_memory_vectors_tenant_user_fingerprint_active_unique" ON "user_memory_vectors" USING btree ("tenant_id","user_id","fingerprint") WHERE "user_memory_vectors"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "vector_memory_settings_tenant_user_unique" ON "vector_memory_settings" USING btree ("tenant_id","user_id");
