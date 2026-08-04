import { describe, it, expect, vi } from "vitest";
import type { ExerciseCatalogDetail, ExerciseCatalogItem } from "@kinora/contracts";
import {
  buildCatalogQueryString,
  fetchExerciseCatalogDetail,
  fetchExerciseCatalogFacets,
  fetchExerciseCatalogList,
} from "../exercise-catalog-client";

/**
 * exercise-catalog-client — server-only fetches for the exercise library.
 * Mirrors dashboard-client.ts's fetch/parse pattern.
 */

const OPTIONS = { apiBaseUrl: "http://api.test" };
const TOKEN = "session-tok";

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

const item: ExerciseCatalogItem = {
  id: "0001",
  name: "3/4 sit-up",
  bodyPart: "waist",
  equipment: "body weight",
  target: "abs",
  muscleGroup: "hip flexors",
  imagePath: "/exercises/images/0001-abc.jpg",
  gifPath: "https://cdn.jsdelivr.net/gh/hasaneyldrm/exercises-dataset@7455efae41b330c265e7cd4b78dfa848e7ce5ebd/videos/0001-abc.gif",
  attribution: "(c) Gym visual — https://gymvisual.com/",
};

const detail: ExerciseCatalogDetail = {
  ...item,
  secondaryMuscles: ["hip flexors", "lower back"],
  instructionSteps: {
    en: ["Lie on your back.", "Curl up."],
    es: ["Túmbate boca arriba.", "Eleva el tronco."],
  },
};

describe("buildCatalogQueryString", () => {
  it("returns an empty string when no filter is set", () => {
    expect(buildCatalogQueryString({})).toBe("");
  });

  it("omits blank and whitespace-only filters", () => {
    expect(buildCatalogQueryString({ search: "   ", bodyPart: "" })).toBe("");
  });

  it("does not THROW when a filter arrives as an array (the HTTP 500 crash site)", () => {
    // This is the function that actually threw: `?search=a&search=b` reaches
    // the page as `["a", "b"]`, and `.trim()` on an array is a TypeError raised
    // outside any try/catch — the whole route answered 500. The caller
    // normalises now, but the crash site itself must not depend on every future
    // caller remembering to. The cast is the point: it reproduces a value the
    // types promise cannot exist and the URL produces anyway.
    const repeated = { search: ["press", "squat"], bodyPart: ["", "chest"] } as unknown as {
      search: string;
      bodyPart: string;
    };

    expect(() => buildCatalogQueryString(repeated)).not.toThrow();
    expect(buildCatalogQueryString(repeated)).toBe("?search=press&bodyPart=chest");
  });

  it("drops a filter that is neither a string nor a usable array", () => {
    const junk = { search: 42, bodyPart: null, target: [] } as unknown as { search: string };
    expect(buildCatalogQueryString(junk)).toBe("");
  });

  it("serializes every filter plus the pagination window", () => {
    const query = buildCatalogQueryString({
      search: " press ",
      bodyPart: "chest",
      equipment: "barbell",
      target: "pectorals",
      limit: 24,
      offset: 48,
    });

    const params = new URLSearchParams(query.slice(1));
    expect(params.get("search")).toBe("press");
    expect(params.get("bodyPart")).toBe("chest");
    expect(params.get("equipment")).toBe("barbell");
    expect(params.get("target")).toBe("pectorals");
    expect(params.get("limit")).toBe("24");
    expect(params.get("offset")).toBe("48");
  });

  it("keeps an explicit zero offset (page one is still an explicit window)", () => {
    expect(buildCatalogQueryString({ offset: 0 })).toBe("?offset=0");
  });
});

describe("fetchExerciseCatalogList", () => {
  it("returns an error when no session token is present, without calling fetch", async () => {
    const fetchImpl = vi.fn();

    const result = await fetchExerciseCatalogList(undefined, {}, { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "error", message: "no_session" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns the parsed page on a 200 response", async () => {
    const page = { items: [item], total: 1, limit: 24, offset: 0 };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, page));

    const result = await fetchExerciseCatalogList(TOKEN, {}, { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "ok", page });
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://api.test/exercises/catalog",
      expect.objectContaining({
        method: "GET",
        headers: { authorization: `Bearer ${TOKEN}` },
      }),
    );
  });

  it("forwards search, filters and pagination to the API (never filtered client-side)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { items: [], total: 0, limit: 24, offset: 24 }));

    await fetchExerciseCatalogList(
      TOKEN,
      { search: "press", bodyPart: "chest", limit: 24, offset: 24 },
      { ...OPTIONS, fetchImpl },
    );

    const url = fetchImpl.mock.calls[0]![0] as string;
    expect(url).toContain("search=press");
    expect(url).toContain("bodyPart=chest");
    expect(url).toContain("offset=24");
  });

  it("returns the API error code on a non-2xx response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(403, { error: "forbidden" }));

    const result = await fetchExerciseCatalogList(TOKEN, {}, { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "error", message: "forbidden" });
  });

  it("falls back to a generic code when the error body carries none", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(500, {}));

    const result = await fetchExerciseCatalogList(TOKEN, {}, { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "error", message: "fetch_exercise_catalog_failed" });
  });

  it("returns api_unreachable when fetch throws", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    const result = await fetchExerciseCatalogList(TOKEN, {}, { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "error", message: "api_unreachable" });
  });

  it("returns invalid_response when the payload fails the contract schema", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { items: [{ id: "" }], total: -1 }));

    const result = await fetchExerciseCatalogList(TOKEN, {}, { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "error", message: "invalid_response" });
  });

  it("returns invalid_response when the body is not JSON", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("not json");
      },
    } as unknown as Response);

    const result = await fetchExerciseCatalogList(TOKEN, {}, { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "error", message: "invalid_response" });
  });
});

describe("fetchExerciseCatalogDetail", () => {
  it("returns an error when no session token is present, without calling fetch", async () => {
    const fetchImpl = vi.fn();

    const result = await fetchExerciseCatalogDetail(undefined, "0001", { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "error", message: "no_session" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns the parsed detail on a 200 response and URL-encodes the id", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, detail));

    const result = await fetchExerciseCatalogDetail(TOKEN, "00 01", { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "ok", exercise: detail });
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://api.test/exercises/catalog/00%2001",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("treats the reserved `facets` segment as not-found, without calling fetch", async () => {
    // `/exercises/facets` arrives here as id="facets" and used to build the
    // FACETS url. The API answers 200 with the facets object, the detail schema
    // then fails to parse, and the reader was told the library is unavailable.
    // There is no such exercise: it is a 404.
    const fetchImpl = vi.fn();

    const result = await fetchExerciseCatalogDetail(TOKEN, "facets", { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "not-found" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("maps a 404 to the distinct not-found result (drives Next.js notFound())", async () => {
    // Branching is on the STATUS, never on the body string — the API's actual
    // code is `exercise_not_found`, and asserting on it here would couple this
    // module to a message it does not read.
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(404, { error: "exercise_not_found" }));

    const result = await fetchExerciseCatalogDetail(TOKEN, "9999", { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "not-found" });
  });

  it("returns the API error code on another non-2xx response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(401, { error: "unauthorized" }));

    const result = await fetchExerciseCatalogDetail(TOKEN, "0001", { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "error", message: "unauthorized" });
  });

  it("falls back to a generic code when the error body carries none", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(500, {}));

    const result = await fetchExerciseCatalogDetail(TOKEN, "0001", { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "error", message: "fetch_exercise_catalog_failed" });
  });

  it("returns api_unreachable when fetch throws", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    const result = await fetchExerciseCatalogDetail(TOKEN, "0001", { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "error", message: "api_unreachable" });
  });

  it("returns invalid_response when the detail fails the contract schema", async () => {
    // The list projection is not a valid detail — it has no instructionSteps.
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, item));

    const result = await fetchExerciseCatalogDetail(TOKEN, "0001", { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "error", message: "invalid_response" });
  });
});

describe("fetchExerciseCatalogFacets", () => {
  it("returns an error when no session token is present, without calling fetch", async () => {
    const fetchImpl = vi.fn();

    const result = await fetchExerciseCatalogFacets(undefined, { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "error", message: "no_session" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns every facet group on a 200 response", async () => {
    const facets = {
      bodyPart: [{ value: "chest", count: 12 }],
      equipment: [{ value: "barbell", count: 34 }],
      target: [{ value: "pectorals", count: 5 }],
    };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, facets));

    const result = await fetchExerciseCatalogFacets(TOKEN, { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "ok", facets });
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://api.test/exercises/catalog/facets",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("degrades a missing or malformed group to an empty list rather than failing", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        bodyPart: [
          { value: "chest" }, // no count → 0
          { value: "" }, // blank label → dropped
          { count: 3 }, // no label → dropped
          "chest", // not an object → dropped
          null,
        ],
        equipment: "not-an-array",
        // `target` omitted entirely
      }),
    );

    const result = await fetchExerciseCatalogFacets(TOKEN, { ...OPTIONS, fetchImpl });

    expect(result).toEqual({
      kind: "ok",
      facets: {
        bodyPart: [{ value: "chest", count: 0 }],
        equipment: [],
        target: [],
      },
    });
  });

  it("returns the API error code on a non-2xx response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(403, { error: "forbidden" }));

    const result = await fetchExerciseCatalogFacets(TOKEN, { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "error", message: "forbidden" });
  });

  it("falls back to a generic code when the error body carries none", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(500, {}));

    const result = await fetchExerciseCatalogFacets(TOKEN, { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "error", message: "fetch_exercise_facets_failed" });
  });

  it("returns api_unreachable when fetch throws", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    const result = await fetchExerciseCatalogFacets(TOKEN, { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "error", message: "api_unreachable" });
  });

  it("returns invalid_response when the body is not an object", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, null));

    const result = await fetchExerciseCatalogFacets(TOKEN, { ...OPTIONS, fetchImpl });

    expect(result).toEqual({ kind: "error", message: "invalid_response" });
  });
});
