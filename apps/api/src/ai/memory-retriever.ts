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

export interface VectorMemorySearchPort {
  searchActiveCompatible(
    scope: VectorMemoryOwnerScope,
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
  | { kind: "failed"; reason: EmbeddingFailureReason };

export interface RetrieveVectorMemoryOptions {
  query: string;
  limit?: number;
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
