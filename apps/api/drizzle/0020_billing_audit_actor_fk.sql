ALTER TABLE "billing_audit_events" DROP CONSTRAINT "billing_audit_events_tenant_actor_memberships_fk";--> statement-breakpoint
ALTER TABLE "billing_audit_events" ADD CONSTRAINT "billing_audit_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
