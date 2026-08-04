import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExerciseCatalogItem } from "@kinora/contracts";
import ExercisesPage from "../page";

type AnyProps = Record<string, unknown> & { children?: ReactNode };
type AnyElement = ReactElement<AnyProps>;

// ExercisesPage is a server component (`getTranslations`) — see
// `server-translator.ts` for why this is mocked rather than run for real
// (the real next-intl/server RSC build isn't available under Vitest).
// `getTranslations` is a `vi.fn` (not a plain async arrow) so the ES-locale
// test below can override it for a single call via `mockResolvedValueOnce`.
vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => createServerTranslator()),
}));

const getExerciseDetailAction = vi.fn();
const listExerciseCatalogAction = vi.fn();
const getExerciseCatalogFacetsAction = vi.fn();
vi.mock("../actions", () => ({
  getExerciseDetailAction: (...args: unknown[]) => getExerciseDetailAction(...args),
  listExerciseCatalogAction: (...args: unknown[]) => listExerciseCatalogAction(...args),
  getExerciseCatalogFacetsAction: (...args: unknown[]) => getExerciseCatalogFacetsAction(...args),
}));

import { getTranslations } from "next-intl/server";
import { createServerTranslator } from "@/test-utils/server-translator";

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

beforeEach(() => {
  vi.clearAllMocks();
  getExerciseDetailAction.mockResolvedValue({
    kind: "ok",
    detail: { exerciseTitle: "Unused", recentSets: [] },
  });
  listExerciseCatalogAction.mockResolvedValue({
    kind: "ok",
    page: { items: [item], total: 1, limit: 24, offset: 0 },
  });
  getExerciseCatalogFacetsAction.mockResolvedValue({
    kind: "ok",
    facets: {
      bodyPart: [{ value: "waist", count: 1 }],
      equipment: [],
      target: [],
    },
  });
});

describe("ExercisesPage", () => {
  it("renders the exercises heading via getTranslations, no messages.* access", async () => {
    const page = await ExercisesPage({});
    expect(textOf(page)).toContain("Exercises");
  });

  it("renders placeholder description text", async () => {
    const page = await ExercisesPage({});
    expect(textOf(page)).toContain("exercise library");
  });

  it("renders inside a kin-page wrapper", async () => {
    const page = await ExercisesPage({});
    const main = findFirst(page, (el) => el.type === "main");
    expect(main).toBeDefined();
    expect(main?.props?.className).toContain("kin-page");
  });

  it("renders real Spanish copy from the ES catalog (not EN leakage)", async () => {
    vi.mocked(getTranslations).mockResolvedValueOnce(createServerTranslator("es"));
    const page = await ExercisesPage({});
    const text = textOf(page);

    expect(text).toContain("Ejercicios");
    expect(text).toContain("biblioteca de ejercicios");
  });
});

describe("ExercisesPage — read-only history reference (09c-v1 Slice 4b)", () => {
  it("omits the history section when there is no ?title= selected (no fetch, no error)", async () => {
    const page = await ExercisesPage({ searchParams: Promise.resolve({}) });
    expect(getExerciseDetailAction).not.toHaveBeenCalled();
    expect(findFirst(page, (el) => el.props?.["data-testid"] === "exercise-history")).toBeUndefined();
  });

  it("omits the section when the exercise has no history (empty recentSets)", async () => {
    getExerciseDetailAction.mockResolvedValue({
      kind: "ok",
      detail: { exerciseTitle: "Never Performed", recentSets: [] },
    });
    const page = await ExercisesPage({ searchParams: Promise.resolve({ title: "Never Performed" }) });

    expect(getExerciseDetailAction).toHaveBeenCalledWith("Never Performed");
    expect(findFirst(page, (el) => el.props?.["data-testid"] === "exercise-history")).toBeUndefined();
  });

  it("renders recent sets when history exists", async () => {
    getExerciseDetailAction.mockResolvedValue({
      kind: "ok",
      detail: {
        exerciseTitle: "Bench Press",
        recentSets: [{ completedAt: "2026-07-10T09:00:00.000Z", weightKg: 80, actualReps: 8, rpe: 8 }],
      },
    });
    const page = await ExercisesPage({ searchParams: Promise.resolve({ title: "Bench Press" }) });

    const text = textOf(page);
    expect(text).toContain("Recent history");
    expect(text).toContain("80");
    expect(text).toContain("8");
  });

  it("still renders the library alongside the history section", async () => {
    getExerciseDetailAction.mockResolvedValue({
      kind: "ok",
      detail: {
        exerciseTitle: "Bench Press",
        recentSets: [{ completedAt: "2026-07-10T09:00:00.000Z", weightKg: 80, actualReps: 8, rpe: 8 }],
      },
    });
    const page = await ExercisesPage({ searchParams: Promise.resolve({ title: "Bench Press" }) });

    expect(findFirst(page, (el) => el.props?.["data-testid"] === "exercise-history")).toBeDefined();
    expect(findFirst(page, (el) => el.props?.["data-testid"] === "exercise-library-grid")).toBeDefined();
  });
});

describe("ExercisesPage — library grid", () => {
  it("renders a card per item, linking to the detail route", async () => {
    const page = await ExercisesPage({ searchParams: Promise.resolve({}) });

    const link = findFirst(page, (el) => el.props?.className === "kin-ex-card");
    expect(link?.props?.href).toBe("/exercises/0001");
    expect(textOf(page)).toContain("3/4 sit-up");
  });

  it("requests only one page of results — never the whole catalog", async () => {
    await ExercisesPage({ searchParams: Promise.resolve({}) });

    expect(listExerciseCatalogAction).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 24, offset: 0 }),
    );
  });

  it("forwards the search and filter query parameters to the API", async () => {
    await ExercisesPage({
      searchParams: Promise.resolve({
        search: "press",
        bodyPart: "chest",
        equipment: "barbell",
        target: "pectorals",
      }),
    });

    expect(listExerciseCatalogAction).toHaveBeenCalledWith(
      expect.objectContaining({
        search: "press",
        bodyPart: "chest",
        equipment: "barbell",
        target: "pectorals",
      }),
    );
  });

  it("renders the empty state when nothing matches", async () => {
    listExerciseCatalogAction.mockResolvedValue({
      kind: "ok",
      page: { items: [], total: 0, limit: 24, offset: 0 },
    });
    const page = await ExercisesPage({ searchParams: Promise.resolve({ search: "zzz" }) });

    expect(findFirst(page, (el) => el.props?.["data-testid"] === "exercise-library-empty")).toBeDefined();
    expect(findFirst(page, (el) => el.props?.["data-testid"] === "exercise-library-grid")).toBeUndefined();
  });

  it("renders an error card when the catalog cannot be read", async () => {
    listExerciseCatalogAction.mockResolvedValue({ kind: "error", message: "api_unreachable" });
    const page = await ExercisesPage({ searchParams: Promise.resolve({}) });

    expect(findFirst(page, (el) => el.props?.["data-testid"] === "exercise-library-error")).toBeDefined();
    expect(textOf(page)).toContain("library is unavailable");
  });

  it("falls back to empty filter chips when the facets call fails (page still renders)", async () => {
    getExerciseCatalogFacetsAction.mockResolvedValue({ kind: "error", message: "api_unreachable" });
    const page = await ExercisesPage({ searchParams: Promise.resolve({}) });

    const controls = findFirst(page, (el) => Boolean(el.props?.facets));
    expect(controls?.props?.facets).toEqual({ bodyPart: [], equipment: [], target: [] });
  });

  it("renders the attribution block (licensing obligation, both views)", async () => {
    const page = await ExercisesPage({ searchParams: Promise.resolve({}) });
    const attribution = findFirst(
      page,
      (el) => typeof el.type === "function" && el.type.name === "ExerciseAttribution",
    );
    expect(attribution).toBeDefined();
  });
});

describe("ExercisesPage — pagination", () => {
  it("hides the previous link on the first page and offers the next one", async () => {
    listExerciseCatalogAction.mockResolvedValue({
      kind: "ok",
      page: { items: [item], total: 100, limit: 24, offset: 0 },
    });
    const page = await ExercisesPage({ searchParams: Promise.resolve({}) });

    const links = findAll(page, (el) => el.type === "a" && el.props?.className === "kin-btn kin-btn--ghost");
    expect(links).toHaveLength(1);
    expect(links[0]?.props?.href).toBe("/exercises?offset=24");
  });

  it("offers both links in the middle of the result set, preserving the filters", async () => {
    listExerciseCatalogAction.mockResolvedValue({
      kind: "ok",
      page: { items: [item], total: 100, limit: 24, offset: 48 },
    });
    const page = await ExercisesPage({
      searchParams: Promise.resolve({ offset: "48", search: "press" }),
    });

    const hrefs = findAll(page, (el) => el.type === "a" && el.props?.className === "kin-btn kin-btn--ghost").map(
      (el) => el.props?.href,
    );
    expect(hrefs).toEqual(["/exercises?search=press&offset=24", "/exercises?search=press&offset=72"]);
  });

  it("steps by the limit the API APPLIED, not the one we requested (it clamps)", async () => {
    listExerciseCatalogAction.mockResolvedValue({
      kind: "ok",
      // The API clamps an over-max limit and echoes the applied window.
      page: { items: [item], total: 500, limit: 100, offset: 100 },
    });
    const page = await ExercisesPage({ searchParams: Promise.resolve({ offset: "100" }) });

    const hrefs = findAll(page, (el) => el.type === "a" && el.props?.className === "kin-btn kin-btn--ghost").map(
      (el) => el.props?.href,
    );
    expect(hrefs).toEqual(["/exercises", "/exercises?offset=200"]);
  });

  it("reports the visible window", async () => {
    listExerciseCatalogAction.mockResolvedValue({
      kind: "ok",
      page: { items: [item], total: 100, limit: 24, offset: 24 },
    });
    const page = await ExercisesPage({ searchParams: Promise.resolve({ offset: "24" }) });

    const status = findFirst(page, (el) => el.props?.["data-testid"] === "exercise-library-page-status");
    expect(textOf(status)).toContain("25");
    expect(textOf(status)).toContain("100");
  });
});

// --- React tree inspection helpers ---

function findFirst(
  node: ReactNode,
  match: (el: AnyElement) => boolean,
): AnyElement | undefined {
  if (isReactElement(node)) {
    if (match(node)) return node;
    const inChildren = findFirst(node.props.children, match);
    if (inChildren) return inChildren;
  }
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findFirst(child, match);
      if (found) return found;
    }
  }
  return undefined;
}

function findAll(node: ReactNode, match: (el: AnyElement) => boolean): AnyElement[] {
  const found: AnyElement[] = [];
  if (isReactElement(node)) {
    if (match(node)) found.push(node);
    found.push(...findAll(node.props.children, match));
  }
  if (Array.isArray(node)) {
    for (const child of node) found.push(...findAll(child, match));
  }
  return found;
}

function textOf(node: ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isReactElement(node)) return textOf(node.props.children);
  return "";
}

function isReactElement(node: ReactNode): node is AnyElement {
  return typeof node === "object" && node !== null && "props" in node;
}
