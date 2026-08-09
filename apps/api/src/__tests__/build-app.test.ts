/**
 * Composition-root tests for the REAL `buildApp()` (issue #369).
 *
 * Every other suite in this package either tests a route plugin in isolation
 * (mounting a bare Fastify instance and registering only the route under test)
 * or imports the two standalone helpers exported alongside `buildApp`. Nothing
 * called the real composition root, so V8 never executed the declaration sites
 * of the ~50 inline closures `buildApp()` assigns as route options — they were
 * invisible to the instrumenter rather than covered, and the reported number
 * for `app.ts` was an artifact of that invisibility.
 *
 * These tests build the real app over a mock `Database` and assert the wiring
 * invariants the composition root actually owns: which routes exist, the
 * dual-mount of the Stripe webhook, the app-level error mapping, the
 * unauthenticated default, and a clean shutdown through the `onClose` hook.
 */
import { describe, it, expect, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { MockPlanGenerator } from "../ai/mock-generator.js";
import type { ObservabilityLogger } from "../observability/event-logger.js";
import { AuthError } from "../auth/service.js";
import {
  createAuthMockDb,
  DEFAULT_USER_ID,
  VALID_TOKEN,
} from "../test-support/auth-mocks.js";
import type { Database } from "../db/client.js";

function createObservabilitySpy(): ObservabilityLogger {
  return { recordEvent: vi.fn() } as unknown as ObservabilityLogger;
}

/**
 * Build the real app with every outbound dependency injected, so no LLM,
 * Stripe, embedding or filesystem call can happen during the test.
 */
async function buildTestApp(
  overrides: { db?: Database; observabilityLogger?: ObservabilityLogger } = {},
): Promise<FastifyInstance> {
  return buildApp({
    db: overrides.db ?? createAuthMockDb().db,
    planGenerator: new MockPlanGenerator(),
    observabilityLogger: overrides.observabilityLogger ?? createObservabilitySpy(),
  });
}

describe("buildApp composition root", () => {
  it("registers the public health route and answers it", async () => {
    const app = await buildTestApp();
    try {
      const response = await app.inject({ method: "GET", url: "/health" });

      expect(response.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it("mounts the Stripe webhook both unprefixed and under /api", async () => {
    // The web reverse-proxy only forwards `/api/:path*`, so the webhook is
    // deliberately registered twice. A single mount would make Stripe
    // unreachable in production.
    const app = await buildTestApp();
    try {
      expect(app.hasRoute({ method: "POST", url: "/billing/webhook" })).toBe(true);
      expect(app.hasRoute({ method: "POST", url: "/api/billing/webhook" })).toBe(true);
    } finally {
      await app.close();
    }
  });

  it("composes the authenticated route surface", async () => {
    const app = await buildTestApp();
    try {
      const routes = app.printRoutes({ commonPrefix: false });

      expect(routes).toContain("/auth/register");
      expect(routes).toContain("/plans");
      expect(routes).toContain("/exercises/catalog");
      expect(routes).toContain("/admin/ai-config");
      expect(routes).toContain("/billing/visibility");
      expect(routes).toContain("/user-profile");
    } finally {
      await app.close();
    }
  });

  it("rejects an unauthenticated request to a protected route with 401", async () => {
    const app = await buildTestApp();
    try {
      const response = await app.inject({ method: "GET", url: "/user-profile" });

      expect(response.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it("maps an AuthError thrown inside a route to 401 without recording an error event", async () => {
    const observabilityLogger = createObservabilitySpy();
    const app = await buildTestApp({ observabilityLogger });
    app.get("/test-only/auth-error", async () => {
      throw new AuthError("Invalid credentials");
    });
    await app.ready();

    try {
      const response = await app.inject({ method: "GET", url: "/test-only/auth-error" });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: "Invalid credentials" });
      expect(observabilityLogger.recordEvent).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it("maps a schema validation failure to 422", async () => {
    const app = await buildTestApp();
    app.post(
      "/test-only/validated",
      {
        schema: {
          body: {
            type: "object",
            required: ["name"],
            properties: { name: { type: "string" } },
          },
        },
      },
      async () => ({ ok: true }),
    );
    await app.ready();

    try {
      const response = await app.inject({
        method: "POST",
        url: "/test-only/validated",
        payload: {},
      });

      expect(response.statusCode).toBe(422);
      expect(response.json()).toEqual({ error: "Validation Error" });
    } finally {
      await app.close();
    }
  });

  it("maps an unexpected error to 500 and records the route pattern and error name only", async () => {
    const observabilityLogger = createObservabilitySpy();
    const app = await buildTestApp({ observabilityLogger });
    app.get("/test-only/boom/:id", async () => {
      throw new TypeError("secret detail that must never be persisted");
    });
    await app.ready();

    try {
      const response = await app.inject({
        method: "GET",
        url: "/test-only/boom/42?token=super-secret",
      });

      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({ error: "Internal Server Error" });
      expect(observabilityLogger.recordEvent).toHaveBeenCalledWith({
        tenantId: null,
        actorUserId: null,
        level: "error",
        event: "request.error",
        metadata: {
          route: "/test-only/boom/:id",
          statusCode: 500,
          errName: "TypeError",
        },
      });
    } finally {
      await app.close();
    }
  });

  it("accepts the legacy two-argument form and builds the same route surface", async () => {
    // buildApp(db) predates the options bag; existing suites still call it that
    // way, so the discriminator must keep routing a Database-shaped first
    // argument to the legacy branch.
    const app = await buildApp(createAuthMockDb().db);

    try {
      expect(app.hasRoute({ method: "GET", url: "/health" })).toBe(true);
      expect(app.hasRoute({ method: "POST", url: "/billing/webhook" })).toBe(true);
    } finally {
      await app.close();
    }
  });

  it("resolves the auth context from a bearer token through the composed auth plugin", async () => {
    // Exercises the composition root's `authPlugin` registration: the session
    // and tenant-scoped membership lookups both run against the mock DB, so a
    // valid token reaches the route instead of the 401 default.
    const { db } = createAuthMockDb();
    const app = await buildTestApp({ db });
    app.get("/test-only/whoami", async (request) => ({
      tenantId: request.authContext?.tenantId ?? null,
    }));
    await app.ready();

    try {
      const response = await app.inject({
        method: "GET",
        url: "/test-only/whoami",
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().tenantId).not.toBeNull();
    } finally {
      await app.close();
    }
  });

  it("wires the user-profile route port to the profile repository", async () => {
    // Exercises one of the composition root's inline route-option closures end
    // to end: `findProfileByUserId` must reach UserProfileRepository, so an
    // existing row is returned instead of the lazy-provisioning branch.
    const profileRow = {
      userId: DEFAULT_USER_ID,
      name: "Existing User",
      goal: null,
      experienceLevel: null,
      selfDescribedSex: null,
      heightCm: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const { db } = createAuthMockDb({ additionalRows: [[profileRow]] });
    const app = await buildTestApp({ db });

    try {
      const response = await app.inject({
        method: "GET",
        url: "/user-profile",
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().name).toBe("Existing User");
    } finally {
      await app.close();
    }
  });

  it("wires the admin gate to the user repository and denies a non-admin", async () => {
    // `findUserById` is another inline route-option closure: the admin routes
    // resolve the caller through UserRepository, so a non-admin is refused
    // before any config is read.
    const { db } = createAuthMockDb({
      additionalRows: [[{ id: DEFAULT_USER_ID, email: "member@example.com", isAdmin: false }]],
    });
    const app = await buildTestApp({ db });

    try {
      const response = await app.inject({
        method: "GET",
        url: "/admin/ai-config",
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
      });

      expect(response.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });

  it("closes cleanly, running the Langfuse flush hook without throwing", async () => {
    const app = await buildTestApp();

    await expect(app.close()).resolves.toBeUndefined();
  });

  it(
    "registers no DELETE route on /workout-plans* or /plan-specs* (17d PR B, Judgment Day finding 2)",
    async () => {
      // workout_plans.plan_spec_id -> plan_specs.id is ON DELETE CASCADE, and
      // workout_plans.id -> workout_sessions -> session_exercises -> set_records
      // cascade onward. A DELETE anywhere on that chain would destroy training
      // history and every derived statistic — including a future
      // `DELETE /plan-specs/:id` that never touches /workout-plans* at all and
      // would therefore pass a guard scoped to /workout-plans* alone (the
      // original, too-narrow wording this test replaces).
      const app = await buildTestApp();
      try {
        const routes = app.printRoutes({ commonPrefix: false });

        // printRoutes groups each top-level path with its nested children
        // indented beneath it; parse it into one block of text per top-level
        // route so a DELETE nested under /workout-plans/:id or
        // /plan-specs/:id/... is caught, not just a DELETE at the exact
        // top-level path.
        const blocks = new Map<string, string[]>();
        let currentKey: string | undefined;
        for (const line of routes.split("\n")) {
          const topLevel = line.match(/^(?:├── |└── )(\S+)/);
          if (topLevel) {
            currentKey = topLevel[1];
            blocks.set(currentKey, [line]);
          } else if (currentKey && line.trim().length > 0) {
            blocks.get(currentKey)!.push(line);
          }
        }

        const workoutPlansBlock = blocks.get("/workout-plans");
        const planSpecsBlock = blocks.get("/plan-specs");
        expect(workoutPlansBlock, "/workout-plans route block not found").toBeDefined();
        expect(planSpecsBlock, "/plan-specs route block not found").toBeDefined();

        expect(workoutPlansBlock!.join("\n")).not.toContain("DELETE");
        expect(planSpecsBlock!.join("\n")).not.toContain("DELETE");
      } finally {
        await app.close();
      }
    },
  );
});
