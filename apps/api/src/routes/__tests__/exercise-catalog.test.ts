import { describe, it, expect, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import {
  ExerciseCatalogDetailSchema,
  ExerciseCatalogListResponseSchema,
  MAX_EXERCISE_SEARCH_LENGTH,
} from "@kinora/contracts";
import { listExercises } from "@kinora/exercise-catalog";
import { authPlugin } from "../../auth/plugin.js";
import {
  DEFAULT_CATALOG_LIMIT,
  MAX_CATALOG_LIMIT,
  computeExerciseCatalogFacets,
  exerciseCatalogRoutes,
  planCatalogQuery,
  planFacetQuery,
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
    expect(body.total).toBe(listExercises({ bodyPart: ["chest"] }).total);
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
    expect(body.total).toBe(listExercises({ equipment: ["body weight"] }).total);
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
    expect(body.total).toBe(listExercises({ target: ["abs"] }).total);
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

    expect(response.json().total).toBe(
      listExercises({ bodyPart: ["waist"], target: ["abs"] }).total,
    );
  });

  it("widens the result set with a repeated bodyPart parameter (OR within group)", async () => {
    app = await buildTestApp();

    const response = await app.inject({
      method: "GET",
      url: "/exercises/catalog?bodyPart=cardio&bodyPart=chest&limit=200",
      headers: AUTH_HEADERS,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().total).toBe(192);
  });

  it("narrows a widened selection with a second group (AND across groups)", async () => {
    app = await buildTestApp();

    const response = await app.inject({
      method: "GET",
      url: `/exercises/catalog?bodyPart=cardio&bodyPart=chest&equipment=${encodeURIComponent("body weight")}&limit=200`,
      headers: AUTH_HEADERS,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().total).toBe(57);
  });

  it.each([
    ["bodyPart", "/exercises/catalog?bodyPart="],
    ["equipment", "/exercises/catalog?equipment="],
    ["target", "/exercises/catalog?target="],
  ])(
    "treats a blank %s alone as absent, never a 400 (deliberate contract change)",
    async (_field, url) => {
      app = await buildTestApp();

      const response = await app.inject({ method: "GET", url, headers: AUTH_HEADERS });

      expect(response.statusCode).toBe(200);
      expect(response.json().total).toBe(listExercises().total);
    },
  );

  it("strips a blank value that precedes a real one for bodyPart (no 400)", async () => {
    app = await buildTestApp();

    const response = await app.inject({
      method: "GET",
      url: "/exercises/catalog?bodyPart=&bodyPart=chest&limit=200",
      headers: AUTH_HEADERS,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().total).toBe(listExercises({ bodyPart: ["chest"] }).total);
  });

  it("strips a blank value that precedes a real one for equipment (no 400)", async () => {
    app = await buildTestApp();

    const response = await app.inject({
      method: "GET",
      url: `/exercises/catalog?equipment=&equipment=${encodeURIComponent("barbell")}&limit=200`,
      headers: AUTH_HEADERS,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().total).toBe(listExercises({ equipment: ["barbell"] }).total);
  });

  it("dedupes a repeated identical value", async () => {
    app = await buildTestApp();

    const response = await app.inject({
      method: "GET",
      url: "/exercises/catalog?bodyPart=chest&bodyPart=chest&limit=200",
      headers: AUTH_HEADERS,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().total).toBe(listExercises({ bodyPart: ["chest"] }).total);
  });

  it("accepts an unrecognized free-form equipment value and matches nothing", async () => {
    app = await buildTestApp();

    const response = await app.inject({
      method: "GET",
      url: "/exercises/catalog?equipment=jetpack",
      headers: AUTH_HEADERS,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.items).toEqual([]);
    expect(body.total).toBe(0);
  });

  // Regression, issue #343 — a repeated blank-then-value search must never
  // reach the catalog as a 500; the array-tolerant schema keeps `search`
  // single-valued and unaffected, but the request as a whole must stay a
  // normal, filtered 200.
  it("returns 200 filtered by the surviving value for a repeated blank-then-value search", async () => {
    app = await buildTestApp();

    const response = await app.inject({
      method: "GET",
      url: "/exercises/catalog?search=&search=press",
      headers: AUTH_HEADERS,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.total).toBeGreaterThan(0);
    expect(body.items.every((item: { name: string }) => item.name.includes("press"))).toBe(true);
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

  it("draws the search-length boundary at the SHARED contract constant", async () => {
    // The web library truncates to `MAX_EXERCISE_SEARCH_LENGTH` before sending.
    // Pinning both sides to the same exported constant is what stops this route
    // from rejecting terms the client still considers valid — which the page
    // renders as a false "library unavailable" card.
    app = await buildTestApp();
    const url = (length: number) =>
      `/exercises/catalog?limit=1&search=${"a".repeat(length)}`;

    const atCap = await app.inject({
      method: "GET",
      url: url(MAX_EXERCISE_SEARCH_LENGTH),
      headers: AUTH_HEADERS,
    });
    const overCap = await app.inject({
      method: "GET",
      url: url(MAX_EXERCISE_SEARCH_LENGTH + 1),
      headers: AUTH_HEADERS,
    });

    expect(atCap.statusCode).toBe(200);
    expect(overCap.statusCode).toBe(400);
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
      expect(new Set(values).size).toBe(values.length);
      // Ordering is count-desc then value-asc (ties broken alphabetically) —
      // deliberately changed from the previous value-asc order (design §8).
      for (let i = 1; i < body[key].length; i++) {
        const prev = body[key][i - 1];
        const curr = body[key][i];
        const orderedByCount = prev.count > curr.count;
        const tiedThenByValue =
          prev.count === curr.count && prev.value.localeCompare(curr.value) <= 0;
        expect(orderedByCount || tiedThenByValue).toBe(true);
      }
    }

    const chest = body.bodyPart.find((facet: { value: string }) => facet.value === "chest");
    expect(chest.count).toBe(listExercises({ bodyPart: ["chest"] }).total);
  });

  // `cachedFacets` was deleted (decisions #2579): facets now vary per request,
  // so there is no longer a single memoized result to compare.
  it("recomputes facets freshly for each distinct filter combination", () => {
    const unfiltered = computeExerciseCatalogFacets();
    const filtered = computeExerciseCatalogFacets({ bodyPart: ["cardio"] });

    expect(filtered).not.toEqual(unfiltered);
    expect(filtered.equipment).toHaveLength(7);
  });

  it("scopes facet counts to the current filters via the query string", async () => {
    app = await buildTestApp();

    const response = await app.inject({
      method: "GET",
      url: "/exercises/catalog/facets?bodyPart=cardio&bodyPart=chest",
      headers: AUTH_HEADERS,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.equipment).toHaveLength(20);
    expect(body.target).toHaveLength(3);
    expect(body.target).toEqual(
      expect.arrayContaining([
        { value: "cardiovascular system", count: 29 },
        { value: "pectorals", count: 158 },
        { value: "serratus anterior", count: 5 },
      ]),
    );
  });

  it("self-excludes: the bodyPart facet still lists all 10 body parts under a bodyPart filter", async () => {
    app = await buildTestApp();

    const response = await app.inject({
      method: "GET",
      url: "/exercises/catalog/facets?bodyPart=cardio&bodyPart=chest",
      headers: AUTH_HEADERS,
    });

    expect(response.json().bodyPart).toHaveLength(10);
  });

  it("narrows every group's counts with search as an AND dimension", async () => {
    app = await buildTestApp();

    const unfiltered = await app.inject({
      method: "GET",
      url: "/exercises/catalog/facets",
      headers: AUTH_HEADERS,
    });
    const searched = await app.inject({
      method: "GET",
      url: "/exercises/catalog/facets?search=press",
      headers: AUTH_HEADERS,
    });

    const sumOf = (group: { count: number }[]) =>
      group.reduce((acc, facet) => acc + facet.count, 0);
    const unfilteredSum = sumOf(unfiltered.json().bodyPart);
    const searchedSum = sumOf(searched.json().bodyPart);

    expect(searchedSum).toBeLessThan(unfilteredSum);
    expect(searchedSum).toBe(listExercises({ search: "press" }).total);
  });

  it("keeps a selected-but-zero-count value visible at count: 0, sorted last", () => {
    // "jetpack" is not a real equipment label, so under this filter its own
    // tally is empty — but because it is part of the current selection it
    // must still be present in the response, not silently dropped.
    const facets = computeExerciseCatalogFacets({ equipment: ["jetpack"] });

    const jetpack = facets.equipment.find((facet) => facet.value === "jetpack");
    expect(jetpack).toEqual({ value: "jetpack", count: 0 });
    // Zero-count entries land last within their group after the resort.
    expect(facets.equipment.at(-1)).toEqual({ value: "jetpack", count: 0 });
  });

  it("returns 400 for an unknown bodyPart even on the facets endpoint", async () => {
    app = await buildTestApp();

    const response = await app.inject({
      method: "GET",
      url: "/exercises/catalog/facets?bodyPart=gills",
      headers: AUTH_HEADERS,
    });

    expect(response.statusCode).toBe(400);
  });
});

describe("planFacetQuery", () => {
  it("defaults to unconstrained filters for an empty query", () => {
    expect(planFacetQuery({})).toEqual({ ok: true, filters: {} });
  });

  it("never carries a pagination window — the type cannot express one", () => {
    const result = planFacetQuery({ bodyPart: "chest", limit: "5", offset: "10" });

    expect(result).toEqual({ ok: true, filters: { bodyPart: ["chest"] } });
  });

  it("rejects an unknown bodyPart", () => {
    expect(planFacetQuery({ bodyPart: "gills" })).toEqual({ ok: false });
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

  // One row per case of design §4's query-schema table.
  describe("list-valued filter fields (design §4)", () => {
    it("absent → unconstrained (key omitted from filters)", () => {
      const result = planCatalogQuery({});
      expect(result.ok && result.query.filters.bodyPart).toBeUndefined();
    });

    it("single value → a one-element list", () => {
      const result = planCatalogQuery({ bodyPart: "chest" });
      expect(result.ok && result.query.filters.bodyPart).toEqual(["chest"]);
    });

    it("repeated values → an array in URL order", () => {
      const result = planCatalogQuery({ bodyPart: ["chest", "cardio"] });
      expect(result.ok && result.query.filters.bodyPart).toEqual(["chest", "cardio"]);
    });

    it("a duplicated value is deduped", () => {
      const result = planCatalogQuery({ bodyPart: ["chest", "chest"] });
      expect(result.ok && result.query.filters.bodyPart).toEqual(["chest"]);
    });

    it("a blank value alone strips to an empty, unconstrained list — never 400", () => {
      const result = planCatalogQuery({ bodyPart: "" });
      expect(result.ok).toBe(true);
      expect(result.ok && result.query.filters.bodyPart).toBeUndefined();
    });

    it("a blank value ahead of a real one is stripped, not rejected", () => {
      const result = planCatalogQuery({ bodyPart: ["", "chest"] });
      expect(result.ok && result.query.filters.bodyPart).toEqual(["chest"]);
    });

    it("an unknown enum bodyPart value still fails validation (unchanged contract)", () => {
      expect(planCatalogQuery({ bodyPart: "gills" })).toEqual({ ok: false });
    });

    it("an unknown free-form equipment/target value is accepted and matches nothing", () => {
      const result = planCatalogQuery({ equipment: "jetpack", target: "core of the earth" });
      expect(result.ok && result.query.filters.equipment).toEqual(["jetpack"]);
      expect(result.ok && result.query.filters.target).toEqual(["core of the earth"]);
      expect(result.ok && listExercises(result.query.filters).total).toBe(0);
    });
  });
});
