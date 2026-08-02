import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import type { PublicBrandingDTO, TenantBrandingDTO } from "@kinora/contracts";

/**
 * PUBLIC, unauthenticated gym branding read-by-slug
 * (16a-v3-gym-white-label, Slice 3, tasks 3.9-3.11).
 *
 * `GET /public/branding/by-slug/:slug` is registered OUTSIDE any auth
 * preHandler — it is the ONE deliberately unauthenticated read in this
 * change, consumed pre-login by the Slice 4 login page (`headers().host` →
 * slug → this endpoint). The threat matrix (design.md) requires:
 *
 *   1. Read-only, tenant-scoped by the slug lookup ONLY — the host header is
 *      never trusted for authz, and this route has no write path at all.
 *   2. The response contains ONLY `logoUrl` + `palette` (`PublicBrandingDTO`)
 *      — never `tenantId`, `subdomainSlug`, or any other tenant/user data,
 *      so a caller who already knows one slug can never enumerate or infer
 *      another tenant's identifiers from this response shape.
 *   3. An unknown slug resolves to a clean 404 (not a 500, not an error
 *      page) — the Slice 4 login page falls back to default branding on a
 *      404 exactly as it does on any other failure.
 *
 * Deliberately a SEPARATE file from `routes/branding.ts` (the gated CRUD +
 * upload/serve routes) so this "no auth" surface is reviewable in isolation.
 */

/**
 * Local structural port for the branding repository's public slug lookup —
 * the route never imports `db/repositories/*` directly (architecture rule
 * `routes-no-db-layer`). The concrete `TenantBrandingRepository` (Slice 1)
 * satisfies this structurally.
 */
export interface PublicBrandingRouteRepo {
  findBySubdomainSlug(
    subdomainSlug: string,
  ): Promise<(TenantBrandingDTO & { logoStorageKey: string | null }) | undefined>;
}

export interface PublicBrandingRoutesOptions {
  repo: PublicBrandingRouteRepo;
}

/**
 * Mirrors `LocalStorageAdapter.put`'s `{ url: "/media/branding/<key>" }`
 * convention (see `routes/branding.ts`) — the repository only persists the
 * raw `logoStorageKey`, so the servable URL is reconstructed here the same
 * way the authenticated CRUD read does.
 */
function logoStorageKeyToUrl(logoStorageKey: string | null): string | null {
  return logoStorageKey ? `/media/branding/${logoStorageKey}` : null;
}

export const publicBrandingRoutes: FastifyPluginAsync<PublicBrandingRoutesOptions> = async (
  fastify,
  options,
) => {
  const { repo } = options;

  fastify.get(
    "/public/branding/by-slug/:slug",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { slug } = request.params as { slug: string };

      const existing = await repo.findBySubdomainSlug(slug);
      if (!existing) {
        return reply.code(404).send({ error: "not_found" });
      }

      // ONLY `logoUrl` + `palette` ever leave this route — no tenantId, no
      // subdomainSlug, no PII (design.md threat matrix + spec.md "Public
      // read never leaks cross-tenant data or PII").
      const response: PublicBrandingDTO = {
        logoUrl: logoStorageKeyToUrl(existing.logoStorageKey),
        palette: existing.palette,
      };
      return reply.code(200).send(response);
    },
  );
};
