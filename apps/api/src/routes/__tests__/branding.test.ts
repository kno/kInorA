import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { authPlugin } from "../../auth/plugin.js";
import { brandingRoutes, type BrandingRouteRepo } from "../branding.js";
import type { ObjectStoragePort } from "../../storage/object-storage-port.js";
import type { Database } from "../../db/client.js";
import {
  VALID_TOKEN,
  createAuthMockDb,
  buildSessionRow,
  buildActiveMembershipRow,
} from "../../test-support/auth-mocks.js";

/**
 * `POST /branding/logo` + `GET /media/branding/:key` route tests
 * (16a-v3-gym-white-label, Slice 2, tasks 2.5-2.11). Gating is pulled forward
 * from Phase 3 (S3) per the merge-safety requirement: the upload route MUST
 * never ship ungated to main (see `billing/gym-access.ts`).
 */

const TENANT_ID = "bbbbbbbb-0000-0000-0000-000000000001";
const OTHER_TENANT_ID = "bbbbbbbb-0000-0000-0000-000000000002";
const USER_ID = "aaaaaaaa-0000-0000-0000-000000000001";

function entitlementReader(tier: "free" | "pro" | "trainer" | "gym") {
  return {
    loadContext: vi.fn().mockResolvedValue({
      membershipStatus: "active",
      billing: { tier, status: "active", source: "system", trialStartedAt: null, trialEndsAt: null },
      activeOverrideTier: null,
    }),
  };
}

function fakeStorage(): ObjectStoragePort & {
  put: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
} {
  const store = new Map<string, { bytes: Buffer; contentType: string }>();
  return {
    put: vi.fn(async (key: string, bytes: Buffer, contentType: string) => {
      store.set(key, { bytes, contentType });
      return { url: `/media/branding/${key}` };
    }),
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
  };
}

function fakeRepo(
  overrides: Partial<BrandingRouteRepo> = {},
): BrandingRouteRepo & { findByTenantId: ReturnType<typeof vi.fn>; upsert: ReturnType<typeof vi.fn> } {
  return {
    findByTenantId: vi.fn().mockResolvedValue(undefined),
    upsert: vi.fn().mockImplementation(async (tenantId: string, input: Record<string, unknown>) => ({
      tenantId,
      subdomainSlug: input.subdomainSlug ?? "gym-slug",
      logoUrl: null,
      logoStorageKey: input.logoStorageKey ?? null,
      palette: {
        accent: input.accent ?? null,
        accentFg: input.accentFg ?? null,
        surface: input.surface ?? null,
        surface2: input.surface2 ?? null,
        fg: input.fg ?? null,
        muted: input.muted ?? null,
      },
    })),
    ...overrides,
  } as BrandingRouteRepo & { findByTenantId: ReturnType<typeof vi.fn>; upsert: ReturnType<typeof vi.fn> };
}

function buildSessionDb(tenantId = TENANT_ID, userId = USER_ID): Database {
  return createAuthMockDb({
    sessionRows: [buildSessionRow({ tenantId, userId })],
    membershipRows: [buildActiveMembershipRow({ tenantId, userId, role: "owner" })],
  }).db;
}

async function buildTestApp(opts: {
  db: Database;
  repo: BrandingRouteRepo;
  storage: ObjectStoragePort;
  entitlementReader: ReturnType<typeof entitlementReader>;
}): Promise<FastifyInstance> {
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => {
    if (error.validation) {
      return reply.code(400).send({ error: "Bad Request" });
    }
    return reply.code(500).send({ error: "Internal Server Error" });
  });
  await app.register(authPlugin, { db: opts.db });
  await app.register(brandingRoutes, {
    repo: opts.repo,
    storage: opts.storage,
    entitlementReader: opts.entitlementReader,
  });
  return app;
}

// --- multipart body helper (mirrors plan-transcribe.test.ts) ---------------

interface MultipartPart {
  field: string;
  filename?: string;
  contentType?: string;
  data: Buffer | string;
}

function multipartPayload(parts: MultipartPart[]): { body: Buffer; headers: Record<string, string> } {
  const boundary = `----kinoraTestBoundary${Math.random().toString(16).slice(2)}`;
  const chunks: Buffer[] = [];
  for (const p of parts) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    let disposition = `Content-Disposition: form-data; name="${p.field}"`;
    if (p.filename !== undefined) disposition += `; filename="${p.filename}"`;
    chunks.push(Buffer.from(`${disposition}\r\n`));
    if (p.contentType) chunks.push(Buffer.from(`Content-Type: ${p.contentType}\r\n`));
    chunks.push(Buffer.from("\r\n"));
    chunks.push(Buffer.isBuffer(p.data) ? p.data : Buffer.from(p.data));
    chunks.push(Buffer.from("\r\n"));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    body: Buffer.concat(chunks),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  };
}

function logoPart(opts: {
  data?: Buffer | string;
  filename?: string;
  contentType?: string;
} = {}): MultipartPart {
  return {
    field: "logo",
    filename: opts.filename ?? "logo.png",
    contentType: opts.contentType ?? "image/png",
    data: opts.data ?? "fake-png-bytes",
  };
}

describe("POST /branding/logo", () => {
  let app: FastifyInstance | undefined;

  beforeEach(() => vi.clearAllMocks());
  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it("returns 401 when unauthenticated, no storage write (task 2.8)", async () => {
    const storage = fakeStorage();
    app = await buildTestApp({
      db: { select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) }) } as unknown as Database,
      repo: fakeRepo(),
      storage,
      entitlementReader: entitlementReader("gym"),
    });

    const mp = multipartPayload([logoPart()]);
    const res = await app.inject({
      method: "POST",
      url: "/branding/logo",
      headers: mp.headers,
      payload: mp.body,
    });

    expect(res.statusCode).toBe(401);
    expect(storage.put).not.toHaveBeenCalled();
  });

  it("returns 403 for a non-gym tenant, no storage write (task 2.5/3.3 merge-safety gating)", async () => {
    const storage = fakeStorage();
    app = await buildTestApp({
      db: buildSessionDb(),
      repo: fakeRepo(),
      storage,
      entitlementReader: entitlementReader("pro"),
    });

    const mp = multipartPayload([logoPart()]);
    const res = await app.inject({
      method: "POST",
      url: "/branding/logo",
      headers: { authorization: `Bearer ${VALID_TOKEN}`, ...mp.headers },
      payload: mp.body,
    });

    expect(res.statusCode).toBe(403);
    expect(storage.put).not.toHaveBeenCalled();
  });

  it("rejects a disallowed content-type with a 4xx, no storage write (task 2.5)", async () => {
    const storage = fakeStorage();
    app = await buildTestApp({
      db: buildSessionDb(),
      repo: fakeRepo(),
      storage,
      entitlementReader: entitlementReader("gym"),
    });

    const mp = multipartPayload([
      logoPart({ filename: "malware.exe", contentType: "application/x-msdownload" }),
    ]);
    const res = await app.inject({
      method: "POST",
      url: "/branding/logo",
      headers: { authorization: `Bearer ${VALID_TOKEN}`, ...mp.headers },
      payload: mp.body,
    });

    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
    expect(storage.put).not.toHaveBeenCalled();
  });

  it("rejects a file exceeding the size cap with a 4xx, no storage write (task 2.6)", async () => {
    const storage = fakeStorage();
    app = await buildTestApp({
      db: buildSessionDb(),
      repo: fakeRepo(),
      storage,
      entitlementReader: entitlementReader("gym"),
    });

    const oversized = Buffer.alloc(6 * 1024 * 1024, 1); // 6 MB, over the 5 MB cap
    const mp = multipartPayload([logoPart({ data: oversized })]);
    const res = await app.inject({
      method: "POST",
      url: "/branding/logo",
      headers: { authorization: `Bearer ${VALID_TOKEN}`, ...mp.headers },
      payload: mp.body,
    });

    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
    expect(storage.put).not.toHaveBeenCalled();
  });

  it("accepts a valid png under the cap for a gym tenant, persists via the port, response includes the logo url (task 2.7)", async () => {
    const storage = fakeStorage();
    const repo = fakeRepo();
    app = await buildTestApp({
      db: buildSessionDb(),
      repo,
      storage,
      entitlementReader: entitlementReader("gym"),
    });

    const mp = multipartPayload([logoPart()]);
    const res = await app.inject({
      method: "POST",
      url: "/branding/logo",
      headers: { authorization: `Bearer ${VALID_TOKEN}`, ...mp.headers },
      payload: mp.body,
    });

    expect(res.statusCode).toBe(200);
    expect(storage.put).toHaveBeenCalledTimes(1);
    const body = res.json() as { logoUrl: string };
    expect(body.logoUrl).toMatch(/^\/media\/branding\//);
  });

  it("persists the new logo key onto an existing branding row via repo.upsert", async () => {
    const storage = fakeStorage();
    const repo = fakeRepo({
      findByTenantId: vi.fn().mockResolvedValue({
        tenantId: TENANT_ID,
        subdomainSlug: "existing-gym",
        logoUrl: null,
        logoStorageKey: "old-key",
        palette: { accent: "#111111", accentFg: null, surface: null, surface2: null, fg: null, muted: null },
      }),
      upsert: vi.fn().mockImplementation(async (tenantId: string, input: Record<string, unknown>) => ({
        tenantId,
        ...input,
      })),
    });
    app = await buildTestApp({
      db: buildSessionDb(),
      repo,
      storage,
      entitlementReader: entitlementReader("gym"),
    });

    const mp = multipartPayload([logoPart()]);
    await app.inject({
      method: "POST",
      url: "/branding/logo",
      headers: { authorization: `Bearer ${VALID_TOKEN}`, ...mp.headers },
      payload: mp.body,
    });

    expect(repo.upsert).toHaveBeenCalledTimes(1);
    const [tenantIdArg, inputArg] = repo.upsert.mock.calls[0];
    expect(tenantIdArg).toBe(TENANT_ID);
    expect(inputArg.subdomainSlug).toBe("existing-gym");
    expect(inputArg.accent).toBe("#111111");
    expect(typeof inputArg.logoStorageKey).toBe("string");
    expect(inputArg.logoStorageKey).not.toBe("old-key");
  });

  it("does not call repo.upsert when no branding row exists yet (row creation deferred to Slice 3)", async () => {
    const storage = fakeStorage();
    const repo = fakeRepo(); // findByTenantId resolves undefined by default
    app = await buildTestApp({
      db: buildSessionDb(),
      repo,
      storage,
      entitlementReader: entitlementReader("gym"),
    });

    const mp = multipartPayload([logoPart()]);
    const res = await app.inject({
      method: "POST",
      url: "/branding/logo",
      headers: { authorization: `Bearer ${VALID_TOKEN}`, ...mp.headers },
      payload: mp.body,
    });

    expect(res.statusCode).toBe(200);
    expect(repo.upsert).not.toHaveBeenCalled();
  });
});

describe("GET /media/branding/:key", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it("streams bytes + stored content-type for an existing key (task 2.9)", async () => {
    const storage = fakeStorage();
    await storage.put("known-key", Buffer.from("logo-bytes"), "image/png");
    app = await buildTestApp({
      db: buildSessionDb(),
      repo: fakeRepo(),
      storage,
      entitlementReader: entitlementReader("gym"),
    });

    const res = await app.inject({ method: "GET", url: "/media/branding/known-key" });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("image/png");
    expect(res.rawPayload.equals(Buffer.from("logo-bytes"))).toBe(true);
  });

  it("returns 404 for an unknown key (task 2.9)", async () => {
    const storage = fakeStorage();
    app = await buildTestApp({
      db: buildSessionDb(),
      repo: fakeRepo(),
      storage,
      entitlementReader: entitlementReader("gym"),
    });

    const res = await app.inject({ method: "GET", url: "/media/branding/unknown-key" });

    expect(res.statusCode).toBe(404);
  });

  it("sets Content-Disposition: attachment for an SVG (stored-XSS mitigation, task 2.10)", async () => {
    const storage = fakeStorage();
    await storage.put("svg-key", Buffer.from("<svg><script>alert(1)</script></svg>"), "image/svg+xml");
    app = await buildTestApp({
      db: buildSessionDb(),
      repo: fakeRepo(),
      storage,
      entitlementReader: entitlementReader("gym"),
    });

    const res = await app.inject({ method: "GET", url: "/media/branding/svg-key" });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-disposition"]).toMatch(/attachment/);
  });

  it("does not set Content-Disposition: attachment for a non-SVG type", async () => {
    const storage = fakeStorage();
    await storage.put("png-key", Buffer.from("png-bytes"), "image/png");
    app = await buildTestApp({
      db: buildSessionDb(),
      repo: fakeRepo(),
      storage,
      entitlementReader: entitlementReader("gym"),
    });

    const res = await app.inject({ method: "GET", url: "/media/branding/png-key" });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-disposition"]).toBeUndefined();
  });
});

// --- Gym branding CRUD (16a-v3-gym-white-label, Slice 3) --------------------

const VALID_PALETTE = {
  accent: "#112233",
  accentFg: "#ffffff",
  surface: "#000000",
  surface2: "#111111",
  fg: "#eeeeee",
  muted: "#999999",
};

describe("GET /branding (own-tenant, gym-gated)", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it("returns 401 when unauthenticated", async () => {
    app = await buildTestApp({
      db: { select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) }) } as unknown as Database,
      repo: fakeRepo(),
      storage: fakeStorage(),
      entitlementReader: entitlementReader("gym"),
    });

    const res = await app.inject({ method: "GET", url: "/branding" });

    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for a non-gym tenant, no repo call", async () => {
    const repo = fakeRepo();
    app = await buildTestApp({
      db: buildSessionDb(),
      repo,
      storage: fakeStorage(),
      entitlementReader: entitlementReader("pro"),
    });

    const res = await app.inject({
      method: "GET",
      url: "/branding",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(res.statusCode).toBe(403);
    expect(repo.findByTenantId).not.toHaveBeenCalled();
  });

  it("returns 404 when the tenant has no branding row yet", async () => {
    app = await buildTestApp({
      db: buildSessionDb(),
      repo: fakeRepo(),
      storage: fakeStorage(),
      entitlementReader: entitlementReader("gym"),
    });

    const res = await app.inject({
      method: "GET",
      url: "/branding",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(res.statusCode).toBe(404);
  });

  it("returns only the caller's own tenant branding, scoped by authContext.tenantId", async () => {
    const repo = fakeRepo({
      findByTenantId: vi.fn(async (tenantId: string) =>
        tenantId === TENANT_ID
          ? {
              tenantId: TENANT_ID,
              subdomainSlug: "gym-a",
              logoUrl: null,
              logoStorageKey: "logo-key-a",
              palette: VALID_PALETTE,
            }
          : undefined,
      ),
    });
    app = await buildTestApp({
      db: buildSessionDb(),
      repo,
      storage: fakeStorage(),
      entitlementReader: entitlementReader("gym"),
    });

    const res = await app.inject({
      method: "GET",
      url: "/branding",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(res.statusCode).toBe(200);
    expect(repo.findByTenantId).toHaveBeenCalledWith(TENANT_ID);
    const body = res.json() as { tenantId: string; subdomainSlug: string; logoUrl: string | null };
    expect(body.tenantId).toBe(TENANT_ID);
    expect(body.subdomainSlug).toBe("gym-a");
    expect(body.logoUrl).toBe("/media/branding/logo-key-a");
  });

  it("gym A member requesting branding never sees gym B's row (tenant isolation, task 3.7)", async () => {
    const repo = fakeRepo({
      findByTenantId: vi.fn(async (tenantId: string) =>
        tenantId === OTHER_TENANT_ID
          ? {
              tenantId: OTHER_TENANT_ID,
              subdomainSlug: "gym-b",
              logoUrl: null,
              logoStorageKey: null,
              palette: VALID_PALETTE,
            }
          : undefined,
      ),
    });
    app = await buildTestApp({
      db: buildSessionDb(TENANT_ID, USER_ID),
      repo,
      storage: fakeStorage(),
      entitlementReader: entitlementReader("gym"),
    });

    const res = await app.inject({
      method: "GET",
      url: "/branding",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    // The session is scoped to TENANT_ID; only OTHER_TENANT_ID has a row.
    // A gym A member must never see gym B's branding.
    expect(res.statusCode).toBe(404);
    expect(repo.findByTenantId).toHaveBeenCalledWith(TENANT_ID);
  });
});

describe("PUT /branding (own-tenant, gym-gated)", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it("returns 401 when unauthenticated, no write", async () => {
    const repo = fakeRepo();
    app = await buildTestApp({
      db: { select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) }) } as unknown as Database,
      repo,
      storage: fakeStorage(),
      entitlementReader: entitlementReader("gym"),
    });

    const res = await app.inject({
      method: "PUT",
      url: "/branding",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ subdomainSlug: "gym-a", palette: VALID_PALETTE }),
    });

    expect(res.statusCode).toBe(401);
    expect(repo.upsert).not.toHaveBeenCalled();
  });

  it("returns 403 for a non-gym tenant, no write (task 3.3)", async () => {
    const repo = fakeRepo();
    app = await buildTestApp({
      db: buildSessionDb(),
      repo,
      storage: fakeStorage(),
      entitlementReader: entitlementReader("pro"),
    });

    const res = await app.inject({
      method: "PUT",
      url: "/branding",
      headers: { authorization: `Bearer ${VALID_TOKEN}`, "content-type": "application/json" },
      payload: JSON.stringify({ subdomainSlug: "gym-a", palette: VALID_PALETTE }),
    });

    expect(res.statusCode).toBe(403);
    expect(repo.upsert).not.toHaveBeenCalled();
  });

  it("gym-tier owner submits a full valid palette + slug; row created/updated, response echoes new values (task 3.4)", async () => {
    const repo = fakeRepo();
    app = await buildTestApp({
      db: buildSessionDb(),
      repo,
      storage: fakeStorage(),
      entitlementReader: entitlementReader("gym"),
    });

    const res = await app.inject({
      method: "PUT",
      url: "/branding",
      headers: { authorization: `Bearer ${VALID_TOKEN}`, "content-type": "application/json" },
      payload: JSON.stringify({ subdomainSlug: "gym-a", palette: VALID_PALETTE }),
    });

    expect(res.statusCode).toBe(200);
    expect(repo.upsert).toHaveBeenCalledWith(
      TENANT_ID,
      expect.objectContaining({ subdomainSlug: "gym-a", accent: VALID_PALETTE.accent }),
    );
    const body = res.json() as { subdomainSlug: string; palette: typeof VALID_PALETTE };
    expect(body.subdomainSlug).toBe("gym-a");
    expect(body.palette.accent).toBe(VALID_PALETTE.accent);
  });

  it("rejects a palette field not matching the hex pattern with HTTP 400, no persistence (task 3.5)", async () => {
    const repo = fakeRepo();
    app = await buildTestApp({
      db: buildSessionDb(),
      repo,
      storage: fakeStorage(),
      entitlementReader: entitlementReader("gym"),
    });

    const res = await app.inject({
      method: "PUT",
      url: "/branding",
      headers: { authorization: `Bearer ${VALID_TOKEN}`, "content-type": "application/json" },
      payload: JSON.stringify({
        subdomainSlug: "gym-a",
        palette: { ...VALID_PALETTE, accent: "not-a-hex-color" },
      }),
    });

    expect(res.statusCode).toBe(400);
    expect(repo.upsert).not.toHaveBeenCalled();
  });

  it("rejects a missing/malformed subdomainSlug with a 4xx, no persistence", async () => {
    const repo = fakeRepo();
    app = await buildTestApp({
      db: buildSessionDb(),
      repo,
      storage: fakeStorage(),
      entitlementReader: entitlementReader("gym"),
    });

    const res = await app.inject({
      method: "PUT",
      url: "/branding",
      headers: { authorization: `Bearer ${VALID_TOKEN}`, "content-type": "application/json" },
      payload: JSON.stringify({ subdomainSlug: "", palette: VALID_PALETTE }),
    });

    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
    expect(repo.upsert).not.toHaveBeenCalled();
  });

  it("gym A owner attempting to write branding can only ever affect gym A's own row (tenant isolation, task 3.6)", async () => {
    const repo = fakeRepo();
    app = await buildTestApp({
      db: buildSessionDb(TENANT_ID, USER_ID), // session bound to TENANT_ID (gym A)
      repo,
      storage: fakeStorage(),
      entitlementReader: entitlementReader("gym"),
    });

    await app.inject({
      method: "PUT",
      url: "/branding",
      headers: { authorization: `Bearer ${VALID_TOKEN}`, "content-type": "application/json" },
      payload: JSON.stringify({ subdomainSlug: "gym-a", palette: VALID_PALETTE }),
    });

    // The route reads tenantId ONLY from the session's authContext; there is
    // no body/param field that could target OTHER_TENANT_ID (gym B) instead.
    expect(repo.upsert).toHaveBeenCalledWith(TENANT_ID, expect.anything());
    expect(repo.upsert).not.toHaveBeenCalledWith(OTHER_TENANT_ID, expect.anything());
  });

  it("returns a clean 409 (not 500) when the subdomainSlug is already taken by another tenant", async () => {
    const repo = fakeRepo({
      upsert: vi.fn().mockRejectedValue(
        Object.assign(new Error("tenant_branding_slug_conflict"), {
          name: "TenantBrandingSlugConflictError",
        }),
      ),
    });
    app = await buildTestApp({
      db: buildSessionDb(),
      repo,
      storage: fakeStorage(),
      entitlementReader: entitlementReader("gym"),
    });

    const res = await app.inject({
      method: "PUT",
      url: "/branding",
      headers: { authorization: `Bearer ${VALID_TOKEN}`, "content-type": "application/json" },
      payload: JSON.stringify({ subdomainSlug: "already-taken", palette: VALID_PALETTE }),
    });

    expect(res.statusCode).toBe(409);
  });
});
