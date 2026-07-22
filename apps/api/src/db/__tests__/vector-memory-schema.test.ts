import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isTable } from "drizzle-orm/table";
import { getTableColumns } from "drizzle-orm/utils";
import {
  userMemoryVectors,
  vectorMemorySettings,
  userMemoryConsentEnum,
  userMemoryEligibilityEnum,
  userMemoryStatusEnum,
} from "../schema.js";

const migrationSql = readFileSync(
  fileURLToPath(new URL("../../../drizzle/0010_vector_memory.sql", import.meta.url)),
  "utf8",
);

describe("vector memory schema shape", () => {
  it("defines a vectorMemorySettings table", () => {
    expect(isTable(vectorMemorySettings)).toBe(true);
  });

  it("vectorMemorySettings stores tenant/user ownership and enabled state", () => {
    const cols = getTableColumns(vectorMemorySettings);
    expect(cols.tenantId?.columnType).toBe("PgUUID");
    expect(cols.userId?.columnType).toBe("PgUUID");
    expect(cols.enabled?.columnType).toBe("PgBoolean");
    expect(cols.settingsVersion?.columnType).toBe("PgInteger");
    expect(cols.disabledAt).toBeDefined();
  });

  it("defines a userMemoryVectors table", () => {
    expect(isTable(userMemoryVectors)).toBe(true);
  });

  it("userMemoryVectors stores lifecycle, consent, ownership, and embedding metadata", () => {
    const cols = getTableColumns(userMemoryVectors);
    expect(cols.id?.columnType).toBe("PgUUID");
    expect(cols.tenantId?.columnType).toBe("PgUUID");
    expect(cols.userId?.columnType).toBe("PgUUID");
    expect(cols.summary?.columnType).toBe("PgText");
    expect(cols.status?.columnType).toBe("PgEnumColumn");
    expect(cols.eligibility?.columnType).toBe("PgEnumColumn");
    expect(cols.consentStatus?.columnType).toBe("PgEnumColumn");
    expect(cols.idempotencyKey?.columnType).toBe("PgText");
    expect(cols.fingerprint?.columnType).toBe("PgText");
    expect(cols.schemaVersion?.columnType).toBe("PgText");
    expect(cols.embeddingProvider?.columnType).toBe("PgText");
    expect(cols.embeddingModel?.columnType).toBe("PgText");
    expect(cols.embeddingVersion?.columnType).toBe("PgText");
    expect(cols.embeddingDimension?.columnType).toBe("PgInteger");
    expect(cols.embedding).toBeDefined();
    expect(cols.deletedAt).toBeDefined();
    expect(cols.disabledAt).toBeDefined();
  });

  it("exposes the vector-memory enums required by the spec", () => {
    expect(userMemoryStatusEnum.enumValues).toEqual(
      expect.arrayContaining([
        "candidate",
        "confirmed",
        "embedding_pending",
        "active",
        "rejected",
        "failed",
        "deleted",
      ]),
    );
    expect(userMemoryEligibilityEnum.enumValues).toEqual(
      expect.arrayContaining([
        "eligible",
        "secret",
        "raw_transcript",
        "full_plan",
        "sensitive_health",
        "other",
      ]),
    );
    expect(userMemoryConsentEnum.enumValues).toEqual(
      expect.arrayContaining(["granted", "revoked"]),
    );
  });
});

describe("vector memory migration", () => {
  it("enables pgvector and creates the vector-memory tables", () => {
    expect(migrationSql).toContain("CREATE EXTENSION IF NOT EXISTS vector");
    expect(migrationSql).toContain('CREATE TABLE "vector_memory_settings"');
    expect(migrationSql).toContain('CREATE TABLE "user_memory_vectors"');
  });

  it("pins the initial embedding column dimension to 1536", () => {
    expect(migrationSql).toContain('"embedding" vector(1536) NOT NULL');
  });

  it("creates owner/idempotency/compatibility indexes and constraints", () => {
    expect(migrationSql).toContain("vector_memory_settings_tenant_user_unique");
    expect(migrationSql).toContain("user_memory_vectors_tenant_user_idempotency_unique");
    expect(migrationSql).toContain("user_memory_vectors_owner_status_idx");
    expect(migrationSql).toContain("user_memory_vectors_owner_embedding_metadata_idx");
  });
});
