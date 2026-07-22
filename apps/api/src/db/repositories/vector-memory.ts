import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { DEFAULT_VECTOR_MEMORY_EMBEDDING_CONFIG } from "@kinora/contracts";
import type { Database } from "../client.js";
import { userMemoryVectors, vectorMemorySettings } from "../schema.js";

export interface VectorMemoryOwnerScope {
  tenantId: string;
  userId: string;
}

export interface VectorMemoryCompatibility {
  provider: string;
  model: string;
  version: string;
  dimension: number;
}

export interface VectorMemorySettingsRecord {
  tenantId: string;
  userId: string;
  enabled: boolean;
  settingsVersion: number;
  disabledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface VectorMemoryRecord {
  id: string;
  tenantId: string;
  userId: string;
  summary: string;
  source: string;
  status:
    | "candidate"
    | "confirmed"
    | "embedding_pending"
    | "active"
    | "rejected"
    | "failed"
    | "deleted";
  eligibility:
    | "eligible"
    | "secret"
    | "raw_transcript"
    | "full_plan"
    | "sensitive_health"
    | "other";
  consentStatus: "granted" | "revoked";
  consentedAt: Date;
  revokedAt: Date | null;
  idempotencyKey: string;
  fingerprint: string;
  schemaVersion: string;
  embeddingProvider: string;
  embeddingModel: string;
  embeddingVersion: string;
  embeddingDimension: number;
  embedding: number[];
  disabledAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateVectorMemoryInput {
  summary: string;
  source: string;
  status: VectorMemoryRecord["status"];
  eligibility: VectorMemoryRecord["eligibility"];
  consentStatus: VectorMemoryRecord["consentStatus"];
  consentedAt: Date;
  idempotencyKey: string;
  fingerprint: string;
  schemaVersion: string;
  embeddingProvider: string;
  embeddingModel: string;
  embeddingVersion: string;
  embeddingDimension: number;
  embedding: number[];
  revokedAt?: Date | null;
  disabledAt?: Date | null;
  deletedAt?: Date | null;
}

export function assertEligibilityForPersistence(
  eligibility: CreateVectorMemoryInput["eligibility"],
): void {
  if (eligibility !== "eligible") {
    throw new Error(`vector memory eligibility must be eligible (got ${eligibility})`);
  }
}

export function assertEmbeddingDimension(
  expectedDimension: number,
  embedding: number[],
): void {
  if (embedding.length !== expectedDimension) {
    throw new Error(
      `vector memory embedding dimension mismatch: expected ${expectedDimension}, got ${embedding.length}`,
    );
  }
}

function belongsToScope(
  record: Pick<VectorMemoryRecord, "tenantId" | "userId">,
  scope: VectorMemoryOwnerScope,
): boolean {
  return record.tenantId === scope.tenantId && record.userId === scope.userId;
}

function isCompatibleActiveRecord(
  record: VectorMemoryRecord,
  scope: VectorMemoryOwnerScope,
  compatibility: VectorMemoryCompatibility,
): boolean {
  return (
    belongsToScope(record, scope) &&
    record.status === "active" &&
    record.embeddingProvider === compatibility.provider &&
    record.embeddingModel === compatibility.model &&
    record.embeddingVersion === compatibility.version &&
    record.embeddingDimension === compatibility.dimension &&
    record.disabledAt === null &&
    record.deletedAt === null
  );
}

export class VectorMemoryRepository {
  constructor(private db: Database) {}

  async listByOwner(scope: VectorMemoryOwnerScope): Promise<VectorMemoryRecord[]> {
    const rows = await this.db
      .select()
      .from(userMemoryVectors)
      .where(
        and(
          eq(userMemoryVectors.tenantId, scope.tenantId),
          eq(userMemoryVectors.userId, scope.userId),
          isNull(userMemoryVectors.deletedAt),
        ),
      )
      .orderBy(desc(userMemoryVectors.updatedAt))
      .limit(100);

    return (rows as VectorMemoryRecord[]).filter(
      (record) => belongsToScope(record, scope) && record.deletedAt === null,
    );
  }

  async getSettings(scope: VectorMemoryOwnerScope): Promise<VectorMemorySettingsRecord | null> {
    const rows = await this.db
      .select()
      .from(vectorMemorySettings)
      .where(
        and(
          eq(vectorMemorySettings.tenantId, scope.tenantId),
          eq(vectorMemorySettings.userId, scope.userId),
        ),
      )
      .limit(1);

    return (rows[0] as VectorMemorySettingsRecord | undefined) ?? null;
  }

  async create(
    scope: VectorMemoryOwnerScope,
    input: CreateVectorMemoryInput,
  ): Promise<VectorMemoryRecord> {
    assertEligibilityForPersistence(input.eligibility);
    assertEmbeddingDimension(input.embeddingDimension, input.embedding);

    if (input.consentStatus !== "granted") {
      throw new Error(`vector memory consent must be granted (got ${input.consentStatus})`);
    }

    const settings = await this.getSettings(scope);
    if (settings && !settings.enabled) {
      throw new Error("vector memory is disabled for this tenant and user");
    }

    const existingByIdempotencyKey = await this.findByIdempotencyKey(
      scope,
      input.idempotencyKey,
    );
    if (existingByIdempotencyKey?.status === "deleted") {
      throw new Error("vector memory idempotency key was already deleted");
    }
    if (
      existingByIdempotencyKey?.status === "active" &&
      existingByIdempotencyKey.fingerprint !== input.fingerprint
    ) {
      throw new Error("vector memory idempotency key is already active for different content");
    }

    const existing = await this.findActiveByFingerprint(scope, input.fingerprint);
    if (existing) {
      return existing;
    }

    const rows = await this.db
      .insert(userMemoryVectors)
      .values({
        tenantId: scope.tenantId,
        userId: scope.userId,
        summary: input.summary,
        source: input.source,
        status: input.status,
        eligibility: input.eligibility,
        consentStatus: input.consentStatus,
        consentedAt: input.consentedAt,
        revokedAt: input.revokedAt ?? null,
        idempotencyKey: input.idempotencyKey,
        fingerprint: input.fingerprint,
        schemaVersion: input.schemaVersion,
        embeddingProvider: input.embeddingProvider,
        embeddingModel: input.embeddingModel,
        embeddingVersion: input.embeddingVersion,
        embeddingDimension: input.embeddingDimension,
        embedding: input.embedding,
        disabledAt: input.disabledAt ?? null,
        deletedAt: input.deletedAt ?? null,
      })
      .onConflictDoUpdate({
        target: [
          userMemoryVectors.tenantId,
          userMemoryVectors.userId,
          userMemoryVectors.idempotencyKey,
        ],
        set: {
          summary: input.summary,
          source: input.source,
          status: input.status,
          eligibility: input.eligibility,
          consentStatus: input.consentStatus,
          consentedAt: input.consentedAt,
          revokedAt: input.revokedAt ?? null,
          fingerprint: input.fingerprint,
          schemaVersion: input.schemaVersion,
          embeddingProvider: input.embeddingProvider,
          embeddingModel: input.embeddingModel,
          embeddingVersion: input.embeddingVersion,
          embeddingDimension: input.embeddingDimension,
          embedding: input.embedding,
          disabledAt: input.disabledAt ?? null,
          deletedAt: input.deletedAt ?? null,
          updatedAt: new Date(),
        },
      })
      .returning();

    return rows[0] as VectorMemoryRecord;
  }

  async delete(
    scope: VectorMemoryOwnerScope,
    id: string,
  ): Promise<{ kind: "deleted" | "not_found" }> {
    const rows = await this.db
      .update(userMemoryVectors)
      .set({
        summary: "[deleted]",
        source: "[deleted]",
        status: "deleted",
        fingerprint: "",
        embeddingProvider: "",
        embeddingModel: "",
        embeddingVersion: "",
        embeddingDimension: DEFAULT_VECTOR_MEMORY_EMBEDDING_CONFIG.dimension,
        embedding: new Array(DEFAULT_VECTOR_MEMORY_EMBEDDING_CONFIG.dimension).fill(0),
        deletedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(userMemoryVectors.id, id),
          eq(userMemoryVectors.tenantId, scope.tenantId),
          eq(userMemoryVectors.userId, scope.userId),
          isNull(userMemoryVectors.deletedAt),
        ),
      )
      .returning();

    return rows[0] ? { kind: "deleted" } : { kind: "not_found" };
  }

  async setEnabled(
    scope: VectorMemoryOwnerScope,
    enabled: boolean,
  ): Promise<VectorMemorySettingsRecord> {
    const rows = await this.db
      .insert(vectorMemorySettings)
      .values({
        tenantId: scope.tenantId,
        userId: scope.userId,
        enabled,
        disabledAt: enabled ? null : new Date(),
      })
      .onConflictDoUpdate({
        target: [vectorMemorySettings.tenantId, vectorMemorySettings.userId],
        set: {
          enabled,
          disabledAt: enabled ? null : new Date(),
          settingsVersion: sql`${vectorMemorySettings.settingsVersion} + 1`,
          updatedAt: new Date(),
        },
      })
      .returning();

    return rows[0] as VectorMemorySettingsRecord;
  }

  async searchActiveCompatible(
    scope: VectorMemoryOwnerScope,
    compatibility: VectorMemoryCompatibility = DEFAULT_VECTOR_MEMORY_EMBEDDING_CONFIG,
    limit = 5,
  ): Promise<VectorMemoryRecord[]> {
    const settings = await this.getSettings(scope);
    if (settings && !settings.enabled) {
      return [];
    }

    const rows = await this.db
      .select()
      .from(userMemoryVectors)
      .where(
        and(
          eq(userMemoryVectors.tenantId, scope.tenantId),
          eq(userMemoryVectors.userId, scope.userId),
          eq(userMemoryVectors.status, "active"),
          eq(userMemoryVectors.embeddingProvider, compatibility.provider),
          eq(userMemoryVectors.embeddingModel, compatibility.model),
          eq(userMemoryVectors.embeddingVersion, compatibility.version),
          eq(userMemoryVectors.embeddingDimension, compatibility.dimension),
          isNull(userMemoryVectors.disabledAt),
          isNull(userMemoryVectors.deletedAt),
        ),
      )
      .limit(limit);

    return (rows as VectorMemoryRecord[]).filter((record) =>
      isCompatibleActiveRecord(record, scope, compatibility),
    );
  }

  private async findActiveByFingerprint(
    scope: VectorMemoryOwnerScope,
    fingerprint: string,
  ): Promise<VectorMemoryRecord | null> {
    const rows = await this.db
      .select()
      .from(userMemoryVectors)
      .where(
        and(
          eq(userMemoryVectors.tenantId, scope.tenantId),
          eq(userMemoryVectors.userId, scope.userId),
          eq(userMemoryVectors.fingerprint, fingerprint),
          isNull(userMemoryVectors.deletedAt),
        ),
      )
      .limit(1);

    return (rows[0] as VectorMemoryRecord | undefined) ?? null;
  }

  private async findByIdempotencyKey(
    scope: VectorMemoryOwnerScope,
    idempotencyKey: string,
  ): Promise<VectorMemoryRecord | null> {
    const rows = await this.db
      .select()
      .from(userMemoryVectors)
      .where(
        and(
          eq(userMemoryVectors.tenantId, scope.tenantId),
          eq(userMemoryVectors.userId, scope.userId),
          eq(userMemoryVectors.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);

    return (rows[0] as VectorMemoryRecord | undefined) ?? null;
  }
}
