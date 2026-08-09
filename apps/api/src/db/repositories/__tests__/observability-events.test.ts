import { describe, it, expect, vi } from "vitest";
import { ObservabilityEventsRepository } from "../observability-events.js";
import type { ObservabilityEventRecord } from "../../../observability/event-logger.js";
import type { ObservabilityLogQuery } from "../../../routes/admin-logs.js";

const TENANT_A = "aaaaaaaa-0000-0000-0000-000000000001";
const ACTOR_A = "aaaaaaaa-0000-0000-0000-000000000002";

/** A select().from().where().orderBy().limit() chain resolving to fixed rows. */
function selectChain(rows: unknown[]) {
  const limit = vi.fn().mockResolvedValue(rows);
  const orderBy = vi.fn().mockReturnValue({ limit });
  const where = vi.fn().mockReturnValue({ orderBy });
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });
  return { select, from, where, orderBy, limit };
}

function insertChain() {
  const values = vi.fn().mockResolvedValue(undefined);
  const insert = vi.fn().mockReturnValue({ values });
  return { insert, values };
}

function baseQuery(overrides: Partial<ObservabilityLogQuery> = {}): ObservabilityLogQuery {
  return { limit: 50, ...overrides };
}

function eventRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "event-1",
    tenantId: TENANT_A,
    actorUserId: ACTOR_A,
    level: "info" as const,
    event: "plan.generated",
    outcome: "processed",
    metadata: { planId: "plan-1" },
    createdAt: new Date("2026-07-01T10:00:00Z"),
    ...overrides,
  };
}

describe("ObservabilityEventsRepository", () => {
  describe("record", () => {
    it("inserts a row with exactly the given event fields", async () => {
      const { insert, values } = insertChain();
      const repo = new ObservabilityEventsRepository({ insert } as never);
      const event: ObservabilityEventRecord = {
        tenantId: TENANT_A,
        actorUserId: ACTOR_A,
        level: "error",
        event: "billing.webhook",
        outcome: "denied",
        metadata: { statusCode: 402 },
      };

      await repo.record(event);

      expect(insert).toHaveBeenCalledTimes(1);
      const insertedValues = (values as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<
        string,
        unknown
      >;
      expect(insertedValues).toEqual({
        tenantId: TENANT_A,
        actorUserId: ACTOR_A,
        level: "error",
        event: "billing.webhook",
        outcome: "denied",
        metadata: { statusCode: 402 },
      });
    });

    it("passes through null tenant/actor for a system-level event", async () => {
      const { insert, values } = insertChain();
      const repo = new ObservabilityEventsRepository({ insert } as never);

      await repo.record({
        tenantId: null,
        actorUserId: null,
        level: "info",
        event: "system.startup",
        outcome: null,
        metadata: {},
      });

      const insertedValues = (values as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<
        string,
        unknown
      >;
      expect(insertedValues.tenantId).toBeNull();
      expect(insertedValues.actorUserId).toBeNull();
    });
  });

  describe("queryEvents", () => {
    it("returns events mapped to the view shape and nextCursor null when there is no extra row", async () => {
      const row = eventRow();
      const { select, limit } = selectChain([row]);
      const repo = new ObservabilityEventsRepository({ select } as never);

      const result = await repo.queryEvents(baseQuery());

      expect(limit).toHaveBeenCalledWith(51);
      expect(result.events).toHaveLength(1);
      expect(result.events[0].id).toBe("event-1");
      expect(result.events[0].metadata).toEqual({ planId: "plan-1" });
      expect(result.nextCursor).toBeNull();
    });

    it("defaults a null metadata column to {} in the view", async () => {
      const row = eventRow({ metadata: null });
      const { select } = selectChain([row]);
      const repo = new ObservabilityEventsRepository({ select } as never);

      const result = await repo.queryEvents(baseQuery());

      expect(result.events[0].metadata).toEqual({});
    });

    it("clamps the requested limit to HARD_MAX_LIMIT (100) and fetches limit+1", async () => {
      const { select, limit } = selectChain([]);
      const repo = new ObservabilityEventsRepository({ select } as never);

      await repo.queryEvents(baseQuery({ limit: 500 }));

      expect(limit).toHaveBeenCalledWith(101);
    });

    it("clamps a non-positive limit up to 1", async () => {
      const { select, limit } = selectChain([]);
      const repo = new ObservabilityEventsRepository({ select } as never);

      await repo.queryEvents(baseQuery({ limit: 0 }));

      expect(limit).toHaveBeenCalledWith(2);
    });

    it("detects a next page (limit+1 rows fetched) and emits a decodable cursor for the last returned row", async () => {
      const older = eventRow({
        id: "event-older",
        createdAt: new Date("2026-06-30T09:00:00Z"),
      });
      const newer = eventRow({
        id: "event-newer",
        createdAt: new Date("2026-07-01T10:00:00Z"),
      });
      const extra = eventRow({
        id: "event-extra",
        createdAt: new Date("2026-06-29T08:00:00Z"),
      });
      // limit=2 → fetch 3; 3 rows come back so hasMore=true and the page is trimmed to 2.
      const { select } = selectChain([newer, older, extra]);
      const repo = new ObservabilityEventsRepository({ select } as never);

      const page1 = await repo.queryEvents(baseQuery({ limit: 2 }));

      expect(page1.events).toHaveLength(2);
      expect(page1.events.map((e) => e.id)).toEqual(["event-newer", "event-older"]);
      expect(page1.nextCursor).not.toBeNull();

      // Round-trip: feeding the emitted cursor back must decode to the last
      // returned row's (createdAt, id) so a follow-up page starts exactly there.
      const decodedRaw = Buffer.from(page1.nextCursor as string, "base64url").toString("utf8");
      const sep = decodedRaw.indexOf("|");
      const iso = decodedRaw.slice(0, sep);
      const id = decodedRaw.slice(sep + 1);
      expect(id).toBe("event-older");
      expect(new Date(iso).toISOString()).toBe(older.createdAt.toISOString());
    });

    it("returns nextCursor: null when exactly `limit` rows are returned (no extra row)", async () => {
      const row = eventRow();
      const { select } = selectChain([row]);
      const repo = new ObservabilityEventsRepository({ select } as never);

      const result = await repo.queryEvents(baseQuery({ limit: 1 }));

      expect(result.events).toHaveLength(1);
      expect(result.nextCursor).toBeNull();
    });

    it("feeding a previously emitted cursor back into the next call adds a keyset WHERE condition", async () => {
      // Page 1: 2 rows requested, 3 returned → hasMore, emits a cursor.
      const newer = eventRow({ id: "e1", createdAt: new Date("2026-07-01T10:00:00Z") });
      const older = eventRow({ id: "e2", createdAt: new Date("2026-06-30T09:00:00Z") });
      const extra = eventRow({ id: "e3", createdAt: new Date("2026-06-29T08:00:00Z") });
      const page1Chain = selectChain([newer, older, extra]);
      const repo1 = new ObservabilityEventsRepository({ select: page1Chain.select } as never);
      const page1 = await repo1.queryEvents(baseQuery({ limit: 2 }));
      expect(page1.nextCursor).not.toBeNull();

      // Page 2: pass the cursor back — the repo must decode it without throwing
      // and issue a `where` call (proving the keyset condition path executed).
      const page2Chain = selectChain([extra]);
      const repo2 = new ObservabilityEventsRepository({ select: page2Chain.select } as never);

      const page2 = await repo2.queryEvents(
        baseQuery({ limit: 2, cursor: page1.nextCursor as string }),
      );

      expect(page2Chain.where).toHaveBeenCalledTimes(1);
      expect(page2.events).toHaveLength(1);
      expect(page2.events[0].id).toBe("e3");
    });

    it("ignores a garbage/malformed cursor rather than throwing (decodeCursor returns null)", async () => {
      const row = eventRow();
      const { select, where } = selectChain([row]);
      const repo = new ObservabilityEventsRepository({ select } as never);

      const result = await repo.queryEvents(baseQuery({ cursor: "not-a-valid-cursor!!" }));

      // No keyset condition should be added for an undecodable cursor, but the
      // query must still execute successfully.
      expect(where).toHaveBeenCalledTimes(1);
      expect(result.events).toHaveLength(1);
    });

    it("ignores a well-formed base64url cursor missing the id half", async () => {
      // "2026-07-01T10:00:00.000Z" with no "|id" suffix — decodeCursor must
      // reject it (sep <= 0) rather than crash on `id.slice`.
      const badCursor = Buffer.from("2026-07-01T10:00:00.000Z", "utf8").toString("base64url");
      const row = eventRow();
      const { select } = selectChain([row]);
      const repo = new ObservabilityEventsRepository({ select } as never);

      const result = await repo.queryEvents(baseQuery({ cursor: badCursor }));

      expect(result.events).toHaveLength(1);
    });

    it("ignores a cursor whose date half does not parse", async () => {
      const badCursor = Buffer.from("not-a-date|event-1", "utf8").toString("base64url");
      const row = eventRow();
      const { select } = selectChain([row]);
      const repo = new ObservabilityEventsRepository({ select } as never);

      const result = await repo.queryEvents(baseQuery({ cursor: badCursor }));

      expect(result.events).toHaveLength(1);
    });
  });
});
