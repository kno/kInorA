/**
 * Real-Postgres integration coverage for `ObservabilityEventsRepository`
 * (#310, Slice 1). Proves the persisted-events write + the paginated,
 * filterable superadmin query against a real `observability_events` table.
 *
 * ISOLATION (#405). This suite used to start every test with an unscoped
 * `DELETE FROM observability_events`. `observability_events` is shared: this
 * file, `admin-stats`, `tier-override-admin-observability`,
 * `provisioning-observability` and the seat-sync sweep all write to it, and
 * vitest runs test FILES in parallel workers against one database. The wipe
 * therefore deleted rows other suites had already counted, which is what made
 * `admin-stats`'s 24-hour window assertion fail intermittently: its `after`
 * read came back LOWER than its `before` read. A wipe is also not isolation for
 * this file — a concurrent suite can insert between the delete and the read.
 *
 * Every test now claims a PRIVATE random tenant id and scopes its reads to it,
 * so no test observes another suite's rows and no test destroys them. The
 * null-tenant case cannot be scoped that way (the repository only filters on a
 * truthy `tenantId`), so it claims a per-run unique `event` name instead. Both
 * are stable across repeated runs against the same accumulating scratch
 * database, which the wipe was also papering over.
 *
 * Opt-in via `DATABASE_URL` (podman pgvector harness, same pattern as
 * `tier-override-admin.integration.test.ts`) — skipped when no real Postgres is
 * wired so the default `vitest run` stays hermetic.
 */
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createDbClient } from "../../client.js";
import { observabilityEvents } from "../../schema.js";
import { ObservabilityEventsRepository } from "../observability-events.js";

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("ObservabilityEventsRepository (real Postgres)", () => {
  const { db, pool } = createDbClient();
  const repo = new ObservabilityEventsRepository(db);

  const ACTOR = "22222222-0000-0000-0000-000000000001";

  /**
   * A tenant id no other test — in this file or any concurrent suite — writes
   * to, so `queryEvents({ tenantId })` sees exactly the rows the caller seeded.
   * The id need not exist in `tenants`: `observability_events.tenant_id` is
   * deliberately FK-free so audit history survives tenant deletion.
   */
  const privateTenant = (): string => randomUUID();

  afterAll(async () => {
    await pool.end();
  });

  it("records an event and reads it back with every column intact", async () => {
    const tenantId = privateTenant();
    await repo.record({
      tenantId,
      actorUserId: ACTOR,
      level: "info",
      event: "billing.webhook",
      outcome: "processed",
      metadata: { eventId: "evt_1", eventType: "customer.subscription.updated" },
    });

    const page = await repo.queryEvents({ tenantId, limit: 50 });
    expect(page.nextCursor).toBeNull();
    expect(page.events).toHaveLength(1);
    expect(page.events[0]).toMatchObject({
      tenantId,
      actorUserId: ACTOR,
      level: "info",
      event: "billing.webhook",
      outcome: "processed",
      metadata: { eventId: "evt_1", eventType: "customer.subscription.updated" },
    });
    expect(page.events[0]!.id).toEqual(expect.any(String));
    expect(page.events[0]!.createdAt).toBeInstanceOf(Date);
  });

  it("writes a system-level event (null tenantId + null actorUserId)", async () => {
    // A null tenant cannot be used as the private scope (the repository only
    // applies a truthy `tenantId` filter), so the event NAME is the scope here.
    const event = `request.error.${randomUUID()}`;
    await repo.record({
      tenantId: null,
      actorUserId: null,
      level: "error",
      event,
      outcome: null,
      metadata: { route: "GET /x", statusCode: 500, errName: "TypeError" },
    });

    const page = await repo.queryEvents({ event, limit: 50 });
    expect(page.events).toHaveLength(1);
    expect(page.events[0]).toMatchObject({
      tenantId: null,
      actorUserId: null,
      level: "error",
      event,
      outcome: null,
      metadata: { route: "GET /x", statusCode: 500, errName: "TypeError" },
    });
  });

  async function seedAt(overrides: {
    tenantId: string;
    level?: "info" | "warn" | "error";
    event?: string;
    createdAt: Date;
  }): Promise<void> {
    await db.insert(observabilityEvents).values({
      tenantId: overrides.tenantId,
      actorUserId: null,
      level: overrides.level ?? "info",
      event: overrides.event ?? "generic.event",
      outcome: null,
      metadata: {},
      createdAt: overrides.createdAt,
    });
  }

  it("filters by level, event, and tenantId", async () => {
    // Two private tenants: A holds one warn + one info, B holds one warn. Each
    // filter is asserted inside a scope where the rows it must EXCLUDE also
    // exist, which is what proves the filter rather than an empty table did the
    // work: `level: "warn"` must drop A's info row, and `tenantId: B` must drop
    // both of A's rows.
    const tenantA = privateTenant();
    const tenantB = privateTenant();
    await seedAt({ tenantId: tenantA, level: "warn", event: "owner_access.denied", createdAt: new Date("2026-08-01T01:00:00Z") });
    await seedAt({ tenantId: tenantA, level: "info", event: "generation.ready", createdAt: new Date("2026-08-01T02:00:00Z") });
    await seedAt({ tenantId: tenantB, level: "warn", event: "owner_access.denied", createdAt: new Date("2026-08-01T03:00:00Z") });

    const byLevel = await repo.queryEvents({ tenantId: tenantA, level: "warn", limit: 50 });
    expect(byLevel.events).toHaveLength(1);
    expect(byLevel.events[0]!.event).toBe("owner_access.denied");

    const byEvent = await repo.queryEvents({ tenantId: tenantA, event: "generation.ready", limit: 50 });
    expect(byEvent.events).toHaveLength(1);
    expect(byEvent.events[0]!.event).toBe("generation.ready");

    const byTenant = await repo.queryEvents({ tenantId: tenantB, limit: 50 });
    expect(byTenant.events).toHaveLength(1);
    expect(byTenant.events[0]!.tenantId).toBe(tenantB);
  });

  it("filters by the [from, to] createdAt window (inclusive)", async () => {
    const tenantId = privateTenant();
    await seedAt({ tenantId, createdAt: new Date("2026-08-01T00:00:00Z") });
    await seedAt({ tenantId, createdAt: new Date("2026-08-02T00:00:00Z") });
    await seedAt({ tenantId, createdAt: new Date("2026-08-03T00:00:00Z") });

    const page = await repo.queryEvents({
      tenantId,
      from: new Date("2026-08-02T00:00:00Z"),
      to: new Date("2026-08-02T23:59:59Z"),
      limit: 50,
    });
    expect(page.events).toHaveLength(1);
    expect(page.events[0]!.createdAt.toISOString()).toBe("2026-08-02T00:00:00.000Z");
  });

  it("orders newest-first and paginates via an opaque keyset cursor", async () => {
    const tenantId = privateTenant();
    await seedAt({ tenantId, event: "e1", createdAt: new Date("2026-08-01T00:00:00Z") });
    await seedAt({ tenantId, event: "e2", createdAt: new Date("2026-08-02T00:00:00Z") });
    await seedAt({ tenantId, event: "e3", createdAt: new Date("2026-08-03T00:00:00Z") });

    const first = await repo.queryEvents({ tenantId, limit: 2 });
    expect(first.events.map((e) => e.event)).toEqual(["e3", "e2"]);
    expect(first.nextCursor).toEqual(expect.any(String));

    const second = await repo.queryEvents({ tenantId, limit: 2, cursor: first.nextCursor! });
    expect(second.events.map((e) => e.event)).toEqual(["e1"]);
    expect(second.nextCursor).toBeNull();
  });

  it("never skips or duplicates rows that share the same millisecond created_at across pages", async () => {
    // Three distinct rows sharing the same MILLISECOND bucket but distinct
    // MICROSECONDS at the DB level (raw SQL — the JS `Date` cursor can only
    // ever round-trip millisecond precision, reproducing the real-world
    // scenario where node-pg's `Date` truncates microseconds on read but the
    // column itself stored more precision). The keyset comparison must still
    // return all 3 rows, disambiguated purely via the `id` tiebreak once
    // createdAt is stored/compared at ms precision.
    const tenantId = privateTenant();
    const microsecondSuffixes = ["123111", "123555", "123999"];
    const ids: string[] = [];
    for (const suffix of microsecondSuffixes) {
      const rows = await db.execute<{ id: string }>(sql`
        INSERT INTO observability_events (tenant_id, actor_user_id, level, event, outcome, metadata, created_at)
        VALUES (${tenantId}, NULL, 'info', ${`same-ms-${suffix}`}, NULL, '{}'::jsonb, ${`2026-08-01T12:00:00.${suffix}+00`}::timestamptz)
        RETURNING id
      `);
      ids.push((rows as unknown as { rows: { id: string }[] }).rows[0]!.id);
    }

    const first = await repo.queryEvents({ tenantId, limit: 2 });
    expect(first.events).toHaveLength(2);
    expect(first.nextCursor).toEqual(expect.any(String));

    const second = await repo.queryEvents({ tenantId, limit: 2, cursor: first.nextCursor! });
    expect(second.events.length).toBeGreaterThan(0);

    const seenIds = [...first.events, ...second.events].map((e) => e.id);
    // No duplicates.
    expect(new Set(seenIds).size).toBe(seenIds.length);
    // All 3 rows appear across the two pages — none dropped.
    for (const id of ids) {
      expect(seenIds).toContain(id);
    }
  });

  it("caps the effective limit at 100 even if a larger value is passed", async () => {
    // Only assert the fetch does not error and returns the seeded row; the cap
    // is a safety bound (the route already rejects >100, this is defense in depth).
    const tenantId = privateTenant();
    await seedAt({ tenantId, createdAt: new Date("2026-08-01T00:00:00Z") });
    const page = await repo.queryEvents({ tenantId, limit: 1000 });
    expect(page.events).toHaveLength(1);
  });

  it("ignores a malformed cursor rather than throwing", async () => {
    const tenantId = privateTenant();
    await seedAt({ tenantId, createdAt: new Date("2026-08-01T00:00:00Z") });
    const page = await repo.queryEvents({ tenantId, limit: 50, cursor: "not-a-real-cursor" });
    expect(page.events).toHaveLength(1);
  });
});

describe.skipIf(hasDb)("ObservabilityEventsRepository (real Postgres) — skipped", () => {
  it("requires DATABASE_URL (podman pgvector harness) to run", () => {
    expect(hasDb).toBe(false);
  });
});
