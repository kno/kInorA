import { afterEach, describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import type { MemorySettings, PlanSpec, UserMemory, WorkoutProgram } from "@kinora/contracts";
import { authPlugin } from "../../auth/plugin.js";
import {
  VALID_TOKEN,
  buildActiveMembershipRow,
  buildSessionRow as buildSharedSessionRow,
  createCyclingAuthMockDb,
} from "../../test-support/auth-mocks.js";
import { userMemoryRoutes } from "../user-memories.js";
import { UserMemoryLifecycleService, type UserMemoryAuditPort } from "../../user-memory/service.js";
import { planRoutes, type PlanRouteRepo } from "../plan.js";
import { PlanGenerationService } from "../../ai/generation-service.js";

const TENANT_ID = "aaaaaaaa-0000-0000-0000-000000000010";
const USER_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const EMBEDDING = new Array(1536).fill(0.1);
const SPEC_ID = "spec-uuid-1";

const confirmedSpec: PlanSpec = {
  goal: "strength",
  daysPerWeek: 3,
  sessionDurationMinutes: 60,
  location: "gym",
  equipment: ["barbell"],
  limitations: [],
  preferenceScores: {
    strength: 0.8,
    hypertrophy: 0.6,
    endurance: 0.2,
    mobility: 0.3,
  },
  confirmed: true,
};

function workoutProgram(title = "Generated plan"): WorkoutProgram {
  return {
    weeklySessions: [
      {
        day: 1,
        title,
        exercises: [{ name: "Squat", sets: 4, reps: "8-12", restSeconds: 90 }],
      },
    ],
    limitationWarnings: [],
  };
}

function buildSessionRow(tenantId = TENANT_ID, userId = USER_ID) {
  return buildSharedSessionRow({ tenantId, userId });
}

type StoredPlan = {
  id: string;
  tenantId: string;
  userId: string;
  planSpecId: string;
  status: "generating" | "ready" | "failed";
  name: string | null;
  programJson: WorkoutProgram | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type StoredMemory = {
  id: string;
  tenantId: string;
  userId: string;
  summary: string;
  source: string;
  status: UserMemory["status"];
  eligibility: UserMemory["eligibility"];
  consentStatus: UserMemory["consentStatus"];
  consentedAt: Date;
  revokedAt: Date | null;
  disabledAt: Date | null;
  deletedAt: Date | null;
  idempotencyKey: string;
  fingerprint: string;
  schemaVersion: string;
  embeddingProvider: string;
  embeddingModel: string;
  embeddingVersion: string;
  embeddingDimension: number;
  embedding: number[];
  createdAt: Date;
  updatedAt: Date;
};

function memorySettings(scope: { tenantId: string; userId: string }, enabled = true): MemorySettings {
  return {
    tenantId: scope.tenantId as MemorySettings["tenantId"],
    userId: scope.userId as MemorySettings["userId"],
    enabled,
    settingsVersion: enabled ? 0 : 1,
    disabledAt: enabled ? null : "2026-07-22T13:00:00.000Z",
    updatedAt: "2026-07-22T13:00:00.000Z",
  };
}

class InMemoryVectorMemoryStore {
  memories: StoredMemory[] = [];
  settings = new Map<string, MemorySettings>();

  private key(scope: { tenantId: string; userId: string }) {
    return `${scope.tenantId}:${scope.userId}`;
  }

  async listByOwner(scope: { tenantId: string; userId: string }) {
    return this.memories.filter(
      (memory) =>
        memory.tenantId === scope.tenantId &&
        memory.userId === scope.userId &&
        memory.deletedAt === null,
    );
  }

  async getSettings(scope: { tenantId: string; userId: string }) {
    return this.settings.get(this.key(scope)) ?? null;
  }

  async setEnabled(scope: { tenantId: string; userId: string }, enabled: boolean) {
    const current = this.settings.get(this.key(scope));
    const next: MemorySettings = {
      ...memorySettings(scope, enabled),
      settingsVersion: (current?.settingsVersion ?? 0) + 1,
    };
    this.settings.set(this.key(scope), next);
    return next;
  }

  async delete(scope: { tenantId: string; userId: string }, id: string) {
    const memory = this.memories.find(
      (entry) =>
        entry.id === id && entry.tenantId === scope.tenantId && entry.userId === scope.userId,
    );
    if (!memory || memory.deletedAt) {
      return { kind: "not_found" as const };
    }
    memory.status = "deleted";
    memory.deletedAt = new Date("2026-07-22T13:30:00.000Z");
    memory.updatedAt = new Date("2026-07-22T13:30:00.000Z");
    return { kind: "deleted" as const };
  }

  async searchActiveCompatible(
    scope: { tenantId: string; userId: string },
    _queryEmbedding: number[],
    compatibility: { provider: string; model: string; version: string; dimension: number },
  ) {
    const settings = await this.getSettings(scope);
    if (settings && !settings.enabled) {
      return [];
    }

    return this.memories.filter(
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
    );
  }

  store(scope: { tenantId: string; userId: string }, input: {
    summary: string;
    source: string;
    idempotencyKey: string;
    fingerprint: string;
    schemaVersion: string;
  }) {
    const existing = this.memories.find(
      (memory) =>
        memory.tenantId === scope.tenantId &&
        memory.userId === scope.userId &&
        memory.deletedAt === null &&
        (memory.idempotencyKey === input.idempotencyKey || memory.fingerprint === input.fingerprint),
    );
    if (existing) {
      return existing;
    }

    const now = new Date("2026-07-22T12:00:00.000Z");
    const record: StoredMemory = {
      id: `mem-${this.memories.length + 1}`,
      tenantId: scope.tenantId,
      userId: scope.userId,
      summary: input.summary,
      source: input.source,
      status: "active",
      eligibility: "eligible",
      consentStatus: "granted",
      consentedAt: now,
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
      embedding: new Array(1536).fill(0.1),
      createdAt: now,
      updatedAt: now,
    };
    this.memories.push(record);
    return record;
  }
}

function createPlanState() {
  const plans: StoredPlan[] = [];
  let sequence = 0;

  return {
    plans,
    generationRepo: {
      createGenerating: vi.fn(async (tenantId: string, userId: string, planSpecId: string) => {
        const row: StoredPlan = {
          id: `plan-${++sequence}`,
          tenantId,
          userId,
          planSpecId,
          status: "generating",
          name: null,
          programJson: null,
          errorMessage: null,
          createdAt: new Date("2026-07-22T12:05:00.000Z"),
          updatedAt: new Date("2026-07-22T12:05:00.000Z"),
        };
        plans.push(row);
        return { id: row.id, status: row.status };
      }),
      markReady: vi.fn(async (tenantId: string, planId: string, program: WorkoutProgram) => {
        const row = plans.find((plan) => plan.id === planId && plan.tenantId === tenantId);
        if (!row) return undefined;
        row.status = "ready";
        row.programJson = program;
        row.updatedAt = new Date("2026-07-22T12:06:00.000Z");
        return { id: row.id, status: row.status };
      }),
      markFailed: vi.fn(async (tenantId: string, planId: string, errorMessage: string) => {
        const row = plans.find((plan) => plan.id === planId && plan.tenantId === tenantId);
        if (!row) return undefined;
        row.status = "failed";
        row.errorMessage = errorMessage;
        row.updatedAt = new Date("2026-07-22T12:06:00.000Z");
        return { id: row.id, status: row.status };
      }),
    },
    routeRepo: {
      upsertDraft: vi.fn(() => {
        throw new Error("unexpected call: upsertDraft");
      }),
      findCurrentDraft: vi.fn(() => {
        throw new Error("unexpected call: findCurrentDraft");
      }),
      promoteDraftToSpec: vi.fn(() => {
        throw new Error("unexpected call: promoteDraftToSpec");
      }),
      findPlanById: vi.fn(async (tenantId: string, userId: string, id: string) => {
        return plans.find(
          (plan) =>
            plan.id === id && plan.tenantId === tenantId && plan.userId === userId,
        );
      }),
      findLatestPlanBySpec: vi.fn(async (tenantId: string, userId: string, specId: string) => {
        return [...plans]
          .filter(
            (plan) =>
              plan.planSpecId === specId &&
              plan.tenantId === tenantId &&
              plan.userId === userId,
          )
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
      }),
      findAllPlansByUser: vi.fn(async () => []),
    } satisfies PlanRouteRepo,
  };
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

async function buildTestApp() {
  const app = Fastify();
  const store = new InMemoryVectorMemoryStore();
  const audit = buildAuditPort();
  const planState = createPlanState();
  const generator = {
    generate: vi.fn(async (spec: PlanSpec & { memoryContext?: string[] }) =>
      workoutProgram(spec.memoryContext?.[0] ?? "Generated plan"),
    ),
  };
  const specRepo = {
    findConfirmedById: vi.fn(async () => ({ specJson: confirmedSpec })),
  };
  const writer = {
    saveConfirmedMemory: vi.fn(async (scope, input) => ({
      kind: "stored" as const,
      record: store.store(scope, input),
    })),
  };
  const retriever = {
    retrieve: vi.fn(async (scope, options: { limit?: number }) =>
      store.searchActiveCompatible(
        scope,
        EMBEDDING,
        {
          provider: "openai",
          model: "text-embedding-3-small",
          version: "text-embedding-3-small",
          dimension: 1536,
        },
        options.limit,
      ),
    ),
  };
  const service = new UserMemoryLifecycleService(store, writer, audit.port);
  const generationService = new PlanGenerationService(
    generator as never,
    specRepo as never,
    planState.generationRepo as never,
    undefined,
    retriever as never,
  );

  app.setErrorHandler((error: unknown, _request, reply) => {
    if (
      typeof error === "object" &&
      error !== null &&
      "validation" in error &&
      Boolean((error as { validation: unknown }).validation)
    ) {
      return reply.code(422).send({ error: "Validation Error" });
    }
    if (
      typeof error === "object" &&
      error !== null &&
      "name" in error &&
      (error as { name?: string }).name === "AuthError"
    ) {
      return reply.code(401).send({ error: (error as Error).message });
    }
    return reply.code(500).send({ error: "Internal Server Error" });
  });

  await app.register(authPlugin, {
    db: createCyclingAuthMockDb({
      sessionRows: [buildSessionRow()],
      membershipRows: [buildActiveMembershipRow({ tenantId: TENANT_ID, userId: USER_ID })],
    }),
  });
  await app.register(userMemoryRoutes, { service });
  await app.register(planRoutes, {
    repo: planState.routeRepo,
    generationService: generationService as never,
  });

  return { app, generator, planState, store };
}

describe("plan generation memory flow", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    vi.clearAllMocks();
    await app?.close();
  });

  it("uses an explicitly confirmed memory from the authenticated route in generated plan context", async () => {
    const built = await buildTestApp();
    app = built.app;

    const memoryResponse = await app.inject({
      method: "POST",
      url: "/user-memories",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: {
        factText: "Prefers morning workouts",
        source: "user_confirmation",
        idempotencyKey: "idem-memory-1",
      },
    });

    expect(memoryResponse.statusCode).toBe(200);

    const generationResponse = await app.inject({
      method: "POST",
      url: `/plan-specs/${SPEC_ID}/confirm`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(generationResponse.statusCode).toBe(200);
    await vi.waitFor(() => expect(built.planState.generationRepo.markReady).toHaveBeenCalledTimes(1));

    const planId = generationResponse.json<{ planId: string }>().planId;
    const planResponse = await app.inject({
      method: "GET",
      url: `/workout-plans/${planId}`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(planResponse.statusCode).toBe(200);
    expect(planResponse.json().program.weeklySessions[0].title).toBe("Prefers morning workouts");
    expect(built.generator.generate).toHaveBeenCalledWith(
      expect.objectContaining({ memoryContext: ["Prefers morning workouts"] }),
    );
  });

  it("falls back to the default generated plan after the user disables memory retrieval", async () => {
    const built = await buildTestApp();
    app = built.app;

    await app.inject({
      method: "POST",
      url: "/user-memories",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: {
        factText: "Prefers morning workouts",
        source: "user_confirmation",
        idempotencyKey: "idem-memory-2",
      },
    });

    const disableResponse = await app.inject({
      method: "PATCH",
      url: "/user-memories/settings",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: { enabled: false },
    });

    expect(disableResponse.statusCode).toBe(200);

    const generationResponse = await app.inject({
      method: "POST",
      url: `/plan-specs/${SPEC_ID}/confirm`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(generationResponse.statusCode).toBe(200);
    await vi.waitFor(() => expect(built.planState.generationRepo.markReady).toHaveBeenCalledTimes(1));

    const planId = generationResponse.json<{ planId: string }>().planId;
    const planResponse = await app.inject({
      method: "GET",
      url: `/workout-plans/${planId}`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(planResponse.statusCode).toBe(200);
    expect(planResponse.json().program.weeklySessions[0].title).toBe("Generated plan");
    expect(built.generator.generate).toHaveBeenCalledWith(
      expect.not.objectContaining({ memoryContext: expect.anything() }),
    );
  });
});
