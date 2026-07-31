CREATE TYPE "public"."trainer_assignment_status" AS ENUM('invited', 'active', 'revoked');--> statement-breakpoint
CREATE TABLE "trainer_client_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"trainer_user_id" uuid NOT NULL,
	"client_user_id" uuid NOT NULL,
	"status" "trainer_assignment_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trainer_client_assignments" ADD CONSTRAINT "trainer_client_assignments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trainer_client_assignments" ADD CONSTRAINT "trainer_client_assignments_trainer_user_id_users_id_fk" FOREIGN KEY ("trainer_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trainer_client_assignments" ADD CONSTRAINT "trainer_client_assignments_client_user_id_users_id_fk" FOREIGN KEY ("client_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "trainer_client_assignments_tenant_client_unique" ON "trainer_client_assignments" USING btree ("tenant_id","client_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trainer_client_assignments_client_active_unique" ON "trainer_client_assignments" USING btree ("client_user_id") WHERE "trainer_client_assignments"."status" <> 'revoked';--> statement-breakpoint
CREATE INDEX "trainer_client_assignments_trainer_idx" ON "trainer_client_assignments" USING btree ("tenant_id","trainer_user_id");
