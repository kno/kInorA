import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import { healthRoute } from "../health";
import type { HealthResponse } from "@kinora/contracts";

describe("health routes", () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    app = Fastify();
    await app.register(healthRoute);
  });

  afterEach(async () => {
    await app.close();
  });

  it("returns exact JSON health contract from GET /health", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/health",
    });

    const body: HealthResponse = response.json();

    expect(response.statusCode).toBe(200);
    expect(body).toEqual({ status: "ok" });
  });

  it("returns exact JSON health contract from GET /api/health", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/health",
    });

    const body: HealthResponse = response.json();

    expect(response.statusCode).toBe(200);
    expect(body).toEqual({ status: "ok" });
  });

  it("returns application/json content type from both health routes", async () => {
    const rootHealth = await app.inject({ method: "GET", url: "/health" });
    const apiHealth = await app.inject({ method: "GET", url: "/api/health" });

    expect(rootHealth.headers["content-type"]).toContain("application/json");
    expect(apiHealth.headers["content-type"]).toContain("application/json");
  });
});
