import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { embedQuery, MockOpenAIEmbeddings } = vi.hoisted(() => {
  const embedQuery = vi.fn();
  const MockOpenAIEmbeddings = vi.fn(() => ({
    embedQuery,
  }));

  return { embedQuery, MockOpenAIEmbeddings };
});

vi.mock("@langchain/openai", () => ({
  OpenAIEmbeddings: MockOpenAIEmbeddings,
}));

import {
  createOpenAIEmbeddingGenerator,
  type EmbeddingGenerator,
  type EmbeddingRuntimeConfig,
  validateEmbeddingRuntimeConfig,
} from "../embedding-port.js";
import {
  VectorMemoryRetriever,
  VectorMemoryWriteCoordinator,
} from "../memory-retriever.js";

const TENANT_ID = "aaaaaaaa-0000-0000-0000-000000000010";
const USER_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const EMBEDDING = new Array(1536).fill(0.1);

function config(overrides: Partial<EmbeddingRuntimeConfig> = {}): EmbeddingRuntimeConfig {
  return {
    provider: "openai",
    model: "text-embedding-3-small",
    version: "2026-07-22",
    dimension: 1536,
    timeoutMs: 50,
    maxAttempts: 2,
    ...overrides,
  };
}

function memoryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "mem-1",
    tenantId: TENANT_ID,
    userId: USER_ID,
    summary: "Prefers morning workouts",
    source: "user_confirmation",
    status: "active" as const,
    eligibility: "eligible" as const,
    consentStatus: "granted" as const,
    consentedAt: new Date("2026-07-22T12:00:00Z"),
    revokedAt: null,
    idempotencyKey: "idem-1",
    fingerprint: "fingerprint-1",
    schemaVersion: "1",
    embeddingProvider: "openai",
    embeddingModel: "text-embedding-3-small",
    embeddingVersion: "2026-07-22",
    embeddingDimension: 1536,
    embedding: EMBEDDING,
    disabledAt: null,
    deletedAt: null,
    createdAt: new Date("2026-07-22T12:00:00Z"),
    updatedAt: new Date("2026-07-22T12:00:00Z"),
    ...overrides,
  };
}

function buildGenerator(implementation: EmbeddingGenerator["generate"]): EmbeddingGenerator {
  return {
    config: config(),
    generate: vi.fn(implementation),
  };
}

describe("validateEmbeddingRuntimeConfig", () => {
  it("rejects blank provider/model/version and non-positive dimensions", () => {
    expect(() =>
      validateEmbeddingRuntimeConfig(
        config({ provider: "", model: "", version: "", dimension: 0 }),
      ),
    ).toThrow(/provider|model|version|dimension/i);
  });

  it("accepts the approved openai default metadata when timeout/retry values are bounded", () => {
    expect(validateEmbeddingRuntimeConfig(config())).toEqual(config());
  });

  it("rejects dimensions other than the persistence dimension", () => {
    expect(() => validateEmbeddingRuntimeConfig(config({ dimension: 3 }))).toThrow(
      /1536.*persistence/i,
    );
  });
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env["OPENAI_API_KEY"];
});

describe("createOpenAIEmbeddingGenerator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds an adapter boundary around OpenAIEmbeddings with the configured metadata", async () => {
    embedQuery.mockResolvedValue(EMBEDDING);
    process.env["OPENAI_API_KEY"] = "sk-test-key";

    const generator = createOpenAIEmbeddingGenerator(config());
    const result = await generator.generate("prefers morning workouts");

    expect(MockOpenAIEmbeddings).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "sk-test-key",
        model: "text-embedding-3-small",
        dimensions: 1536,
      }),
    );
    expect(result).toEqual(EMBEDDING);
    expect(generator.config.provider).toBe("openai");
  });
});

describe("VectorMemoryWriteCoordinator", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("retries one transient provider failure and then persists the embedding metadata once", async () => {
    const generator = buildGenerator(
      vi
        .fn()
        .mockRejectedValueOnce(new Error("provider unavailable"))
        .mockResolvedValueOnce(EMBEDDING),
    );
    const repo = {
      create: vi.fn().mockResolvedValue(memoryRow()),
    };
    const coordinator = new VectorMemoryWriteCoordinator(generator, repo as never);

    const result = await coordinator.saveConfirmedMemory(
      { tenantId: TENANT_ID, userId: USER_ID },
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
      },
    );

    await vi.runAllTimersAsync();

    expect(generator.generate).toHaveBeenCalledTimes(2);
    expect(repo.create).toHaveBeenCalledWith(
      { tenantId: TENANT_ID, userId: USER_ID },
      expect.objectContaining({
        embeddingProvider: "openai",
        embeddingModel: "text-embedding-3-small",
        embeddingVersion: "2026-07-22",
        embeddingDimension: 1536,
        embedding: EMBEDDING,
      }),
    );
    expect(result).toEqual({ kind: "stored", record: memoryRow() });
  });

  it.each(["I have sciatica", "I have high cholesterol"])(
    "rejects %s before embedding or persistence",
    async (summary) => {
      const generator = buildGenerator(async () => EMBEDDING);
      const repo = { create: vi.fn() };
      const coordinator = new VectorMemoryWriteCoordinator(generator, repo as never);

      const result = await coordinator.saveConfirmedMemory(
        { tenantId: TENANT_ID, userId: USER_ID },
        {
          summary,
          source: "user_confirmation",
          status: "active",
          eligibility: "eligible",
          consentStatus: "granted",
          consentedAt: new Date("2026-07-22T12:00:00Z"),
          idempotencyKey: "idem-health",
          fingerprint: "fingerprint-health",
          schemaVersion: "1",
        },
      );

      expect(result).toEqual({ kind: "rejected", reason: "sensitive_health" });
      expect(generator.generate).not.toHaveBeenCalled();
      expect(repo.create).not.toHaveBeenCalled();
    },
  );

  it("returns a bounded dimension_mismatch failure without touching persistence", async () => {
    const generator = buildGenerator(async () => [0.1, 0.2]);
    const repo = {
      create: vi.fn(),
    };
    const coordinator = new VectorMemoryWriteCoordinator(generator, repo as never);

    const result = await coordinator.saveConfirmedMemory(
      { tenantId: TENANT_ID, userId: USER_ID },
      {
        summary: "Prefers morning workouts",
        source: "user_confirmation",
        status: "active",
        eligibility: "eligible",
        consentStatus: "granted",
        consentedAt: new Date("2026-07-22T12:00:00Z"),
        idempotencyKey: "idem-2",
        fingerprint: "fingerprint-2",
        schemaVersion: "1",
      },
    );

    expect(result).toEqual({ kind: "failed", reason: "dimension_mismatch" });
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("returns provider_failure after retry exhaustion and leaves idempotent writes untouched", async () => {
    const generator = buildGenerator(async () => {
      throw new Error("provider unavailable");
    });
    const repo = {
      create: vi.fn(),
    };
    const coordinator = new VectorMemoryWriteCoordinator(generator, repo as never);

    const result = await coordinator.saveConfirmedMemory(
      { tenantId: TENANT_ID, userId: USER_ID },
      {
        summary: "Prefers morning workouts",
        source: "user_confirmation",
        status: "active",
        eligibility: "eligible",
        consentStatus: "granted",
        consentedAt: new Date("2026-07-22T12:00:00Z"),
        idempotencyKey: "idem-3",
        fingerprint: "fingerprint-3",
        schemaVersion: "1",
      },
    );

    expect(generator.generate).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ kind: "failed", reason: "provider_failure" });
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("returns the repository result for duplicate retries instead of creating a second active record", async () => {
    const existing = memoryRow({ idempotencyKey: "idem-4", fingerprint: "fingerprint-4" });
    const generator = buildGenerator(async () => EMBEDDING);
    const repo = {
      create: vi.fn().mockResolvedValue(existing),
    };
    const coordinator = new VectorMemoryWriteCoordinator(generator, repo as never);

    const result = await coordinator.saveConfirmedMemory(
      { tenantId: TENANT_ID, userId: USER_ID },
      {
        summary: existing.summary,
        source: existing.source,
        status: "active",
        eligibility: "eligible",
        consentStatus: "granted",
        consentedAt: existing.consentedAt,
        idempotencyKey: existing.idempotencyKey,
        fingerprint: existing.fingerprint,
        schemaVersion: existing.schemaVersion,
      },
    );

    expect(repo.create).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ kind: "stored", record: existing });
  });

  it("fails with bounded timeout exhaustion and never logs the raw memory summary", async () => {
    const sensitiveSummary = "Athlete disclosed recovery notes";
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const consoleInfoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const generator = {
      ...buildGenerator(() => new Promise<number[]>((_resolve) => undefined)),
      config: config({ timeoutMs: 5 }),
    };
    const repo = {
      create: vi.fn(),
    };
    const coordinator = new VectorMemoryWriteCoordinator(generator, repo as never);

    const pending = coordinator.saveConfirmedMemory(
      { tenantId: TENANT_ID, userId: USER_ID },
      {
        summary: sensitiveSummary,
        source: "user_confirmation",
        status: "active",
        eligibility: "eligible",
        consentStatus: "granted",
        consentedAt: new Date("2026-07-22T12:00:00Z"),
        idempotencyKey: "idem-timeout",
        fingerprint: "fingerprint-timeout",
        schemaVersion: "1",
      },
    );

    await vi.advanceTimersByTimeAsync(100);

    await expect(pending).resolves.toEqual({ kind: "failed", reason: "timeout" });
    expect(repo.create).not.toHaveBeenCalled();
    const serializedLogs = [...consoleErrorSpy.mock.calls, ...consoleWarnSpy.mock.calls, ...consoleInfoSpy.mock.calls]
      .flat()
      .map((entry) => (typeof entry === "string" ? entry : JSON.stringify(entry)))
      .join(" ");
    expect(serializedLogs).not.toContain(sensitiveSummary);
  });
});

describe("VectorMemoryRetriever", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("returns active compatible rows for the scoped tenant and user", async () => {
    const generator = buildGenerator(async () => EMBEDDING);
    const repo = {
      searchActiveCompatible: vi.fn().mockResolvedValue([memoryRow()]),
    };
    const retriever = new VectorMemoryRetriever(generator, repo as never);

    const result = await retriever.retrieve(
      { tenantId: TENANT_ID, userId: USER_ID },
      { query: "morning workouts", limit: 3 },
    );

    expect(repo.searchActiveCompatible).toHaveBeenCalledWith(
      { tenantId: TENANT_ID, userId: USER_ID },
      EMBEDDING,
      expect.objectContaining({
        provider: "openai",
        model: "text-embedding-3-small",
        version: "2026-07-22",
        dimension: 1536,
      }),
      3,
    );
    expect(result).toEqual([memoryRow()]);
  });

  it("passes the generated query embedding so the repository can rank by similarity", async () => {
    const queryEmbedding = new Array(1536).fill(0.1);
    queryEmbedding[0] = 0.9;
    const generator = buildGenerator(async () => queryEmbedding);
    const repo = {
      searchActiveCompatible: vi.fn().mockResolvedValue([memoryRow({ id: "closest" })]),
    };
    const retriever = new VectorMemoryRetriever(generator, repo as never);

    await retriever.retrieve(
      { tenantId: TENANT_ID, userId: USER_ID },
      { query: "morning workouts", limit: 1 },
    );

    expect(repo.searchActiveCompatible).toHaveBeenCalledWith(
      { tenantId: TENANT_ID, userId: USER_ID },
      queryEmbedding,
      expect.anything(),
      1,
    );
  });

  it("returns [] for empty queries without touching the provider or repository", async () => {
    const generator = buildGenerator(async () => EMBEDDING);
    const repo = {
      searchActiveCompatible: vi.fn(),
    };
    const retriever = new VectorMemoryRetriever(generator, repo as never);

    const result = await retriever.retrieve(
      { tenantId: TENANT_ID, userId: USER_ID },
      { query: "   " },
    );

    expect(result).toEqual([]);
    expect(generator.generate).not.toHaveBeenCalled();
    expect(repo.searchActiveCompatible).not.toHaveBeenCalled();
  });

  it("fails open to [] on timeout", async () => {
    const generator = buildGenerator(
      () => new Promise<number[]>((_resolve) => undefined),
    );
    const repo = {
      searchActiveCompatible: vi.fn(),
    };
    const retriever = new VectorMemoryRetriever(
      { ...generator, config: config({ timeoutMs: 5 }) },
      repo as never,
    );

    const pending = retriever.retrieve(
      { tenantId: TENANT_ID, userId: USER_ID },
      { query: "morning workouts" },
    );

    await vi.advanceTimersByTimeAsync(3000);

    await expect(pending).resolves.toEqual([]);
    expect(repo.searchActiveCompatible).not.toHaveBeenCalled();
  });

  it("fails open to [] after offline retry exhaustion", async () => {
    const offlineError = Object.assign(new Error("connect ECONNREFUSED"), {
      code: "ECONNREFUSED",
    });
    const generator = buildGenerator(async () => {
      throw offlineError;
    });
    const repo = {
      searchActiveCompatible: vi.fn(),
    };
    const retriever = new VectorMemoryRetriever(generator, repo as never);

    const result = await retriever.retrieve(
      { tenantId: TENANT_ID, userId: USER_ID },
      { query: "morning workouts" },
    );

    expect(generator.generate).toHaveBeenCalledTimes(2);
    expect(result).toEqual([]);
  });

  it("fails open to [] when the embedding dimension is incompatible with the configured model", async () => {
    const generator = buildGenerator(async () => [0.1, 0.2]);
    const repo = {
      searchActiveCompatible: vi.fn(),
    };
    const retriever = new VectorMemoryRetriever(generator, repo as never);

    const result = await retriever.retrieve(
      { tenantId: TENANT_ID, userId: USER_ID },
      { query: "morning workouts" },
    );

    expect(result).toEqual([]);
    expect(repo.searchActiveCompatible).not.toHaveBeenCalled();
  });

  it("fails open after provider retry exhaustion without logging the raw query", async () => {
    const sensitiveQuery = "User secret: prefers 6am knee rehab workouts";
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const consoleInfoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const generator = buildGenerator(async () => {
      throw new Error("provider unavailable");
    });
    const repo = {
      searchActiveCompatible: vi.fn(),
    };
    const retriever = new VectorMemoryRetriever(generator, repo as never);

    const result = await retriever.retrieve(
      { tenantId: TENANT_ID, userId: USER_ID },
      { query: sensitiveQuery },
    );

    expect(generator.generate).toHaveBeenCalledTimes(2);
    expect(result).toEqual([]);
    expect(repo.searchActiveCompatible).not.toHaveBeenCalled();
    const serializedLogs = [...consoleErrorSpy.mock.calls, ...consoleWarnSpy.mock.calls, ...consoleInfoSpy.mock.calls]
      .flat()
      .map((entry) => (typeof entry === "string" ? entry : JSON.stringify(entry)))
      .join(" ");
    expect(serializedLogs).not.toContain(sensitiveQuery);
  });

  it("fails open when repository search rejects without exposing the repository error", async () => {
    const repositoryError = new Error("database connection contains sensitive details");
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const generator = buildGenerator(async () => EMBEDDING);
    const repo = {
      searchActiveCompatible: vi.fn().mockRejectedValue(repositoryError),
    };
    const retriever = new VectorMemoryRetriever(generator, repo as never);

    await expect(
      retriever.retrieve(
        { tenantId: TENANT_ID, userId: USER_ID },
        { query: "morning workouts" },
      ),
    ).resolves.toEqual([]);
    expect(consoleWarnSpy).toHaveBeenCalledWith("Vector memory retrieval failed", {
      errorName: "Error",
    });
    expect(JSON.stringify(consoleWarnSpy.mock.calls)).not.toContain(repositoryError.message);
  });
});
