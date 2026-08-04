import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExerciseCatalogDetail } from "@kinora/contracts";
import ExerciseDetailPage from "../page";

type AnyProps = Record<string, unknown> & { children?: ReactNode };
type AnyElement = ReactElement<AnyProps>;

// Server component — see `server-translator.ts` for why next-intl/server is
// mocked rather than run for real under Vitest.
vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => createServerTranslator()),
  getLocale: vi.fn(async () => "en"),
}));

const notFound = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});
vi.mock("next/navigation", () => ({
  notFound: () => notFound(),
}));

const getExerciseCatalogDetailAction = vi.fn();
vi.mock("../../actions", () => ({
  getExerciseCatalogDetailAction: (...args: unknown[]) => getExerciseCatalogDetailAction(...args),
}));

import { getLocale, getTranslations } from "next-intl/server";
import { createServerTranslator } from "@/test-utils/server-translator";

const exercise: ExerciseCatalogDetail = {
  id: "0001",
  name: "3/4 sit-up",
  bodyPart: "waist",
  equipment: "body weight",
  target: "abs",
  muscleGroup: "hip flexors",
  imagePath: "/exercises/images/0001-abc.jpg",
  gifPath: "https://cdn.jsdelivr.net/gh/hasaneyldrm/exercises-dataset@7455efae41b330c265e7cd4b78dfa848e7ce5ebd/videos/0001-abc.gif",
  attribution: "(c) Gym visual — https://gymvisual.com/",
  secondaryMuscles: ["hip flexors", "lower back"],
  instructionSteps: {
    en: ["Lie on your back.", "Curl up."],
    es: ["Túmbate boca arriba.", "Eleva el tronco."],
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  getExerciseCatalogDetailAction.mockResolvedValue({ kind: "ok", exercise });
});

describe("ExerciseDetailPage", () => {
  it("fetches the exercise by its route id", async () => {
    await ExerciseDetailPage({ params: Promise.resolve({ id: "0001" }) });
    expect(getExerciseCatalogDetailAction).toHaveBeenCalledWith("0001");
  });

  it("renders the exercise name and its real tags (no invented level or summary)", async () => {
    const page = await ExerciseDetailPage({ params: Promise.resolve({ id: "0001" }) });
    const text = textOf(page);

    expect(text).toContain("3/4 sit-up");
    expect(text).toContain("body weight");
    expect(text).toContain("waist");
    expect(text).toContain("abs");
  });

  it("renders the three stats from real fields (body part replaces the prototype's set scheme)", async () => {
    const page = await ExerciseDetailPage({ params: Promise.resolve({ id: "0001" }) });
    const stats = findAll(page, (el) => el.props?.className === "kin-ex-stat");

    expect(stats).toHaveLength(3);
    expect(textOf(stats[2])).toContain("hip flexors · lower back");
  });

  it("renders an em dash when the record has no assisting muscles", async () => {
    getExerciseCatalogDetailAction.mockResolvedValue({
      kind: "ok",
      exercise: { ...exercise, secondaryMuscles: [] },
    });
    const page = await ExerciseDetailPage({ params: Promise.resolve({ id: "0001" }) });
    const stats = findAll(page, (el) => el.props?.className === "kin-ex-stat");

    expect(textOf(stats[2])).toContain("—");
  });

  it("passes both media paths to the toggleable media card", async () => {
    const page = await ExerciseDetailPage({ params: Promise.resolve({ id: "0001" }) });
    const media = findFirst(page, (el) => Boolean(el.props?.gifPath));

    expect(media?.props?.gifPath).toBe(exercise.gifPath);
    expect(media?.props?.imagePath).toBe(exercise.imagePath);
  });

  it("resolves the instruction steps to the reader's locale — English", async () => {
    const page = await ExerciseDetailPage({ params: Promise.resolve({ id: "0001" }) });
    const tabs = findFirst(page, (el) => Boolean(el.props?.steps));

    expect(tabs?.props?.steps).toEqual(exercise.instructionSteps.en);
  });

  it("resolves the instruction steps to the reader's locale — Spanish", async () => {
    vi.mocked(getLocale).mockResolvedValueOnce("es");
    const page = await ExerciseDetailPage({ params: Promise.resolve({ id: "0001" }) });
    const tabs = findFirst(page, (el) => Boolean(el.props?.steps));

    expect(tabs?.props?.steps).toEqual(exercise.instructionSteps.es);
  });

  it("falls back to English for an unshipped locale", async () => {
    vi.mocked(getLocale).mockResolvedValueOnce("fr");
    const page = await ExerciseDetailPage({ params: Promise.resolve({ id: "0001" }) });
    const tabs = findFirst(page, (el) => Boolean(el.props?.steps));

    expect(tabs?.props?.steps).toEqual(exercise.instructionSteps.en);
  });

  it("links back to the library and to this exercise's history", async () => {
    const page = await ExerciseDetailPage({ params: Promise.resolve({ id: "0001" }) });
    const hrefs = findAll(page, (el) => el.type === "a").map((el) => el.props?.href);

    expect(hrefs).toContain("/exercises");
    expect(hrefs).toContain("/exercises?title=3%2F4%20sit-up");
  });

  it("offers exactly ONE back-to-library affordance", async () => {
    const page = await ExerciseDetailPage({ params: Promise.resolve({ id: "0001" }) });
    const backLinks = findAll(page, (el) => el.type === "a" && el.props?.href === "/exercises");

    expect(backLinks).toHaveLength(1);
  });

  it("derives the summary from real record fields, inventing no prose", async () => {
    const page = await ExerciseDetailPage({ params: Promise.resolve({ id: "0001" }) });
    const summary = findFirst(page, (el) => el.props?.className === "kin-ex-summary");

    // Only the sentence frame is translated; the three values are verbatim.
    expect(textOf(summary)).toBe("body weight exercise targeting abs · waist");
  });

  it("renders the summary between the name and the stats row", async () => {
    const page = await ExerciseDetailPage({ params: Promise.resolve({ id: "0001" }) });
    const detail = findFirst(page, (el) => el.props?.className === "kin-ex-detail");
    const order = findAll(detail, (el) =>
      ["kin-ex-name", "kin-ex-summary", "kin-ex-stats"].includes(String(el.props?.className)),
    ).map((el) => el.props?.className);

    expect(order).toEqual(["kin-ex-name", "kin-ex-summary", "kin-ex-stats"]);
  });

  it("renders a fully Spanish summary — frame AND taxonomy values", async () => {
    vi.mocked(getTranslations).mockResolvedValueOnce(createServerTranslator("es"));
    const page = await ExerciseDetailPage({ params: Promise.resolve({ id: "0001" }) });
    const summary = findFirst(page, (el) => el.props?.className === "kin-ex-summary");

    // No spanglish: "body weight"/"abs"/"waist" must not survive into ES copy.
    expect(textOf(summary)).toBe("Ejercicio de peso corporal para abdominales · zona media");
  });

  it("translates the tags and stat values for the ES locale", async () => {
    vi.mocked(getTranslations).mockResolvedValueOnce(createServerTranslator("es"));
    const page = await ExerciseDetailPage({ params: Promise.resolve({ id: "0001" }) });
    const text = textOf(page);

    expect(text).toContain("Peso corporal");
    expect(text).toContain("Zona media");
    expect(text).toContain("Abdominales");
    expect(text).toContain("flexores de la cadera · zona lumbar");
    expect(text).not.toContain("body weight");
  });

  it("surfaces the record's own media copyright notice", async () => {
    const page = await ExerciseDetailPage({ params: Promise.resolve({ id: "0001" }) });
    expect(textOf(page)).toContain("(c) Gym visual");
  });

  it("renders the attribution block (licensing obligation)", async () => {
    const page = await ExerciseDetailPage({ params: Promise.resolve({ id: "0001" }) });
    const attribution = findFirst(
      page,
      (el) => typeof el.type === "function" && el.type.name === "ExerciseAttribution",
    );
    expect(attribution).toBeDefined();
  });

  it("renders Spanish copy from the ES catalog (not EN leakage)", async () => {
    vi.mocked(getTranslations).mockResolvedValueOnce(createServerTranslator("es"));
    const page = await ExerciseDetailPage({ params: Promise.resolve({ id: "0001" }) });

    expect(textOf(page)).toContain("Volver a la biblioteca");
  });

  it("calls notFound() for an unknown id", async () => {
    getExerciseCatalogDetailAction.mockResolvedValue({ kind: "not-found" });

    await expect(
      ExerciseDetailPage({ params: Promise.resolve({ id: "9999" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalled();
  });

  it("renders an error card (not a 404) when the library is unreachable", async () => {
    getExerciseCatalogDetailAction.mockResolvedValue({ kind: "error", message: "api_unreachable" });
    const page = await ExerciseDetailPage({ params: Promise.resolve({ id: "0001" }) });

    expect(notFound).not.toHaveBeenCalled();
    expect(findFirst(page, (el) => el.props?.["data-testid"] === "exercise-detail-error")).toBeDefined();
    expect(textOf(page)).toContain("Back to the library");
  });
});

// --- React tree inspection helpers ---

function findFirst(node: ReactNode, match: (el: AnyElement) => boolean): AnyElement | undefined {
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
