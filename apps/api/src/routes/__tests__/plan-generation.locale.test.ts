import { afterEach, describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import type { PlanSpec, WorkoutProgram } from "@kinora/contracts";
import { authPlugin } from "../../auth/plugin.js";
import {
  VALID_TOKEN,
  buildActiveMembershipRow,
  buildSessionRow,
  createCyclingAuthMockDb,
} from "../../test-support/auth-mocks.js";
import { planRoutes, type PlanRouteRepo } from "../plan.js";
import { PlanGenerationService } from "../../ai/generation-service.js";

/**
 * #260 — end-to-end locale threading for the DETERMINISTIC limitation
 * warnings. Wires a REAL PlanGenerationService (not a mock) so the full
 * confirm → generate → drop-LLM-warnings → localized-inject → markReady
 * pipeline runs against the HTTP route, then asserts the PERSISTED program's
 * warnings match the `x-kinora-locale` header.
 */

const TENANT_ID = "aaaaaaaa-0000-0000-0000-000000000010";
const USER_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const SPEC_ID = "spec-uuid-1";

const confirmedSpec: PlanSpec = {
  goal: "strength",
  daysPerWeek: 1,
  sessionDurationMinutes: 60,
  location: "gym",
  equipment: ["barbell"],
  limitations: [{ text: "dolor lumbar", isWarning: true }],
  preferenceScores: { strength: 0.8, hypertrophy: 0.6, endurance: 0.2, mobility: 0.3 },
  confirmed: true,
};

interface StoredPlan {
  id: string;
  tenantId: string;
  userId: string;
  planSpecId: string;
  status: string;
  programJson: WorkoutProgram | null;
}

function buildPlanState() {
  const plans: StoredPlan[] = [];
  let seq = 0;
  return {
    plans,
    generationRepo: {
      createGenerating: vi.fn(async (tenantId: string, userId: string, planSpecId: string) => {
        const row: StoredPlan = {
          id: `plan-${++seq}`,
          tenantId,
          userId,
          planSpecId,
          status: "generating",
          programJson: null,
        };
        plans.push(row);
        return { id: row.id, status: row.status };
      }),
      markReady: vi.fn(async (tenantId: string, planId: string, program: WorkoutProgram) => {
        const row = plans.find((p) => p.id === planId && p.tenantId === tenantId);
        if (!row) return undefined;
        row.status = "ready";
        row.programJson = program;
        return { id: row.id, status: row.status };
      }),
      markFailed: vi.fn(async () => ({ id: "x", status: "failed" })),
    },
    routeRepo: {
      upsertDraft: vi.fn(),
      commitDraft: vi.fn(),
      findCurrentDraft: vi.fn(),
      promoteDraftToSpec: vi.fn(),
      findPlanById: vi.fn(),
      findLatestPlanBySpec: vi.fn(),
      findAllPlansByUser: vi.fn(async () => []),
    } as unknown as PlanRouteRepo,
  };
}

async function buildTestApp() {
  const app = Fastify();
  const planState = buildPlanState();
  // The raw LLM program carries an English warning the model authored — the
  // pipeline must DROP it and replace it with the locale-correct one.
  const generator = {
    generate: vi.fn(async (): Promise<WorkoutProgram> => ({
      weeklySessions: [
        { day: 1, title: "Full Body", exercises: [{ name: "Squat", sets: 4, reps: "8-12", restSeconds: 90 }] },
      ],
      limitationWarnings: [
        "Limitation: dolor lumbar — Consult a professional before attempting exercises that stress this area.",
      ],
    })),
  };
  const specRepo = { findConfirmedById: vi.fn(async () => ({ specJson: confirmedSpec })) };
  const generationService = new PlanGenerationService(
    generator as never,
    specRepo as never,
    planState.generationRepo as never,
  );

  app.setErrorHandler((error: unknown, _request, reply) => {
    if (typeof error === "object" && error !== null && "name" in error && (error as { name?: string }).name === "AuthError") {
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
  await app.register(planRoutes, {
    repo: planState.routeRepo,
    generationService: generationService as never,
  });

  return { app, planState };
}

describe("#260 plan generation — localized limitation warnings end-to-end", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    vi.clearAllMocks();
    await app?.close();
  });

  it("persists SPANISH warnings when x-kinora-locale: es (LLM English warning dropped)", async () => {
    const built = await buildTestApp();
    app = built.app;

    const res = await app.inject({
      method: "POST",
      url: `/plan-specs/${SPEC_ID}/confirm`,
      headers: { authorization: `Bearer ${VALID_TOKEN}`, "x-kinora-locale": "es" },
    });
    expect(res.statusCode).toBe(200);
    await vi.waitFor(() => expect(built.planState.generationRepo.markReady).toHaveBeenCalledTimes(1));

    const persisted = built.planState.plans[0]!.programJson!;
    expect(persisted.limitationWarnings).toEqual([
      "Limitación: dolor lumbar — Consulta con un profesional antes de realizar ejercicios que exijan esta zona.",
    ]);
  });

  it("persists ENGLISH warnings when x-kinora-locale is absent", async () => {
    const built = await buildTestApp();
    app = built.app;

    const res = await app.inject({
      method: "POST",
      url: `/plan-specs/${SPEC_ID}/confirm`,
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    await vi.waitFor(() => expect(built.planState.generationRepo.markReady).toHaveBeenCalledTimes(1));

    const persisted = built.planState.plans[0]!.programJson!;
    expect(persisted.limitationWarnings).toEqual([
      "Limitation: dolor lumbar — Consult a professional before attempting exercises that stress this area.",
    ]);
  });
});
