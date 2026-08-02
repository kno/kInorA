import { describe, it, expect, vi, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { authPlugin } from "../../auth/plugin.js";
import { adminLogsRoutes, type AdminLogsRouteRepo } from "../admin-logs.js";
import {
  VALID_TOKEN,
  createAuthMockDb,
  buildSessionRow,
  buildActiveMembershipRow,
} from "../../test-support/auth-mocks.js";

const USER_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const TENANT_ID = "bbbbbbbb-0000-0000-0000-000000000001";

const SESSION_ROW = buildSessionRow({
  tokenHash: "hash-of-token",
  tenantId: TENANT_ID,
  userId: USER_ID,
});
const ADMIN_USER_ROW = { id: USER_ID, email: "admin@test.com", isAdmin: true };
const NONADMIN_USER_ROW = { id: USER_ID, email: "user@test.com", isAdmin: false };
const ACTIVE_MEMBERSHIP_ROW = buildActiveMembershipRow({ tenantId: TENANT_ID, userId: USER_ID });

const SAMPLE_EVENT = {
  id: "cccccccc-0000-0000-0000-000000000001",
  tenantId: TENANT_ID,
  actorUserId: USER_ID,
  level: "info" as const,
  event: "billing.webhook",
  outcome: "processed",
  metadata: { eventId: "evt_1", eventType: "customer.subscription.updated" },
  createdAt: new Date("2026-08-02T12:00:00.000Z"),
};

function buildRepo(
  userRow: typeof ADMIN_USER_ROW | typeof NONADMIN_USER_ROW | null,
  overrides: Partial<AdminLogsRouteRepo> = {},
): AdminLogsRouteRepo {
  return {
    findUserById: vi.fn().mockResolvedValue(userRow),
    queryEvents: vi.fn().mockResolvedValue({ events: [SAMPLE_EVENT], nextCursor: null }),
    ...overrides,
  };
}

async function buildTestApp(repo: AdminLogsRouteRepo): Promise<FastifyInstance> {
  const db = createAuthMockDb({
    sessionRows: [SESSION_ROW],
    membershipRows: [ACTIVE_MEMBERSHIP_ROW],
  }).db as never;

  const app = Fastify();
  app.setErrorHandler((error: unknown, _req, reply) => {
    if (
      typeof error === "object" &&
      error !== null &&
      "validation" in error &&
      Boolean((error as { validation: unknown }).validation)
    ) {
      return reply.code(422).send({ error: "Validation Error" });
    }
    return reply.code(500).send({ error: "Internal Server Error" });
  });

  await app.register(authPlugin, { db });
  await app.register(adminLogsRoutes, { repo });
  return app;
}

describe("GET /admin/logs", () => {
  let app: FastifyInstance;
  afterEach(async () => {
    await app?.close();
  });

  it("returns 403 for a non-admin", async () => {
    app = await buildTestApp(buildRepo(NONADMIN_USER_ROW));
    const res = await app.inject({
      method: "GET",
      url: `/admin/logs`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns 200 with an events page and ISO-serialized createdAt for an admin", async () => {
    app = await buildTestApp(buildRepo(ADMIN_USER_ROW));
    const res = await app.inject({
      method: "GET",
      url: `/admin/logs`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      events: { id: string; event: string; createdAt: string; metadata: Record<string, unknown> }[];
      nextCursor: string | null;
    };
    expect(body.nextCursor).toBeNull();
    expect(body.events).toHaveLength(1);
    expect(body.events[0]!.event).toBe("billing.webhook");
    expect(body.events[0]!.createdAt).toBe("2026-08-02T12:00:00.000Z");
    expect(body.events[0]!.metadata).toEqual({
      eventId: "evt_1",
      eventType: "customer.subscription.updated",
    });
  });

  it("passes validated filters (level/event/limit) through to the repository", async () => {
    const repo = buildRepo(ADMIN_USER_ROW);
    app = await buildTestApp(repo);
    const res = await app.inject({
      method: "GET",
      url: `/admin/logs?level=warn&event=owner_access.denied&limit=10`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    expect(repo.queryEvents).toHaveBeenCalledWith(
      expect.objectContaining({ level: "warn", event: "owner_access.denied", limit: 10 }),
    );
  });

  it("returns 422 for an out-of-enum level without touching the repository", async () => {
    const repo = buildRepo(ADMIN_USER_ROW);
    app = await buildTestApp(repo);
    const res = await app.inject({
      method: "GET",
      url: `/admin/logs?level=debug`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });
    expect(res.statusCode).toBe(422);
    expect(repo.queryEvents).not.toHaveBeenCalled();
  });

  it("returns 422 for an out-of-range limit", async () => {
    app = await buildTestApp(buildRepo(ADMIN_USER_ROW));
    const res = await app.inject({
      method: "GET",
      url: `/admin/logs?limit=500`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });
    expect(res.statusCode).toBe(422);
  });

  it("surfaces the repository's nextCursor for pagination", async () => {
    const repo = buildRepo(ADMIN_USER_ROW, {
      queryEvents: vi.fn().mockResolvedValue({ events: [SAMPLE_EVENT], nextCursor: "next-page" }),
    });
    app = await buildTestApp(repo);
    const res = await app.inject({
      method: "GET",
      url: `/admin/logs?limit=1`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { nextCursor: string | null }).nextCursor).toBe("next-page");
  });
});
