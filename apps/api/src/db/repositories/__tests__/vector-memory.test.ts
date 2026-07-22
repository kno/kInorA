import { describe, expect, it, vi } from "vitest";
import {
  VectorMemoryRepository,
  assertEligibilityForPersistence,
  assertEmbeddingDimension,
} from "../vector-memory.js";

const TENANT_A = "aaaaaaaa-0000-0000-0000-000000000010";
const TENANT_B = "bbbbbbbb-0000-0000-0000-000000000020";
const USER_A = "aaaaaaaa-0000-0000-0000-000000000001";
const USER_B = "bbbbbbbb-0000-0000-0000-000000000002";

function vectorMemoryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "mem-1",
    tenantId: TENANT_A,
    userId: USER_A,
    summary: "Prefers morning workouts",
    source: "user_confirmation",
    status: "active" as const,
    eligibility: "eligible" as const,
    consentStatus: "granted" as const,
    consentedAt: new Date("2026-07-22T12:00:00Z"),
    revokedAt: null,
    disabledAt: null,
    deletedAt: null,
    idempotencyKey: "idem-1",
    fingerprint: "fingerprint-1",
    schemaVersion: "1",
    embeddingProvider: "openai",
    embeddingModel: "text-embedding-3-small",
    embeddingVersion: "text-embedding-3-small",
    embeddingDimension: 1536,
    embedding: new Array(1536).fill(0.1),
    createdAt: new Date("2026-07-22T12:00:00Z"),
    updatedAt: new Date("2026-07-22T12:00:00Z"),
    ...overrides,
  };
}

function settingsRow(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: TENANT_A,
    userId: USER_A,
    enabled: true,
    settingsVersion: 1,
    disabledAt: null,
    createdAt: new Date("2026-07-22T12:00:00Z"),
    updatedAt: new Date("2026-07-22T12:00:00Z"),
    ...overrides,
  };
}

function selectWhereChain(rows: unknown[]) {
  const limit = vi.fn().mockResolvedValue(rows);
  const orderBy = vi.fn().mockReturnValue({ limit });
  const where = vi.fn().mockReturnValue({ orderBy, limit });
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });
  return { select, where, orderBy, limit };
}

function selectSequence(...rows: unknown[][]) {
  const chains = rows.map((chainRows) => selectWhereChain(chainRows));
  const select = vi.fn();
  for (const chain of chains) {
    select.mockImplementationOnce(() => chain.select());
  }
  return { select };
}

function insertUpdateChain(returnRows: unknown[]) {
  const returning = vi.fn().mockResolvedValue(returnRows);
  const onConflictDoUpdate = vi.fn().mockReturnValue({ returning });
  const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
  const insert = vi.fn().mockReturnValue({ values });
  return { insert, values, onConflictDoUpdate, returning };
}

function updateReturningChain(returnRows: unknown[]) {
  const returning = vi.fn().mockResolvedValue(returnRows);
  const where = vi.fn().mockReturnValue({ returning });
  const set = vi.fn().mockReturnValue({ where });
  const update = vi.fn().mockReturnValue({ set });
  return { update, set, where, returning };
}

describe("vector memory invariants", () => {
  it("rejects invalid eligibility before persistence", () => {
    expect(() => assertEligibilityForPersistence("secret")).toThrow(/eligibility/i);
    expect(() => assertEligibilityForPersistence("sensitive_health")).toThrow(
      /eligibility/i,
    );
  });

  it("rejects dimension metadata that does not match the embedding length", () => {
    expect(() => assertEmbeddingDimension(1536, [0.1, 0.2])).toThrow(/dimension/i);
    expect(() => assertEmbeddingDimension(2, [0.1, 0.2])).not.toThrow();
  });
});

describe("VectorMemoryRepository", () => {
  describe("listByOwner", () => {
    it("returns only the caller's tenant+user memory rows", async () => {
      const row = vectorMemoryRow();
      const { select } = selectWhereChain([row]);
      const repo = new VectorMemoryRepository({ select } as never);

      const result = await repo.listByOwner({ tenantId: TENANT_A, userId: USER_A });

      expect(select).toHaveBeenCalledTimes(1);
      expect(result).toEqual([row]);
    });

    it("keeps same-user rows isolated across tenants", async () => {
      const tenantBRow = vectorMemoryRow({ tenantId: TENANT_B });
      const { select } = selectWhereChain([tenantBRow]);
      const repo = new VectorMemoryRepository({ select } as never);

      const result = await repo.listByOwner({ tenantId: TENANT_B, userId: USER_A });

      expect(result[0]?.tenantId).toBe(TENANT_B);
      expect(result[0]?.tenantId).not.toBe(TENANT_A);
    });
  });

  describe("create", () => {
    it("writes idempotency + fingerprint metadata and returns the inserted row", async () => {
      const existingLookup = selectSequence([settingsRow()], [], []);
      const insertChain = insertUpdateChain([vectorMemoryRow()]);
      const repo = new VectorMemoryRepository({
        select: existingLookup.select,
        insert: insertChain.insert,
      } as never);

      const result = await repo.create(
        { tenantId: TENANT_A, userId: USER_A },
        {
          summary: "Prefers morning workouts",
          source: "user_confirmation",
          status: "active",
          eligibility: "eligible",
          consentStatus: "granted",
          consentedAt: new Date("2026-07-22T12:00:00Z"),
          idempotencyKey: "idem-1",
          fingerprint: "fingerprint-1",
          schemaVersion: "1",
          embeddingProvider: "openai",
          embeddingModel: "text-embedding-3-small",
          embeddingVersion: "text-embedding-3-small",
          embeddingDimension: 1536,
          embedding: new Array(1536).fill(0.1),
        },
      );

      expect(insertChain.insert).toHaveBeenCalledTimes(1);
      expect(insertChain.values.mock.calls[0][0]).toMatchObject({
        tenantId: TENANT_A,
        userId: USER_A,
        idempotencyKey: "idem-1",
        fingerprint: "fingerprint-1",
        embeddingProvider: "openai",
        embeddingModel: "text-embedding-3-small",
        embeddingVersion: "text-embedding-3-small",
        embeddingDimension: 1536,
      });
      expect(result.idempotencyKey).toBe("idem-1");
    });

    it("returns the existing active row when the same fingerprint already exists", async () => {
      const row = vectorMemoryRow();
      const existingLookup = selectSequence([settingsRow()], [], [row]);
      const insertChain = insertUpdateChain([row]);
      const repo = new VectorMemoryRepository({
        select: existingLookup.select,
        insert: insertChain.insert,
      } as never);

      const result = await repo.create(
        { tenantId: TENANT_A, userId: USER_A },
        {
          summary: row.summary,
          source: row.source,
          status: "active",
          eligibility: "eligible",
          consentStatus: "granted",
          consentedAt: row.consentedAt,
          idempotencyKey: "idem-2",
          fingerprint: row.fingerprint,
          schemaVersion: row.schemaVersion,
          embeddingProvider: row.embeddingProvider,
          embeddingModel: row.embeddingModel,
          embeddingVersion: row.embeddingVersion,
          embeddingDimension: row.embeddingDimension,
          embedding: row.embedding,
        },
      );

      expect(insertChain.insert).not.toHaveBeenCalled();
      expect(result).toEqual(row);
    });

    it("rejects writes when vector memory is disabled for the owner", async () => {
      const existingLookup = selectSequence([settingsRow({ enabled: false, disabledAt: new Date() })]);
      const insertChain = insertUpdateChain([vectorMemoryRow()]);
      const repo = new VectorMemoryRepository({
        select: existingLookup.select,
        insert: insertChain.insert,
      } as never);

      await expect(
        repo.create(
          { tenantId: TENANT_A, userId: USER_A },
          {
            summary: "Prefers morning workouts",
            source: "user_confirmation",
            status: "active",
            eligibility: "eligible",
            consentStatus: "granted",
            consentedAt: new Date("2026-07-22T12:00:00Z"),
            idempotencyKey: "idem-disabled",
            fingerprint: "fingerprint-disabled",
            schemaVersion: "1",
            embeddingProvider: "openai",
            embeddingModel: "text-embedding-3-small",
            embeddingVersion: "text-embedding-3-small",
            embeddingDimension: 1536,
            embedding: new Array(1536).fill(0.1),
          },
        ),
      ).rejects.toThrow(/disabled/i);
      expect(insertChain.insert).not.toHaveBeenCalled();
    });

    it("rejects a retry when its idempotency key belongs to a deleted memory", async () => {
      const deleted = vectorMemoryRow({
        status: "deleted",
        summary: "[deleted]",
        embedding: new Array(1536).fill(0),
        deletedAt: new Date("2026-07-22T13:00:00Z"),
      });
      const existingLookup = selectSequence([settingsRow()], [deleted]);
      const insertChain = insertUpdateChain([vectorMemoryRow()]);
      const repo = new VectorMemoryRepository({
        select: existingLookup.select,
        insert: insertChain.insert,
      } as never);

      await expect(
        repo.create(
          { tenantId: TENANT_A, userId: USER_A },
          {
            summary: "Prefers morning workouts",
            source: "user_confirmation",
            status: "active",
            eligibility: "eligible",
            consentStatus: "granted",
            consentedAt: new Date("2026-07-22T12:00:00Z"),
            idempotencyKey: deleted.idempotencyKey,
            fingerprint: "new-fingerprint",
            schemaVersion: "1",
            embeddingProvider: "openai",
            embeddingModel: "text-embedding-3-small",
            embeddingVersion: "text-embedding-3-small",
            embeddingDimension: 1536,
            embedding: new Array(1536).fill(0.1),
          },
        ),
      ).rejects.toThrow(/already deleted/i);
      expect(insertChain.insert).not.toHaveBeenCalled();
    });

    it("rejects an active idempotency-key collision with different content", async () => {
      const existing = vectorMemoryRow();
      const existingLookup = selectSequence([settingsRow()], [existing]);
      const insertChain = insertUpdateChain([existing]);
      const repo = new VectorMemoryRepository({
        select: existingLookup.select,
        insert: insertChain.insert,
      } as never);

      await expect(
        repo.create(
          { tenantId: TENANT_A, userId: USER_A },
          {
            summary: "Prefers evening workouts",
            source: "user_confirmation",
            status: "active",
            eligibility: "eligible",
            consentStatus: "granted",
            consentedAt: existing.consentedAt,
            idempotencyKey: existing.idempotencyKey,
            fingerprint: "different-fingerprint",
            schemaVersion: existing.schemaVersion,
            embeddingProvider: existing.embeddingProvider,
            embeddingModel: existing.embeddingModel,
            embeddingVersion: existing.embeddingVersion,
            embeddingDimension: 1536,
            embedding: new Array(1536).fill(0.2),
          },
        ),
      ).rejects.toThrow(/different content/i);
      expect(insertChain.insert).not.toHaveBeenCalled();
    });

    it("rejects an embedding whose length does not match the supplied metadata dimension", async () => {
      const repo = new VectorMemoryRepository({ select: vi.fn() } as never);

      await expect(
        repo.create(
          { tenantId: TENANT_A, userId: USER_A },
          {
            summary: "Prefers morning workouts",
            source: "user_confirmation",
            status: "active",
            eligibility: "eligible",
            consentStatus: "granted",
            consentedAt: new Date("2026-07-22T12:00:00Z"),
            idempotencyKey: "idem-wrong-dimension",
            fingerprint: "fingerprint-wrong-dimension",
            schemaVersion: "1",
            embeddingProvider: "openai",
            embeddingModel: "test-model",
            embeddingVersion: "test-version",
            embeddingDimension: 3,
            embedding: [0.1, 0.2],
          },
        ),
      ).rejects.toThrow(/dimension/i);
    });
  });

  describe("delete", () => {
    it("redacts sensitive content while retaining a deletion tombstone", async () => {
      const updateChain = updateReturningChain([
        vectorMemoryRow({ status: "deleted", deletedAt: new Date("2026-07-22T13:00:00Z") }),
      ]);
      const repo = new VectorMemoryRepository({ update: updateChain.update } as never);

      const result = await repo.delete({ tenantId: TENANT_A, userId: USER_A }, "mem-1");

      expect(updateChain.update).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ kind: "deleted" });
      const payload = updateChain.set.mock.calls[0][0];
      expect(payload.status).toBe("deleted");
      expect(payload.summary).toBe("[deleted]");
      expect(payload.embedding).toEqual(new Array(1536).fill(0));
      expect(payload.embedding).not.toEqual(vectorMemoryRow().embedding);
      expect(payload.deletedAt).toBeInstanceOf(Date);
    });
  });

  describe("setEnabled", () => {
    it("stores disabled state per tenant+user and timestamps the toggle", async () => {
      const insertChain = insertUpdateChain([settingsRow({ enabled: false, disabledAt: new Date() })]);
      const repo = new VectorMemoryRepository({ insert: insertChain.insert } as never);

      const result = await repo.setEnabled(
        { tenantId: TENANT_A, userId: USER_A },
        false,
      );

      expect(insertChain.values.mock.calls[0][0]).toMatchObject({
        tenantId: TENANT_A,
        userId: USER_A,
        enabled: false,
      });
      expect(result.enabled).toBe(false);
      expect(result.disabledAt).toBeInstanceOf(Date);
    });
  });

  describe("searchActiveCompatible", () => {
    it("returns [] when the owner's memory setting is disabled", async () => {
      const settingsLookup = selectWhereChain([settingsRow({ enabled: false, disabledAt: new Date() })]);
      const repo = new VectorMemoryRepository({ select: settingsLookup.select } as never);

      const result = await repo.searchActiveCompatible(
        { tenantId: TENANT_A, userId: USER_A },
        {
          provider: "openai",
          model: "text-embedding-3-small",
          version: "text-embedding-3-small",
          dimension: 1536,
        },
      );

      expect(result).toEqual([]);
    });

    it("returns only metadata-compatible active rows for the scoped owner", async () => {
      const select = vi
        .fn()
        .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }) }) })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([vectorMemoryRow()]) }),
          }),
        });
      const repo = new VectorMemoryRepository({ select } as never);

      const result = await repo.searchActiveCompatible(
        { tenantId: TENANT_A, userId: USER_A },
        {
          provider: "openai",
          model: "text-embedding-3-small",
          version: "text-embedding-3-small",
          dimension: 1536,
        },
      );

      expect(result).toHaveLength(1);
      expect(result[0]?.embeddingProvider).toBe("openai");
      expect(result[0]?.tenantId).toBe(TENANT_A);
      expect(result[0]?.userId).toBe(USER_A);
    });

    it("defensively excludes disabled, deleted, incompatible, and cross-scope rows even if the adapter returns them", async () => {
      const compatible = vectorMemoryRow({
        embeddingVersion: "2026-07-22",
        embeddingDimension: 3,
        embedding: [0.1, 0.2, 0.3],
      });
      const select = vi
        .fn()
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
          }),
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([
                compatible,
                vectorMemoryRow({ embeddingProvider: "other" }),
                vectorMemoryRow({ embeddingModel: "text-embedding-3-large" }),
                vectorMemoryRow({ embeddingVersion: "2025-01-01" }),
                vectorMemoryRow({ embeddingDimension: 4, embedding: [0.1, 0.2, 0.3, 0.4] }),
                vectorMemoryRow({ disabledAt: new Date("2026-07-22T13:00:00Z") }),
                vectorMemoryRow({ deletedAt: new Date("2026-07-22T13:00:00Z") }),
                vectorMemoryRow({ tenantId: TENANT_B }),
                vectorMemoryRow({ userId: USER_B }),
                vectorMemoryRow({ status: "failed" }),
              ]),
            }),
          }),
        });
      const repo = new VectorMemoryRepository({ select } as never);

      const result = await repo.searchActiveCompatible(
        { tenantId: TENANT_A, userId: USER_A },
        {
          provider: "openai",
          model: "text-embedding-3-small",
          version: "2026-07-22",
          dimension: 3,
        },
      );

      expect(result).toEqual([compatible]);
    });

    it("keeps same-tenant rows isolated across different users", async () => {
      const select = vi
        .fn()
        .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }) }) })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([vectorMemoryRow({ userId: USER_B })]),
            }),
          }),
        });
      const repo = new VectorMemoryRepository({ select } as never);

      const result = await repo.searchActiveCompatible(
        { tenantId: TENANT_A, userId: USER_B },
        {
          provider: "openai",
          model: "text-embedding-3-small",
          version: "text-embedding-3-small",
          dimension: 1536,
        },
      );

      expect(result[0]?.userId).toBe(USER_B);
      expect(result[0]?.userId).not.toBe(USER_A);
    });
  });
});
