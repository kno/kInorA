import type { ReactElement, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { StatsSummaryDTO } from "@kinora/contracts";
import StatsPage from "../page";

type AnyProps = Record<string, unknown> & { children?: ReactNode };
type AnyElement = ReactElement<AnyProps>;

// StatsPage is a server component (`getTranslations`) — see
// `server-translator.ts` for why this is mocked rather than run for real
// (the real next-intl/server RSC build isn't available under Vitest).
vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => createServerTranslator()),
}));

vi.mock("../actions.js", () => ({
  getStatsAction: vi.fn(),
}));

import { getTranslations } from "next-intl/server";
import { getStatsAction } from "../actions.js";
import { createServerTranslator } from "@/test-utils/server-translator";

const zeroKpi = { value: 0, deltaVsPreviousPeriod: null };
const emptySummary: StatsSummaryDTO = {
  range: "month",
  totalVolumeKg: zeroKpi,
  sessionCount: zeroKpi,
  totalDurationMin: zeroKpi,
  prCount: zeroKpi,
  volumeTrend: { current: [], previous: [] },
  muscleGroupDistribution: [],
  personalRecords: [],
};

const populatedSummary: StatsSummaryDTO = {
  range: "month",
  totalVolumeKg: { value: 18340, deltaVsPreviousPeriod: 12 },
  sessionCount: { value: 16, deltaVsPreviousPeriod: -2 },
  totalDurationMin: { value: 1180, deltaVsPreviousPeriod: null },
  prCount: { value: 3, deltaVsPreviousPeriod: 1 },
  volumeTrend: { current: [980, 1240, 1080], previous: [740, 920, 860] },
  muscleGroupDistribution: [],
  personalRecords: [],
};

async function renderPage(searchParams: { range?: string } = {}) {
  return StatsPage({ searchParams: Promise.resolve(searchParams) });
}

describe("StatsPage", () => {
  it("renders the statistics heading via getTranslations", async () => {
    vi.mocked(getStatsAction).mockResolvedValueOnce({ kind: "ok", summary: emptySummary });

    const page = await renderPage();

    expect(textOf(page)).toContain("Statistics");
  });

  it("renders inside a kin-page wrapper", async () => {
    vi.mocked(getStatsAction).mockResolvedValueOnce({ kind: "ok", summary: emptySummary });

    const page = await renderPage();
    const main = findFirst(page, (el) => el.type === "main");
    expect(main).toBeDefined();
    expect(main?.props?.className).toContain("kin-page");
  });

  it("renders the period toggle with week/month/year, marking the active range", async () => {
    vi.mocked(getStatsAction).mockResolvedValueOnce({ kind: "ok", summary: emptySummary });

    const page = await renderPage({ range: "week" });
    const text = textOf(page);

    expect(text).toContain("Week");
    expect(text).toContain("Month");
    expect(text).toContain("Year");
    expect(getStatsAction).toHaveBeenCalledWith("week");
  });

  it("defaults to the 'month' range for an invalid or missing range param", async () => {
    vi.mocked(getStatsAction).mockResolvedValueOnce({ kind: "ok", summary: emptySummary });

    await renderPage({ range: "bogus" });

    expect(getStatsAction).toHaveBeenCalledWith("month");
  });

  it("renders the 4 KPI cards with values and deltas when data exists", async () => {
    vi.mocked(getStatsAction).mockResolvedValueOnce({ kind: "ok", summary: populatedSummary });

    const page = await renderPage();
    const text = textOf(page);

    expect(text).toContain("Total volume");
    expect(text).toContain("18340");
    expect(text).toContain("+12%");
    expect(text).toContain("Sessions");
    expect(text).toContain("16");
    expect(text).toContain("-2%");
    expect(text).toContain("PRs / records");
    expect(text).toContain("3");
    expect(text).toContain("+1%");
  });

  it("renders the null-delta 'new' state instead of a percentage or arrow", async () => {
    vi.mocked(getStatsAction).mockResolvedValueOnce({ kind: "ok", summary: populatedSummary });

    const page = await renderPage();
    const text = textOf(page);

    expect(text).toContain("New");
    expect(text).not.toMatch(/NaN|Infinity/);
  });

  it("renders the volume trend series when data exists", async () => {
    vi.mocked(getStatsAction).mockResolvedValueOnce({ kind: "ok", summary: populatedSummary });

    const page = await renderPage();
    const text = textOf(page);

    expect(text).toContain("Training volume");
    expect(text).toContain("This period");
    expect(text).toContain("Previous period");
  });

  it("renders an empty-trend message when there is no volume-trend data", async () => {
    vi.mocked(getStatsAction).mockResolvedValueOnce({ kind: "ok", summary: emptySummary });

    const page = await renderPage();
    const text = textOf(page);

    expect(text).toContain("Not enough data yet");
  });

  it("renders clearly-marked placeholders for distribution and PRs (Slice 3b)", async () => {
    vi.mocked(getStatsAction).mockResolvedValueOnce({ kind: "ok", summary: populatedSummary });

    const page = await renderPage();
    const text = textOf(page);

    expect(text).toContain("coming soon");
  });

  it("shows a fallback message when the fetch fails", async () => {
    vi.mocked(getStatsAction).mockResolvedValueOnce({ kind: "error", message: "no_session" });

    const page = await renderPage();

    expect(textOf(page)).toContain("Track your progress");
  });

  it("renders real Spanish copy from the ES catalog (not EN leakage)", async () => {
    vi.mocked(getTranslations).mockResolvedValueOnce(createServerTranslator("es"));
    vi.mocked(getStatsAction).mockResolvedValueOnce({ kind: "ok", summary: populatedSummary });

    const page = await renderPage();
    const text = textOf(page);

    expect(text).toContain("Estadísticas");
    expect(text).toContain("Volumen total");
    expect(text).toContain("Volumen de entrenamiento");
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
