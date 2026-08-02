/**
 * Real-Postgres integration coverage for the `tenant.provisioned` observability
 * event (#310, Slice 1). Opt-in via `DATABASE_URL` (podman pgvector harness).
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { createDbClient } from "../../db/client.js";
import { provisionTenantForUser } from "../provisioning.js";
import type { ObservabilityLogger } from "../../observability/event-logger.js";

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("provisionTenantForUser observability (real Postgres)", () => {
  const { db, pool } = createDbClient();

  afterAll(async () => {
    await pool.end();
  });

  it("records a tenant.provisioned event carrying the new tenant id", async () => {
    const recordEvent = vi.fn();
    const logger: ObservabilityLogger = { recordEvent };

    const result = await provisionTenantForUser(
      db,
      { tenantName: "obs-tenant", userEmail: `obs-${Date.now()}-${Math.random()}@example.com` },
      logger,
    );

    expect(recordEvent).toHaveBeenCalledWith({
      tenantId: result.tenantId,
      actorUserId: result.userId,
      level: "info",
      event: "tenant.provisioned",
    });
  });

  it("provisions successfully without a logger (optional dependency)", async () => {
    const result = await provisionTenantForUser(db, {
      tenantName: "obs-tenant-2",
      userEmail: `obs2-${Date.now()}-${Math.random()}@example.com`,
    });
    expect(result.tenantId).toEqual(expect.any(String));
  });
});

describe.skipIf(hasDb)("provisionTenantForUser observability — skipped", () => {
  it("requires DATABASE_URL to run", () => {
    expect(hasDb).toBe(false);
  });
});
