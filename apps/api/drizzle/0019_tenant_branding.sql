CREATE TABLE "tenant_branding" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"subdomain_slug" text NOT NULL,
	"logo_storage_key" text,
	"accent" text,
	"accent_fg" text,
	"surface" text,
	"surface2" text,
	"fg" text,
	"muted" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_branding_accent_hex_chk" CHECK ("tenant_branding"."accent" IS NULL OR "tenant_branding"."accent" ~ '^#[0-9a-fA-F]{6}$'),
	CONSTRAINT "tenant_branding_accent_fg_hex_chk" CHECK ("tenant_branding"."accent_fg" IS NULL OR "tenant_branding"."accent_fg" ~ '^#[0-9a-fA-F]{6}$'),
	CONSTRAINT "tenant_branding_surface_hex_chk" CHECK ("tenant_branding"."surface" IS NULL OR "tenant_branding"."surface" ~ '^#[0-9a-fA-F]{6}$'),
	CONSTRAINT "tenant_branding_surface2_hex_chk" CHECK ("tenant_branding"."surface2" IS NULL OR "tenant_branding"."surface2" ~ '^#[0-9a-fA-F]{6}$'),
	CONSTRAINT "tenant_branding_fg_hex_chk" CHECK ("tenant_branding"."fg" IS NULL OR "tenant_branding"."fg" ~ '^#[0-9a-fA-F]{6}$'),
	CONSTRAINT "tenant_branding_muted_hex_chk" CHECK ("tenant_branding"."muted" IS NULL OR "tenant_branding"."muted" ~ '^#[0-9a-fA-F]{6}$')
);
--> statement-breakpoint
ALTER TABLE "tenant_branding" ADD CONSTRAINT "tenant_branding_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_branding_subdomain_slug_unique" ON "tenant_branding" USING btree ("subdomain_slug");
