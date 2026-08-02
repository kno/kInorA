import { randomUUID } from "node:crypto";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import fastifyMultipart from "@fastify/multipart";
import type { LogoUploadResponseDTO, TenantBrandingDTO } from "@kinora/contracts";
import { requireAuth } from "../auth/plugin.js";
import { assertGymEntitled, ForbiddenGymAccess } from "../billing/gym-access.js";
import type { EntitlementReaderPort } from "../billing/entitlement.js";
import type { ObjectStoragePort } from "../storage/object-storage-port.js";

/**
 * Gym branding logo upload + serve routes (16a-v3-gym-white-label, Slice 2).
 *
 * `POST /branding/logo` is gated from the START by `requireAuth()` AND
 * `assertGymEntitled` (a non-gym tenant → flat 403, no storage write) — this
 * is a Slice 2 merge-safety requirement, NOT deferred to Slice 3, because an
 * ungated file-upload endpoint must never reach `main`. Slice 3's gym
 * branding CRUD routes reuse the SAME `assertGymEntitled` gate (no
 * re-implementation) and add the full palette CRUD + public read-by-slug
 * surface on top of this file.
 *
 * The route depends ONLY on the `ObjectStoragePort` boundary interface (never
 * the concrete `LocalStorageAdapter` or raw `fs`) and a local structural repo
 * port (never `db/repositories/*` directly) — both satisfy
 * `pnpm architecture`'s `routes-no-db-layer` rule and the design's storage
 * swappability goal.
 *
 * `GET /media/branding/:key` is UNAUTHENTICATED by design: the stored key is
 * an opaque, server-generated UUID (never guessable/enumerable) and logos
 * must be viewable pre-login (e.g. on the branded login page, Slice 4). SVG
 * responses are served with `Content-Disposition: attachment` so a browser
 * never renders an uploaded SVG inline as HTML/script context (stored-XSS
 * mitigation per design.md's threat matrix).
 */

/** Content-types accepted for a logo upload (design.md threat matrix allowlist). */
const ALLOWED_LOGO_TYPES = new Set<string>([
  "image/png",
  "image/jpeg",
  "image/svg+xml",
  "image/webp",
]);

/** Hard byte cap for a logo upload. */
const MAX_LOGO_BYTES = 5 * 1024 * 1024; // 5 MB

/**
 * Local structural port for the branding repository (see
 * `TenantBrandingRepository`, Slice 1) — the route never imports
 * `db/repositories/*` directly (architecture rule `routes-no-db-layer`).
 */
export interface BrandingRouteRepo {
  findByTenantId(
    tenantId: string,
  ): Promise<(TenantBrandingDTO & { logoStorageKey: string | null }) | undefined>;
  upsert(
    tenantId: string,
    input: {
      subdomainSlug: string;
      logoStorageKey: string | null;
      accent: string | null;
      accentFg: string | null;
      surface: string | null;
      surface2: string | null;
      fg: string | null;
      muted: string | null;
    },
  ): Promise<TenantBrandingDTO & { logoStorageKey: string | null }>;
}

export interface BrandingRoutesOptions {
  repo: BrandingRouteRepo;
  storage: ObjectStoragePort;
  entitlementReader: Pick<EntitlementReaderPort, "loadContext">;
}

export const brandingRoutes: FastifyPluginAsync<BrandingRoutesOptions> = async (
  fastify,
  options,
) => {
  const { repo, storage, entitlementReader } = options;

  // Multipart is registered in an ENCAPSULATED child scope (mirrors the
  // voice-transcribe route in plan.ts) so its content-type parser + byte cap
  // apply ONLY to this route.
  await fastify.register(async (scope) => {
    await scope.register(fastifyMultipart, {
      limits: { fileSize: MAX_LOGO_BYTES, files: 1 },
    });

    scope.post(
      "/branding/logo",
      { preHandler: requireAuth() },
      async (request: FastifyRequest, reply: FastifyReply) => {
        const { tenantId, userId } = request.authContext!;

        // Fail-closed BEFORE any multipart parsing / storage write.
        try {
          await assertGymEntitled({ tenantId, actorUserId: userId }, { entitlementReader });
        } catch (err) {
          if (err instanceof ForbiddenGymAccess) {
            return reply.code(403).send({ error: "forbidden" });
          }
          throw err;
        }

        let filePart: Awaited<ReturnType<typeof request.file>>;
        try {
          filePart = await request.file();
        } catch {
          return reply.code(400).send({ error: "invalid_logo_upload" });
        }
        if (!filePart) {
          return reply.code(400).send({ error: "missing_logo" });
        }

        const contentType = filePart.mimetype;
        if (!ALLOWED_LOGO_TYPES.has(contentType)) {
          // request.file() only reads the part HEADER — drain the stream
          // before replying so the connection closes cleanly (mirrors the
          // audio-upload route's same fix).
          filePart.file.resume();
          return reply.code(415).send({ error: "unsupported_logo_format" });
        }

        let bytes: Buffer;
        try {
          bytes = await filePart.toBuffer();
        } catch {
          return reply.code(413).send({ error: "logo_too_large" });
        }
        if (filePart.file.truncated || bytes.byteLength > MAX_LOGO_BYTES) {
          return reply.code(413).send({ error: "logo_too_large" });
        }
        if (bytes.byteLength === 0) {
          return reply.code(400).send({ error: "missing_logo" });
        }

        // Server-generated UUID key — never derived from caller input, so
        // the storage layer never has to trust a client-controlled path
        // segment (design.md threat matrix: "storage keys are server-
        // generated UUIDs, no path traversal").
        const key = randomUUID();
        const { url } = await storage.put(key, bytes, contentType);

        // Persist the new logo key onto the tenant's branding row when one
        // already exists (Slice 3's CRUD route creates the row, setting the
        // unique `subdomainSlug`, on first upsert). When no row exists yet,
        // the upload still succeeds (bytes stored, url returned) but the
        // branding-row write is deferred to Slice 3 — this route never
        // invents a placeholder slug, which would risk colliding with the
        // unique index Slice 3 relies on.
        const existing = await repo.findByTenantId(tenantId);
        if (existing) {
          await repo.upsert(tenantId, {
            subdomainSlug: existing.subdomainSlug,
            logoStorageKey: key,
            accent: existing.palette.accent,
            accentFg: existing.palette.accentFg,
            surface: existing.palette.surface,
            surface2: existing.palette.surface2,
            fg: existing.palette.fg,
            muted: existing.palette.muted,
          });
        }

        const response: LogoUploadResponseDTO = { logoUrl: url };
        return reply.code(200).send(response);
      },
    );
  });

  // GET /media/branding/:key — unauthenticated, read-only logo serving.
  fastify.get(
    "/media/branding/:key",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { key } = request.params as { key: string };
      const object = await storage.get(key);
      if (!object) {
        return reply.code(404).send({ error: "not_found" });
      }

      // Stored-XSS mitigation: an SVG is served as an attachment so a
      // browser navigating directly to the media URL never renders it
      // inline as HTML/script context.
      if (object.contentType === "image/svg+xml") {
        reply.header("Content-Disposition", "attachment");
      }

      return reply.code(200).type(object.contentType).send(object.bytes);
    },
  );
};
