import { eq } from "drizzle-orm";
import { tenantBranding } from "../schema.js";
import type { Database } from "../client.js";
import type { BrandingPalette, TenantBrandingDTO } from "@kinora/contracts";

/**
 * Tenant branding persistence repository (16a-v3-gym-white-label, Slice 1).
 * Dark/additive: no route calls this yet — the gated CRUD route and the
 * PUBLIC read-by-slug route land in Slice 3; the logo upload route (Slice 2)
 * writes `logoStorageKey` via `upsert` once wired.
 *
 * `findByTenantId` is the tenant-scoped authenticated read; `findBySubdomainSlug`
 * backs the future PUBLIC endpoint and is deliberately NOT tenant-scoped by an
 * authenticated caller's `tenantId` — the slug itself is the sole lookup key
 * for a public, unauthenticated request. `upsert` is scoped by `tenantId` on
 * write via `onConflictDoUpdate` targeting the primary key, so a tenant can
 * only ever create or update its own single branding row.
 */
type BrandingRow = {
  tenantId: string;
  subdomainSlug: string;
  logoStorageKey: string | null;
  accent: string | null;
  accentFg: string | null;
  surface: string | null;
  surface2: string | null;
  fg: string | null;
  muted: string | null;
};

function toPalette(row: BrandingRow): BrandingPalette {
  return {
    accent: row.accent,
    accentFg: row.accentFg,
    surface: row.surface,
    surface2: row.surface2,
    fg: row.fg,
    muted: row.muted,
  };
}

function toDTO(row: BrandingRow): TenantBrandingDTO & { logoStorageKey: string | null } {
  return {
    tenantId: row.tenantId as TenantBrandingDTO["tenantId"],
    subdomainSlug: row.subdomainSlug,
    logoUrl: null,
    logoStorageKey: row.logoStorageKey,
    palette: toPalette(row),
  };
}

export interface UpsertTenantBrandingInput {
  subdomainSlug: string;
  logoStorageKey: string | null;
  accent: string | null;
  accentFg: string | null;
  surface: string | null;
  surface2: string | null;
  fg: string | null;
  muted: string | null;
}

export class TenantBrandingRepository {
  constructor(private db: Database) {}

  /** Tenant-scoped authenticated read. */
  async findByTenantId(
    tenantId: string,
  ): Promise<(TenantBrandingDTO & { logoStorageKey: string | null }) | undefined> {
    const rows = await this.db
      .select()
      .from(tenantBranding)
      .where(eq(tenantBranding.tenantId, tenantId));
    const row = rows[0] as BrandingRow | undefined;
    return row ? toDTO(row) : undefined;
  }

  /**
   * PUBLIC read-by-slug — the sole lookup key is the slug itself, not a
   * caller-supplied tenantId (there is no authenticated caller for this
   * route). Consumed by the Slice 3 `GET /public/branding/by-slug/:slug` route.
   */
  async findBySubdomainSlug(
    subdomainSlug: string,
  ): Promise<(TenantBrandingDTO & { logoStorageKey: string | null }) | undefined> {
    const rows = await this.db
      .select()
      .from(tenantBranding)
      .where(eq(tenantBranding.subdomainSlug, subdomainSlug));
    const row = rows[0] as BrandingRow | undefined;
    return row ? toDTO(row) : undefined;
  }

  /**
   * Create-or-update the single branding row for `tenantId`. Scoped by the
   * primary key (`tenant_id`), so this can only ever affect the calling
   * tenant's own row.
   */
  async upsert(
    tenantId: string,
    input: UpsertTenantBrandingInput,
  ): Promise<TenantBrandingDTO & { logoStorageKey: string | null }> {
    const rows = await this.db
      .insert(tenantBranding)
      .values({ tenantId, ...input })
      .onConflictDoUpdate({
        target: tenantBranding.tenantId,
        set: { ...input, updatedAt: new Date() },
      })
      .returning();
    const row = rows[0] as BrandingRow;
    return toDTO(row);
  }
}
