import { describe, it, expect, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import {
  ExerciseCatalogDetailSchema,
  ExerciseCatalogListResponseSchema,
} from "@kinora/contracts";
import { listExercises } from "@kinora/exercise-catalog";
import { authPlugin } from "../../auth/plugin.js";
import {
  DEFAULT_CATALOG_LIMIT,
  MAX_CATALOG_LIMIT,
  computeExerciseCatalogFacets,
  exerciseCatalogRoutes,
  planCatalogQuery,
} from "../exercise-catalog.js";
import {
  VALID_TOKEN,
  buildActiveMembershipRow,
  buildSessionRow,
  createCyclingAuthMockDb,
} from "../../test-support/auth-mocks.js";

const TENANT_A = "aaaaaaaa-0000-0000-0000-000000000001";
const USER_A = "aaaaaaaa-0000-0000-0000-000000000002";

/** A record known to exist in the shipped catalog — the first upstream id. */
const KNOWN_ID = "0001";

const AUTH_HEADERS = { authorization: `Bearer ${VALID_TOKEN}` };

/**
 * The auth pipeline issues one session + one membership read per request, so
 * every suite here cycles enough rows for the requests it makes.
 */
function buildSessionDb() {
  return createCyclingAuthMockDb({
    sessionRows: [buildSessionRow({ tenantId: TENANT_A, userId: USER_A })],
    membershipRows: [buildActiveMembershipRow({ tenantId: TENANT_A, userId: USER_A })],
  });
}

async function buildTestApp(db = buildSessionDb()): Promise<FastifyInstance> {
  const app = Fastify();

  app.setErrorHandler((error, _request, reply) => {
    if (error.name === "AuthError") {
      return reply.code(401).send({ error: error.message });
    }
    return reply.code(500).send({ error: "Internal Server Error" });
  });

  await app.register(authPlugin, { db });
  await app.register(exerciseCatalogRoutes);
  return app;
}

let app: FastifyInstance;

afterEach(async () => {
  if (app) await app.close();
});

describe("GET /exercises/catalog", () => {
  it("returns 401 without authentication", async () => {
    app = await buildTestApp(createCyclingAuthMockDb({ sessionRows: [], membershipRows: [] }));

    const response = await app.inject({ method: "GET", url: "/exercises/catalog" });

    expect(response.statusCode).toBe(401);
  });

  it("returns the first page of the catalog with the default window", async () => {
    app = await buildTestApp();

    const response = await app.inject({
      method: "GET",
      url: "/exercises/catalog",
      headers: AUTH_HEADERS,
    });

    expect(response.statusCode).toBe(200);
    const body = ExerciseCatalogListResponseSchema.parse(response.json());
    expect(body.limit).toBe(DEFAULT_CATALOG_LIMIT);
    expect(body.offset).toBe(0);
    expect(body.items).toHaveLength(DEFAULT_CATALOG_LIMIT);
    expect(body.total).toBe(listExercises().total);
  });

  // The list item is the LEAN projection: the heavy detail fields must not be
  // shipped on a grid page, but `attribution` must never be stripped.
  it("projects list items without the detail-only fields", async () => {
    app = await buildTestApp();

    const response = await app.inject({
      method: "GET",
      url: "/exercises/catalog?limit=1",
      headers: AUTH_HEADERS,
    });

    const [item] = response.json().items;
    expect(item).not.toHaveProperty("instructionSteps");
    expect(item).not.toHaveProperty("secondaryMuscles");
    expect(item.attribution).toBeTruthy();
  });

  it("filters by bodyPart", async () => {
    app = await buildTestApp();

    const response = await app.inject({
      method: "GET",
      url: "/exercises/catalog?bodyPart=chest&limit=100",
      headers: AUTH_HEADERS,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.total).toBe(listExercises({ bodyPart: "chest" }).total);
    expect(body.items.every((item: { bodyPart: string }) => item.bodyPart === "chest")).toBe(true);
  });

  it("filters by equipment", async () => {
    app = await buildTestApp();

    const response = await app.inject({
      method: "GET",
      url: `/exercises/catalog?equipment=${encodeURIComponent("body weight")}&limit=100`,
      headers: AUTH_HEADERS,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.total).toBe(listExercises({ equipment: "body weight" }).total);
    expect(body.items.every((item: { equipment: string }) => item.equipment === "body weight")).toBe(
      true,
    );
  });

  it("filters by target", async () => {
    app = await buildTestApp();

    const response = await app.inject({
      method: "GET",
      url: "/exercises/catalog?target=abs&limit=100",
      headers: AUTH_HEADERS,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.total).toBe(listExercises({ target: "abs" }).total);
    expect(body.items.every((item: { target: string }) => item.target === "abs")).toBe(true);
  });

  it("filters by search, case- and accent-insensitively", async () => {
    app = await buildTestApp();

    const response = await app.inject({
      method: "GET",
      url: "/exercises/catalog?search=SIT-UP&limit=100",
      headers: AUTH_HEADERS,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.total).toBeGreaterThan(0);
    expect(body.items.every((item: { name: string }) => item.name.includes("sit-up"))).toBe(true);
  });

  it("combines filters with AND", async () => {
    app = await buildTestApp();

    const response = await app.inject({
      method: "GET",
      url: "/exercises/catalog?bodyPart=waist&target=abs&limit=100",
      headers: AUTH_HEADERS,
    });

    expect(response.json().total).toBe(listExercises({ bodyPart: "waist", target: "abs" }).total);
  });

  it("paginates via offset and echoes the applied window", async () => {
    app = await buildTestApp();

    const first = await app.inject({
      method: "GET",
      url: "/exercises/catalog?limit=5&offset=0",
      headers: AUTH_HEADERS,
    });
    const second = await app.inject({
      method: "GET",
      url: "/exercises/catalog?limit=5&offset=5",
      headers: AUTH_HEADERS,
    });

    const firstBody = first.json();
    const secondBody = second.json();
    expect(secondBody.limit).toBe(5);
    expect(secondBody.offset).toBe(5);
    expect(secondBody.total).toBe(firstBody.total);
    expect(secondBody.items[0].id).not.toBe(firstBody.items[0].id);
  });

  // An offset past the end is a valid empty page, not an error — `total` still
  // reports the pre-pagination match count so the client can render a pager.
  it("returns an empty page for an offset beyond the last match", async () => {
    app = await buildTestApp();

    const response = await app.inject({
      method: "GET",
      url: "/exercises/catalog?offset=999999",
      headers: AUTH_HEADERS,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.items).toEqual([]);
    expect(body.total).toBeGreaterThan(0);
  });

  it("clamps limit to the maximum instead of rejecting it", async () => {
    app = await buildTestApp();

    const response = await app.inject({
      method: "GET",
      url: "/exercises/catalog?limit=5000",
      headers: AUTH_HEADERS,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.limit).toBe(MAX_CATALOG_LIMIT);
    expect(body.items).toHaveLength(MAX_CATALOG_LIMIT);
  });

  it("accepts limit=0 as an explicit count-only request", async () => {
    app = await buildTestApp();

    const response = await app.inject({
      method: "GET",
      url: "/exercises/catalog?limit=0",
      headers: AUTH_HEADERS,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.items).toEqual([]);
    expect(body.total).toBeGreaterThan(0);
  });

  it.each([
    ["unknown body part", "/exercises/catalog?bodyPart=gills"],
    ["non-numeric limit", "/exercises/catalog?limit=many"],
    ["negative limit", "/exercises/catalog?limit=-1"],
    ["fractional limit", "/exercises/catalog?limit=1.5"],
    ["negative offset", "/exercises/catalog?offset=-10"],
    ["blank search", "/exercises/catalog?search=%20%20"],
    ["blank equipment", "/exercises/catalog?equipment="],
  ])("returns 400 for %s", async (_label, url) => {
    app = await buildTestApp();

    const response = await app.inject({ method: "GET", url, headers: AUTH_HEADERS });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_query" });
  });

  it("rejects an oversized search term with 400", async () => {
    app = await buildTestApp();

    const response = await app.inject({
      method: "GET",
      url: `/exercises/catalog?search=${"a".repeat(201)}`,
      headers: AUTH_HEADERS,
    });

    expect(response.statusCode).toBe(400);
  });

  it("ignores unknown query parameters", async () => {
    app = await buildTestApp();

    const response = await app.inject({
      method: "GET",
      url: "/exercises/catalog?limit=1&sneaky=yes",
      headers: AUTH_HEADERS,
    });

    expect(response.statusCode).toBe(200);
  });
});

describe("GET /exercises/catalog/:id", () => {
  it("returns 401 without authentication", async () => {
    app = await buildTestApp(createCyclingAuthMockDb({ sessionRows: [], membershipRows: [] }));

    const response = await app.inject({ method: "GET", url: `/exercises/catalog/${KNOWN_ID}` });

    expect(response.statusCode).toBe(401);
  });

  it("returns the full detail payload for a known id", async () => {
    app = await buildTestApp();

    const response = await app.inject({
      method: "GET",
      url: `/exercises/catalog/${KNOWN_ID}`,
      headers: AUTH_HEADERS,
    });

    expect(response.statusCode).toBe(200);
    const detail = ExerciseCatalogDetailSchema.parse(response.json());
    expect(detail.id).toBe(KNOWN_ID);
    expect(detail.instructionSteps.en.length).toBeGreaterThan(0);
    expect(detail.instructionSteps.es.length).toBe(detail.instructionSteps.en.length);
    expect(detail.attribution).toBeTruthy();
  });

  it("returns 404 for an unknown id", async () => {
    app = await buildTestApp();

    const response = await app.inject({
      method: "GET",
      url: "/exercises/catalog/does-not-exist",
      headers: AUTH_HEADERS,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "exercise_not_found" });
  });
});

describe("GET /exercises/catalog/facets", () => {
  it("returns 401 without authentication", async () => {
    app = await buildTestApp(createCyclingAuthMockDb({ sessionRows: [], membershipRows: [] }));

    const response = await app.inject({ method: "GET", url: "/exercises/catalog/facets" });

    expect(response.statusCode).toBe(401);
  });

  // The static `facets` segment must win over the `:id` parameter, otherwise
  // this would 404 as an unknown exercise.
  it("resolves the static segment rather than the :id route", async () => {
    app = await buildTestApp();

    const response = await app.inject({
      method: "GET",
      url: "/exercises/catalog/facets",
      headers: AUTH_HEADERS,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).not.toHaveProperty("error");
  });

  it("returns every distinct filter value with its record count", async () => {
    app = await buildTestApp();

    const response = await app.inject({
      method: "GET",
      url: "/exercises/catalog/facets",
      headers: AUTH_HEADERS,
    });

    const body = response.json();
    const total = listExercises().total;

    for (const key of ["bodyPart", "equipment", "target"] as const) {
      expect(body[key].length).toBeGreaterThan(0);
      const sum = body[key].reduce(
        (acc: number, facet: { count: number }) => acc + facet.count,
        0,
      );
      // Each record contributes exactly once to each facet dimension.
      expect(sum).toBe(total);
      const values = body[key].map((facet: { value: string }) => facet.value);
      expect(values).toEqual([...values].sort((a: string, b: string) => a.localeCompare(b)));
      expect(new Set(values).size).toBe(values.length);
    }

    const chest = body.bodyPart.find((facet: { value: string }) => facet.value === "chest");
    expect(chest.count).toBe(listExercises({ bodyPart: "chest" }).total);
  });

  it("memoizes the computed facets", () => {
    expect(computeExerciseCatalogFacets()).toBe(computeExerciseCatalogFacets());
  });
});

describe("planCatalogQuery", () => {
  it("defaults the window when no pagination is supplied", () => {
    const result = planCatalogQuery({});

    expect(result).toEqual({
      ok: true,
      query: {
        filters: { limit: DEFAULT_CATALOG_LIMIT, offset: 0 },
        limit: DEFAULT_CATALOG_LIMIT,
        offset: 0,
      },
    });
  });

  it("treats a missing query object as an empty one", () => {
    expect(planCatalogQuery(undefined).ok).toBe(true);
  });

  it("trims free-text filters before forwarding them", () => {
    const result = planCatalogQuery({ search: "  squat  " });

    expect(result.ok && result.query.filters.search).toBe("squat");
  });

  it("rejects a malformed query", () => {
    expect(planCatalogQuery({ bodyPart: "gills" })).toEqual({ ok: false });
  });
});
