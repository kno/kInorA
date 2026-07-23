import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import type { MemorySettings, UserMemory } from "@kinora/contracts";
import { authPlugin } from "../../auth/plugin.js";
import { userMemoryRoutes } from "../user-memories.js";
import {
  UserMemoryLifecycleService,
  classifyEligibility,
  type UserMemoryAuditPort,
} from "../../user-memory/service.js";
import { VectorMemoryRetriever } from "../../ai/memory-retriever.js";
import {
  VALID_TOKEN,
  buildActiveMembershipRow,
  buildSessionRow,
  createCyclingAuthMockDb,
} from "../../test-support/auth-mocks.js";

const TENANT_A = "aaaaaaaa-0000-0000-0000-000000000010";
const TENANT_B = "bbbbbbbb-0000-0000-0000-000000000020";
const USER_A = "aaaaaaaa-0000-0000-0000-000000000001";
const USER_B = "bbbbbbbb-0000-0000-0000-000000000002";
const EMBEDDING = new Array(1536).fill(0.1);

function authDb(tenantId = TENANT_A, userId = USER_A) {
  return createCyclingAuthMockDb({
    sessionRows: [buildSessionRow({ tenantId, userId })],
    membershipRows: [buildActiveMembershipRow({ tenantId, userId })],
  });
}

function memoryRow(overrides: Partial<UserMemory> = {}): UserMemory {
  return {
    id: "mem-1",
    tenantId: TENANT_A as UserMemory["tenantId"],
    userId: USER_A as UserMemory["userId"],
    summary: "Prefers morning workouts",
    source: "user_confirmation",
    status: "active",
    eligibility: "eligible",
    consentStatus: "granted",
    consentedAt: "2026-07-22T12:00:00.000Z",
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
    createdAt: "2026-07-22T12:00:00.000Z",
    updatedAt: "2026-07-22T12:00:00.000Z",
    ...overrides,
  };
}

function settingsRow(overrides: Partial<MemorySettings> = {}): MemorySettings {
  return {
    tenantId: TENANT_A as MemorySettings["tenantId"],
    userId: USER_A as MemorySettings["userId"],
    enabled: true,
    settingsVersion: 1,
    disabledAt: null,
    updatedAt: "2026-07-22T12:00:00.000Z",
    ...overrides,
  };
}

class InMemoryVectorMemoryStore {
  memories: UserMemory[] = [];
  settings = new Map<string, MemorySettings>();

  listByOwner = vi.fn(async (scope: { tenantId: string; userId: string }) =>
    this.memories.filter(
      (memory) =>
        memory.tenantId === scope.tenantId &&
        memory.userId === scope.userId &&
        memory.deletedAt === null,
    ),
  );

  getSettings = vi.fn(async (scope: { tenantId: string; userId: string }) => {
    return this.settings.get(`${scope.tenantId}:${scope.userId}`) ?? null;
  });

  setEnabled = vi.fn(async (scope: { tenantId: string; userId: string }, enabled: boolean) => {
    const current = this.settings.get(`${scope.tenantId}:${scope.userId}`);
    const next = settingsRow({
      tenantId: scope.tenantId as MemorySettings["tenantId"],
      userId: scope.userId as MemorySettings["userId"],
      enabled,
      settingsVersion: (current?.settingsVersion ?? 0) + 1,
      disabledAt: enabled ? null : new Date("2026-07-22T13:00:00.000Z").toISOString(),
      updatedAt: new Date("2026-07-22T13:00:00.000Z").toISOString(),
    });
    this.settings.set(`${scope.tenantId}:${scope.userId}`, next);
    return next;
  });

  delete = vi.fn(async (scope: { tenantId: string; userId: string }, id: string) => {
    const memory = this.memories.find(
      (entry) =>
        entry.id === id && entry.tenantId === scope.tenantId && entry.userId === scope.userId,
    );
    if (!memory || memory.deletedAt) {
      return { kind: "not_found" as const };
    }
    memory.summary = "[deleted]";
    memory.source = "[deleted]";
    memory.status = "deleted";
    memory.deletedAt = "2026-07-22T13:00:00.000Z";
    memory.disabledAt = null;
    return { kind: "deleted" as const };
  });

  searchActiveCompatible = vi.fn(
    async (
      scope: { tenantId: string; userId: string },
      _queryEmbedding: number[],
      compatibility: {
        provider: string;
        model: string;
        version: string;
        dimension: number;
      },
    ) => {
      const settings = await this.getSettings(scope);
      if (settings && !settings.enabled) {
        return [];
      }

      return this.memories
        .filter(
          (memory) =>
            memory.tenantId === scope.tenantId &&
            memory.userId === scope.userId &&
            memory.status === "active" &&
            memory.deletedAt === null &&
            memory.disabledAt === null &&
            memory.embeddingProvider === compatibility.provider &&
            memory.embeddingModel === compatibility.model &&
            memory.embeddingVersion === compatibility.version &&
            memory.embeddingDimension === compatibility.dimension,
        )
        .map((memory) => ({
          ...memory,
          consentedAt: new Date(memory.consentedAt),
          revokedAt: memory.revokedAt ? new Date(memory.revokedAt) : null,
          disabledAt: memory.disabledAt ? new Date(memory.disabledAt) : null,
          deletedAt: memory.deletedAt ? new Date(memory.deletedAt) : null,
          createdAt: new Date(memory.createdAt),
          updatedAt: new Date(memory.updatedAt),
          embedding: EMBEDDING,
        }));
    },
  );

  storeFromInput(scope: { tenantId: string; userId: string }, input: {
    summary: string;
    source: string;
    idempotencyKey: string;
    fingerprint: string;
  }): UserMemory {
    const existing = this.memories.find(
      (memory) =>
        memory.tenantId === scope.tenantId &&
        memory.userId === scope.userId &&
        (memory.idempotencyKey === input.idempotencyKey || memory.fingerprint === input.fingerprint) &&
        memory.deletedAt === null,
    );
    if (existing) {
      return existing;
    }

    const stored = memoryRow({
      id: `mem-${this.memories.length + 1}`,
      tenantId: scope.tenantId as UserMemory["tenantId"],
      userId: scope.userId as UserMemory["userId"],
      summary: input.summary,
      source: input.source,
      idempotencyKey: input.idempotencyKey,
      fingerprint: input.fingerprint,
    });
    this.memories.push(stored);
    return stored;
  }
}

function buildAuditPort() {
  const events: unknown[] = [];
  const port: UserMemoryAuditPort = {
    record: vi.fn(async (event) => {
      events.push(event);
    }),
  };
  return { port, events };
}

type ConsumeDecisionLike =
  | { allowed: true; tier: "free" | "pro"; source: string; period: string; replayed?: boolean }
  | { allowed: false; reason: string };

async function buildTestApp(options?: {
  tenantId?: string;
  userId?: string;
  store?: InMemoryVectorMemoryStore;
  writerResult?: "stored" | "provider_failure" | "timeout" | "throws";
  audit?: ReturnType<typeof buildAuditPort>;
  billingDecision?: ConsumeDecisionLike | (() => Promise<ConsumeDecisionLike>);
  refundThrows?: boolean;
}): Promise<{
  app: FastifyInstance;
  store: InMemoryVectorMemoryStore;
  audit: ReturnType<typeof buildAuditPort>;
  writer: { saveConfirmedMemory: ReturnType<typeof vi.fn> };
  billing:
    | { checkAndConsume: ReturnType<typeof vi.fn>; refund: ReturnType<typeof vi.fn> }
    | undefined;
}> {
  const store = options?.store ?? new InMemoryVectorMemoryStore();
  const audit = options?.audit ?? buildAuditPort();

  const writer = {
    saveConfirmedMemory: vi.fn(async (scope, input) => {
      if (options?.writerResult === "provider_failure") {
        return { kind: "failed" as const, reason: "provider_failure" as const };
      }
      if (options?.writerResult === "timeout") {
        return { kind: "failed" as const, reason: "timeout" as const };
      }
      if (options?.writerResult === "throws") {
        throw new Error("vector store outage");
      }

      return {
        kind: "stored" as const,
        record: {
          id: store.storeFromInput(scope, input).id,
          tenantId: scope.tenantId,
          userId: scope.userId,
          summary: input.summary,
          source: input.source,
          status: "active",
          eligibility: "eligible",
          consentStatus: "granted",
          consentedAt: input.consentedAt,
          revokedAt: null,
          disabledAt: null,
          deletedAt: null,
          idempotencyKey: input.idempotencyKey,
          fingerprint: input.fingerprint,
          schemaVersion: input.schemaVersion,
          embeddingProvider: "openai",
          embeddingModel: "text-embedding-3-small",
          embeddingVersion: "text-embedding-3-small",
          embeddingDimension: 1536,
          embedding: EMBEDDING,
          createdAt: new Date("2026-07-22T12:00:00.000Z"),
          updatedAt: new Date("2026-07-22T12:00:00.000Z"),
        },
      };
    }),
  };

  const app = Fastify();
  app.setErrorHandler((error: unknown, _request, reply) => {
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

  let billing:
    | { checkAndConsume: ReturnType<typeof vi.fn>; refund: ReturnType<typeof vi.fn> }
    | undefined;
  if (options?.billingDecision !== undefined) {
    const decide = options.billingDecision;
    billing = {
      checkAndConsume: vi.fn(async () =>
        typeof decide === "function" ? await decide() : decide,
      ),
      refund: vi.fn(async () => {
        if (options?.refundThrows) {
          throw new Error("refund backend unavailable");
        }
      }),
    };
  }

  await app.register(authPlugin, {
    db: authDb(options?.tenantId, options?.userId),
  });
  await app.register(userMemoryRoutes, {
    service: new UserMemoryLifecycleService(
      store as never,
      writer as never,
      audit.port,
      billing as never,
    ),
  });

  return { app, store, audit, writer, billing };
}

describe("userMemoryRoutes", () => {
  it.each([
    "I have sciatica",
    "I have arthritis",
    "I had surgery",
    "I have a fracture",
    "I had a stroke",
    "I have hypertension",
    "I have asthma",
    "I have an injury",
    "I have pain",
    "I need rehab",
    "I have a hernia",
    "I take medication",
    "I have diabetes",
    "I have high blood pressure",
    "I have a torn ACL",
    "I am allergic to peanuts",
    "I have a migraine",
    "I have epilepsy",
     "I have celiac disease",
     "I have osteoporosis",
     "I have high cholesterol",
    "I have a heart condition",
    "I have a chronic condition",
    "I am pregnant",
    "My medical history is complex",
    "I have an unknown syndrome",
  ])("classifies %s as sensitive health and never as eligible", (fact) => {
    expect(classifyEligibility(fact)).toBe("sensitive_health");
  });

  it("keeps normal workout preferences eligible", () => {
    expect(classifyEligibility("Prefers morning workouts")).toBe("eligible");
  });

  let app: FastifyInstance;

  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(async () => {
    await app?.close();
  });

  it("returns 401 without authentication", async () => {
    ({ app } = await buildTestApp());

    const response = await app.inject({ method: "GET", url: "/user-memories" });

    expect(response.statusCode).toBe(401);
  });

  it("returns an empty, enabled response contract when no memories exist", async () => {
    ({ app } = await buildTestApp());

    const response = await app.inject({
      method: "GET",
      url: "/user-memories",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(
      expect.objectContaining({
        settings: expect.objectContaining({
          tenantId: TENANT_A,
          userId: USER_A,
          enabled: true,
          settingsVersion: 0,
          disabledAt: null,
        }),
        memories: [],
      }),
    );
  });

  it("creates one eligible confirmed memory and exposes it in the review list", async () => {
    const built = await buildTestApp();
    app = built.app;

    const createResponse = await app.inject({
      method: "POST",
      url: "/user-memories",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: {
        factText: "Prefers morning workouts",
        source: "user_confirmation",
        idempotencyKey: "idem-1",
      },
    });

    expect(createResponse.statusCode).toBe(200);
    expect(createResponse.json().memory.summary).toBe("Prefers morning workouts");

    const listResponse = await app.inject({
      method: "GET",
      url: "/user-memories",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json().memories).toHaveLength(1);
    expect(listResponse.json().memories[0].summary).toBe("Prefers morning workouts");
  });

  it.each(["I have celiac disease", "I have osteoporosis", "I have high cholesterol"])(
    "rejects %s before embedding or persistence",
    async (fact) => {
      const built = await buildTestApp();
      app = built.app;

      const response = await app.inject({
        method: "POST",
        url: "/user-memories",
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
        payload: { factText: fact, source: "user_confirmation", idempotencyKey: "idem-health" },
      });

      expect(response.statusCode).toBe(422);
      expect(response.json()).toEqual({ error: "memory_ineligible", reason: "sensitive_health" });
      expect(built.writer.saveConfirmedMemory).not.toHaveBeenCalled();
      expect(built.store.memories).toHaveLength(0);
    },
  );

  it("rejects sensitive or secret content with safe feedback and non-sensitive audit metadata", async () => {
    const built = await buildTestApp();
    app = built.app;

    const sensitiveText = "My API key is sk-secret and my password is hunter2";
    const response = await app.inject({
      method: "POST",
      url: "/user-memories",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: {
        factText: sensitiveText,
        source: "user_confirmation",
        idempotencyKey: "idem-secret",
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({
      error: "memory_ineligible",
      reason: "secret",
    });
    expect(JSON.stringify(built.audit.events)).not.toContain(sensitiveText);
    expect(JSON.stringify(built.audit.events)).toContain("secret");
  });

  it("is idempotent for duplicate confirmed saves in the same tenant and user scope", async () => {
    const built = await buildTestApp();
    app = built.app;

    const payload = {
      factText: "Prefers morning workouts",
      source: "user_confirmation",
      idempotencyKey: "idem-duplicate",
    };

    const first = await app.inject({
      method: "POST",
      url: "/user-memories",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload,
    });
    const second = await app.inject({
      method: "POST",
      url: "/user-memories",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload,
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json().memory.id).toBe(first.json().memory.id);
    expect(built.store.memories).toHaveLength(1);
  });

  it("enforces tenant and user isolation for review and delete operations", async () => {
    const sharedStore = new InMemoryVectorMemoryStore();
    sharedStore.memories.push(
      memoryRow({ id: "mem-a", tenantId: TENANT_A as never, userId: USER_A as never }),
      memoryRow({ id: "mem-b", tenantId: TENANT_B as never, userId: USER_A as never }),
      memoryRow({ id: "mem-c", tenantId: TENANT_A as never, userId: USER_B as never }),
    );

    const built = await buildTestApp({ tenantId: TENANT_A, userId: USER_B, store: sharedStore });
    app = built.app;

    const listResponse = await app.inject({
      method: "GET",
      url: "/user-memories",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });
    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json().memories).toHaveLength(1);
    expect(listResponse.json().memories[0].id).toBe("mem-c");

    const deleteResponse = await app.inject({
      method: "DELETE",
      url: "/user-memories/mem-a",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });
    expect(deleteResponse.statusCode).toBe(404);
  });

  it("disables new writes for the authenticated scope and returns the updated settings", async () => {
    const built = await buildTestApp();
    app = built.app;

    const toggleResponse = await app.inject({
      method: "PATCH",
      url: "/user-memories/settings",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: { enabled: false },
    });

    expect(toggleResponse.statusCode).toBe(200);
    expect(toggleResponse.json().enabled).toBe(false);

    const createResponse = await app.inject({
      method: "POST",
      url: "/user-memories",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: {
        factText: "Prefers morning workouts",
        source: "user_confirmation",
        idempotencyKey: "idem-disabled",
      },
    });

    expect(createResponse.statusCode).toBe(409);
    expect(createResponse.json()).toEqual({ error: "memory_disabled" });
  });

  it("returns safe provider failure feedback without exposing raw memory content", async () => {
    const built = await buildTestApp({ writerResult: "provider_failure" });
    app = built.app;

    const sensitiveText = "Prefers 6am workouts on weekdays";
    const response = await app.inject({
      method: "POST",
      url: "/user-memories",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: {
        factText: sensitiveText,
        source: "user_confirmation",
        idempotencyKey: "idem-provider-failure",
      },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "memory_unavailable" });
    expect(JSON.stringify(built.audit.events)).not.toContain(sensitiveText);
  });

  it("returns safe timeout feedback without exposing raw memory content", async () => {
    const built = await buildTestApp({ writerResult: "timeout" });
    app = built.app;

    const memoryText = "Prefers early afternoon workouts";
    const response = await app.inject({
      method: "POST",
      url: "/user-memories",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: {
        factText: memoryText,
        source: "user_confirmation",
        idempotencyKey: "idem-timeout",
      },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "memory_unavailable" });
    expect(JSON.stringify(built.audit.events)).not.toContain(memoryText);
  });

  it("delete invalidates retrieval", async () => {
    const built = await buildTestApp();
    app = built.app;

    const createResponse = await app.inject({
      method: "POST",
      url: "/user-memories",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: {
        factText: "Prefers morning workouts",
        source: "user_confirmation",
        idempotencyKey: "idem-delete",
      },
    });
    const memoryId = createResponse.json().memory.id as string;

    const retriever = new VectorMemoryRetriever(
      {
        config: {
          provider: "openai",
          model: "text-embedding-3-small",
          version: "text-embedding-3-small",
          dimension: 1536,
          timeoutMs: 50,
          maxAttempts: 1,
        },
        generate: vi.fn(async () => EMBEDDING),
      },
      built.store as never,
    );

    await expect(
      retriever.retrieve(
        { tenantId: TENANT_A, userId: USER_A },
        { query: "morning workouts", limit: 3 },
      ),
    ).resolves.toHaveLength(1);

    const deleteResponse = await app.inject({
      method: "DELETE",
      url: `/user-memories/${memoryId}`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });
    expect(deleteResponse.statusCode).toBe(200);

    await expect(
      retriever.retrieve(
        { tenantId: TENANT_A, userId: USER_A },
        { query: "morning workouts", limit: 3 },
      ),
    ).resolves.toEqual([]);
  });

  // 11a billing — premium memory WRITE gating. The write embeds (provider cost)
  // and stores a vector row, so it MUST be entitlement/quota-gated BEFORE any
  // embedding, exactly like plan generation. A denial returns 403 and creates
  // NO memory row and triggers NO embedding.
  it("denies a Free-tier memory write with 403 and never embeds or persists", async () => {
    const built = await buildTestApp({
      billingDecision: { allowed: false, reason: "premium_required" },
    });
    app = built.app;

    const response = await app.inject({
      method: "POST",
      url: "/user-memories",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: {
        factText: "Prefers morning workouts",
        source: "user_confirmation",
        idempotencyKey: "idem-free",
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "premium_required" });
    expect(built.billing?.checkAndConsume).toHaveBeenCalledWith(
      { tenantId: TENANT_A, userId: USER_A },
      "memory_write",
      expect.any(String),
    );
    expect(built.writer.saveConfirmedMemory).not.toHaveBeenCalled();
    expect(built.store.memories).toHaveLength(0);
  });

  it("denies an expired-trial memory write with 403 (trial_expired) and never embeds", async () => {
    const built = await buildTestApp({
      billingDecision: { allowed: false, reason: "trial_expired" },
    });
    app = built.app;

    const response = await app.inject({
      method: "POST",
      url: "/user-memories",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: {
        factText: "Prefers morning workouts",
        source: "user_confirmation",
        idempotencyKey: "idem-trial",
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "trial_expired" });
    expect(built.writer.saveConfirmedMemory).not.toHaveBeenCalled();
    expect(built.store.memories).toHaveLength(0);
  });

  it("denies a suspended membership memory write with 403 (fail-closed) and never embeds", async () => {
    const built = await buildTestApp({
      billingDecision: { allowed: false, reason: "inactive_membership" },
    });
    app = built.app;

    const response = await app.inject({
      method: "POST",
      url: "/user-memories",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: {
        factText: "Prefers morning workouts",
        source: "user_confirmation",
        idempotencyKey: "idem-suspended",
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "inactive_membership" });
    expect(built.writer.saveConfirmedMemory).not.toHaveBeenCalled();
    expect(built.store.memories).toHaveLength(0);
  });

  it("fails closed (no embed, no row) when the write billing gate throws", async () => {
    const built = await buildTestApp({
      billingDecision: async () => {
        throw new Error("billing backend unavailable");
      },
    });
    app = built.app;

    const response = await app.inject({
      method: "POST",
      url: "/user-memories",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: {
        factText: "Prefers morning workouts",
        source: "user_confirmation",
        idempotencyKey: "idem-gate-error",
      },
    });

    expect(response.statusCode).toBe(500);
    expect(built.writer.saveConfirmedMemory).not.toHaveBeenCalled();
    expect(built.store.memories).toHaveLength(0);
  });

  it("allows an entitled (Pro) memory write to embed, store, and return 200", async () => {
    const built = await buildTestApp({
      billingDecision: { allowed: true, tier: "pro", source: "system", period: "2026-07" },
    });
    app = built.app;

    const response = await app.inject({
      method: "POST",
      url: "/user-memories",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: {
        factText: "Prefers morning workouts",
        source: "user_confirmation",
        idempotencyKey: "idem-pro",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().memory.summary).toBe("Prefers morning workouts");
    expect(built.billing?.checkAndConsume).toHaveBeenCalledTimes(1);
    expect(built.writer.saveConfirmedMemory).toHaveBeenCalledTimes(1);
    expect(built.store.memories).toHaveLength(1);
  });

  // 11a billing (Round 2) — the memory_write unit must be consumed ONLY for a
  // write that actually reaches embed+store. Eligibility and disabled-settings
  // checks precede the consume, so a rejected/disabled write consumes NOTHING.
  it("does NOT consume a memory_write unit when content is ineligible (eligibility precedes billing)", async () => {
    const built = await buildTestApp({
      billingDecision: { allowed: true, tier: "pro", source: "system", period: "2026-07" },
    });
    app = built.app;

    const response = await app.inject({
      method: "POST",
      url: "/user-memories",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: {
        factText: "I have diabetes",
        source: "user_confirmation",
        idempotencyKey: "idem-inelig",
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({ error: "memory_ineligible", reason: "sensitive_health" });
    // The unit must NOT be spent on content that stores nothing.
    expect(built.billing?.checkAndConsume).not.toHaveBeenCalled();
    expect(built.writer.saveConfirmedMemory).not.toHaveBeenCalled();
    expect(built.store.memories).toHaveLength(0);
  });

  it("does NOT consume a memory_write unit when memory is disabled (enabled-check precedes billing)", async () => {
    const store = new InMemoryVectorMemoryStore();
    store.settings.set(`${TENANT_A}:${USER_A}`, settingsRow({ enabled: false }));
    const built = await buildTestApp({
      store,
      billingDecision: { allowed: true, tier: "pro", source: "system", period: "2026-07" },
    });
    app = built.app;

    const response = await app.inject({
      method: "POST",
      url: "/user-memories",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: {
        factText: "Prefers morning workouts",
        source: "user_confirmation",
        idempotencyKey: "idem-disabled-billing",
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "memory_disabled" });
    expect(built.billing?.checkAndConsume).not.toHaveBeenCalled();
    expect(built.writer.saveConfirmedMemory).not.toHaveBeenCalled();
    expect(built.store.memories).toHaveLength(0);
  });

  // Store-failure placement: the consume MUST precede embed+store so a
  // Free/exhausted tenant can never trigger embedding cost (the CRITICAL
  // invariant). Consuming before embed reserves the unit, so a terminal
  // provider/store failure would otherwise permanently spend a unit that
  // stored nothing. #174 compensation: a FRESH consume followed by a terminal
  // store failure MUST release the reserved unit (refund), so a fact that is
  // never retried does not leak a unit. Consume still runs exactly once, before
  // the failed store.
  it("consumes exactly once before embed, then RELEASES the unit when the store fails (503)", async () => {
    const built = await buildTestApp({
      writerResult: "provider_failure",
      billingDecision: { allowed: true, tier: "pro", source: "system", period: "2026-07", replayed: false },
    });
    app = built.app;

    const response = await app.inject({
      method: "POST",
      url: "/user-memories",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: {
        factText: "Prefers morning workouts",
        source: "user_confirmation",
        idempotencyKey: "idem-store-fail",
      },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "memory_unavailable" });
    expect(built.billing?.checkAndConsume).toHaveBeenCalledTimes(1);
    // #174: the freshly consumed unit is compensated because nothing was stored.
    expect(built.billing?.refund).toHaveBeenCalledTimes(1);
    // #174 FIX B: refund MUST be called with the DECISION's own resolved
    // period — never a freshly re-derived one — so a boundary crossing
    // between consume and void can never leak the OLD period's unit.
    expect(built.billing?.refund).toHaveBeenCalledWith(
      { tenantId: TENANT_A, userId: USER_A },
      "memory_write",
      expect.any(String),
      "2026-07",
    );
    expect(built.store.memories).toHaveLength(0);
  });

  it("RELEASES the unit when the writer THROWS a terminal outage, then propagates 500", async () => {
    const built = await buildTestApp({
      writerResult: "throws",
      billingDecision: { allowed: true, tier: "pro", source: "system", period: "2026-07", replayed: false },
    });
    app = built.app;

    const response = await app.inject({
      method: "POST",
      url: "/user-memories",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: {
        factText: "Prefers morning workouts",
        source: "user_confirmation",
        idempotencyKey: "idem-store-throw",
      },
    });

    expect(response.statusCode).toBe(500);
    expect(built.billing?.refund).toHaveBeenCalledTimes(1);
    expect(built.store.memories).toHaveLength(0);
  });

  it("does NOT release the unit on a successful store (no spurious refund)", async () => {
    const built = await buildTestApp({
      billingDecision: { allowed: true, tier: "pro", source: "system", period: "2026-07", replayed: false },
    });
    app = built.app;

    const response = await app.inject({
      method: "POST",
      url: "/user-memories",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: {
        factText: "Prefers morning workouts",
        source: "user_confirmation",
        idempotencyKey: "idem-success-norefund",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(built.billing?.checkAndConsume).toHaveBeenCalledTimes(1);
    expect(built.billing?.refund).not.toHaveBeenCalled();
    expect(built.store.memories).toHaveLength(1);
  });

  it("does NOT release a REPLAYED decision's unit on store failure (it belongs to another attempt)", async () => {
    const built = await buildTestApp({
      writerResult: "provider_failure",
      // A concurrent/prior attempt already consumed this unit; THIS call only
      // replayed the allowed decision, so it must never void that unit.
      billingDecision: { allowed: true, tier: "pro", source: "system", period: "2026-07", replayed: true },
    });
    app = built.app;

    const response = await app.inject({
      method: "POST",
      url: "/user-memories",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: {
        factText: "Prefers morning workouts",
        source: "user_confirmation",
        idempotencyKey: "idem-replayed-fail",
      },
    });

    expect(response.statusCode).toBe(503);
    expect(built.billing?.checkAndConsume).toHaveBeenCalledTimes(1);
    expect(built.billing?.refund).not.toHaveBeenCalled();
    expect(built.store.memories).toHaveLength(0);
  });

  it("still returns 503 when a best-effort refund itself fails (self-heals via deterministic retry)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const built = await buildTestApp({
        writerResult: "provider_failure",
        refundThrows: true,
        billingDecision: { allowed: true, tier: "pro", source: "system", period: "2026-07", replayed: false },
      });
      app = built.app;

      const sensitiveText = "Prefers 5am hot yoga on weekdays";
      const response = await app.inject({
        method: "POST",
        url: "/user-memories",
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
        payload: {
          factText: sensitiveText,
          source: "user_confirmation",
          idempotencyKey: "idem-refund-fail",
        },
      });

      // A failed refund must NOT crash the request: it degrades to the prior
      // self-healing behavior (the ledger row survives → a retry replays).
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ error: "memory_unavailable" });
      expect(built.billing?.refund).toHaveBeenCalledTimes(1);

      // #174 FIX C: the failed-void log MUST carry enough scope to find the
      // un-refunded unit (tenant/user/operationKey/feature/period) — plain
      // error.name alone is not actionable — and MUST NOT leak the raw fact
      // text, the auth token, or any other PII.
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const [, meta] = warnSpy.mock.calls[0]!;
      expect(meta).toMatchObject({
        tenantId: TENANT_A,
        userId: USER_A,
        feature: "memory_write",
        period: "2026-07",
        operationKey: expect.any(String),
      });
      const serializedLog = JSON.stringify(warnSpy.mock.calls[0]);
      expect(serializedLog).not.toContain(sensitiveText);
      expect(serializedLog).not.toContain(VALID_TOKEN);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("logs a structured success entry when a compensating void completes (reconciliation)", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      const built = await buildTestApp({
        writerResult: "provider_failure",
        billingDecision: { allowed: true, tier: "pro", source: "system", period: "2026-07", replayed: false },
      });
      app = built.app;

      await app.inject({
        method: "POST",
        url: "/user-memories",
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
        payload: {
          factText: "Prefers early evening sessions",
          source: "user_confirmation",
          idempotencyKey: "idem-refund-success-log",
        },
      });

      const voidLog = infoSpy.mock.calls.find(
        (call) => typeof call[0] === "string" && call[0].includes("memory_write void"),
      );
      expect(voidLog).toBeDefined();
      expect(voidLog?.[1]).toMatchObject({
        tenantId: TENANT_A,
        userId: USER_A,
        feature: "memory_write",
        period: "2026-07",
        operationKey: expect.any(String),
      });
    } finally {
      infoSpy.mockRestore();
    }
  });
});
