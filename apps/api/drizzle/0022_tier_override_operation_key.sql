ALTER TABLE "tenant_billing_overrides" ADD COLUMN "operation_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_billing_overrides_operation_key_uq" ON "tenant_billing_overrides" USING btree ("tenant_id","operation_key") WHERE "operation_key" IS NOT NULL;
