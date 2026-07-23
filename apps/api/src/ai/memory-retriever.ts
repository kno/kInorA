import type {
  CreateVectorMemoryInput,
  VectorMemoryCompatibility,
  VectorMemoryOwnerScope,
  VectorMemoryRecord,
} from "../db/repositories/vector-memory.js";
import {
  generateEmbeddingWithPolicy,
  type EmbeddingFailureReason,
  type EmbeddingGenerator,
} from "./embedding-port.js";
import { classifyMemoryEligibility } from "../user-memory/eligibility.js";

export interface VectorMemorySearchPort {
  searchActiveCompatible(
    scope: VectorMemoryOwnerScope,
    queryEmbedding: number[],
    compatibility: VectorMemoryCompatibility,
    limit?: number,
  ): Promise<VectorMemoryRecord[]>;
}

export interface VectorMemoryWritePort {
  create(
    scope: VectorMemoryOwnerScope,
    input: CreateVectorMemoryInput,
  ): Promise<VectorMemoryRecord>;
}

export type PersistVectorMemoryInput = Omit<
  CreateVectorMemoryInput,
  | "embeddingProvider"
  | "embeddingModel"
  | "embeddingVersion"
  | "embeddingDimension"
  | "embedding"
>;

export type PersistVectorMemoryResult =
  | { kind: "stored"; record: VectorMemoryRecord }
  | { kind: "rejected"; reason: PersistVectorMemoryInput["eligibility"] }
  | { kind: "failed"; reason: EmbeddingFailureReason };

export interface RetrieveVectorMemoryOptions {
  query: string;
  limit?: number;
}

/**
 * Product entitlement gate for premium vector-memory retrieval (11a billing).
 *
 * Retrieval is a premium AI capability: on Free tenants the `memory_retrieval`
 * feature limit is 0, so this gate denies and the caller MUST skip retrieval
 * entirely. A denial is a product decision and can NEVER be used as a fallback —
 * only a *technical* retrieval failure after an allowed entitlement fails open.
 * Kept as a narrow port so the billing use case stays out of the AI layer.
 */
export interface MemoryRetrievalEntitlementPort {
  check(scope: { tenantId: string; userId: string }): Promise<{ allowed: boolean }>;
}

export class VectorMemoryWriteCoordinator {
  constructor(
    private readonly generator: EmbeddingGenerator,
    private readonly repo: VectorMemoryWritePort,
  ) {}

  async saveConfirmedMemory(
    scope: VectorMemoryOwnerScope,
    input: PersistVectorMemoryInput,
  ): Promise<PersistVectorMemoryResult> {
    const eligibility = classifyMemoryEligibility(input.summary);
    if (eligibility !== "eligible") {
      return { kind: "rejected", reason: eligibility };
    }

    const embeddingResult = await generateEmbeddingWithPolicy(this.generator, input.summary, {
      timeoutMs: this.generator.config.timeoutMs,
      maxAttempts: this.generator.config.maxAttempts,
    });

    if (embeddingResult.kind === "failed") {
      return embeddingResult;
    }

    const record = await this.repo.create(scope, {
      ...input,
      embeddingProvider: this.generator.config.provider,
      embeddingModel: this.generator.config.model,
      embeddingVersion: this.generator.config.version,
      embeddingDimension: this.generator.config.dimension,
      embedding: embeddingResult.embedding,
    });

    return { kind: "stored", record };
  }
}

export class VectorMemoryRetriever {
  constructor(
    private readonly generator: EmbeddingGenerator,
    private readonly repo: VectorMemorySearchPort,
  ) {}

  async retrieve(
    scope: VectorMemoryOwnerScope,
    options: RetrieveVectorMemoryOptions,
  ): Promise<VectorMemoryRecord[]> {
    if (!options.query.trim()) {
      return [];
    }

    const embeddingResult = await generateEmbeddingWithPolicy(this.generator, options.query, {
      timeoutMs: 1000,
      maxAttempts: this.generator.config.maxAttempts,
    });

    if (embeddingResult.kind === "failed") {
      return [];
    }

    try {
      return await this.repo.searchActiveCompatible(
        scope,
        embeddingResult.embedding,
        {
          provider: this.generator.config.provider,
          model: this.generator.config.model,
          version: this.generator.config.version,
          dimension: this.generator.config.dimension,
        },
        options.limit,
      );
    } catch (error) {
      console.warn("Vector memory retrieval failed", {
        errorName: error instanceof Error ? error.name : "unknown",
      });
      return [];
    }
  }
}
