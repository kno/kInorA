import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import { healthRoute } from "../health";
import type { HealthResponse } from "@kinora/contracts";

describe("GET /health", () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    app = Fastify();
    await app.register(healthRoute);
  });

  afterEach(async () => {
    await app.close();
  });

  // --- Scenario: First development start returns health ---
  // GIVEN dependencies are installed
  // WHEN the developer checks health
  // THEN GET /health returns status 200

  it("returns HTTP 200", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/health",
    });
    expect(response.statusCode).toBe(200);
  });

  // --- Shape contract: JSON body matches HealthResponse ---
  it("returns JSON with status 'ok'", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/health",
    });
    const body: HealthResponse = response.json();
    expect(body.status).toBe("ok");
  });

  // --- Triangulation: timestamp and uptime fields exist and are correct types ---
  it("returns a valid ISO 8601 timestamp", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/health",
    });
    const body: HealthResponse = response.json();
    // Timestamp must be a valid ISO 8601 string
    const parsed = Date.parse(body.timestamp);
    expect(parsed).not.toBeNaN();
    expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
  });

  it("returns a numeric uptime in seconds", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/health",
    });
    const body: HealthResponse = response.json();
    expect(typeof body.uptime).toBe("number");
    expect(body.uptime).toBeGreaterThanOrEqual(0);
  });

  // --- Triangulation: response content type ---
  it("returns application/json content type", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/health",
    });
    expect(response.headers["content-type"]).toContain("application/json");
  });

  // --- Triangulation: uptime increases between calls ---
  it("uptime increases between successive calls", async () => {
    const start = await app.inject({
      method: "GET",
      url: "/health",
    });
    // Wait a small amount of time
    await new Promise((resolve) => setTimeout(resolve, 50));
    const later = await app.inject({
      method: "GET",
      url: "/health",
    });
    const startBody: HealthResponse = start.json();
    const laterBody: HealthResponse = later.json();
    expect(laterBody.uptime).toBeGreaterThanOrEqual(startBody.uptime);
  });
});