import type { ReactElement, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { DashboardSummaryDTO } from "@kinora/contracts";
import DashboardPage from "../page";

type AnyProps = Record<string, unknown> & { children?: ReactNode };
type AnyElement = ReactElement<AnyProps>;

// DashboardPage is a server component (`getTranslations`/`getLocale`) — see
// `server-translator.ts` for why this is mocked rather than run for real
// (the real next-intl/server RSC build isn't available under Vitest).
vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => createServerTranslator()),
  getLocale: vi.fn(async () => "en"),
}));

vi.mock("../actions.js", () => ({
  logoutAction: vi.fn(),
  getDashboardAction: vi.fn(),
}));

import { getTranslations, getLocale } from "next-intl/server";
import { getDashboardAction } from "../actions.js";
import { createServerTranslator } from "@/test-utils/server-translator";

const emptySummary: DashboardSummaryDTO = {
  streak: 0,
  recentDailyCompletion: [false, false, false, false, false, false, false],
  weeklyCompleted: 0,
  weeklyPlanned: 0,
  weeklyRollup: [],
};

const populatedSummary: DashboardSummaryDTO = {
  streak: 3,
  recentDailyCompletion: [false, false, false, false, true, true, true],
  weeklyCompleted: 2,
  weeklyPlanned: 5,
  weeklyRollup: [
    { dayIndex: 0, focus: "Tirón técnico", loadKg: 500, loadPercent: 100 },
    { dayIndex: 1, focus: "Pierna ligera", loadKg: 0, loadPercent: 0 },
  ],
};

describe("DashboardPage", () => {
  it("shows the guiding empty state when there is no workout history", async () => {
    vi.mocked(getDashboardAction).mockResolvedValueOnce({ kind: "ok", summary: emptySummary });

    const page = await DashboardPage();

    expect(textOf(page)).toContain("No workouts yet");
    expect(textOf(page)).toContain("Create a plan or start a workout");
  });

  it("shows the guiding empty state when the fetch fails", async () => {
    vi.mocked(getDashboardAction).mockResolvedValueOnce({ kind: "error", message: "no_session" });

    const page = await DashboardPage();

    expect(textOf(page)).toContain("No workouts yet");
  });

  it("renders the streak, weekly progress, and week-route strip when there is data", async () => {
    vi.mocked(getDashboardAction).mockResolvedValueOnce({ kind: "ok", summary: populatedSummary });

    const page = await DashboardPage();
    const text = textOf(page);

    expect(text).toContain("Active streak");
    expect(text).toContain("3 consecutive training days");
    expect(text).toContain("Weekly progress");
    expect(text).toContain("2");
    expect(text).toContain("/5");
    expect(text).toContain("Load route");
    expect(text).toContain("Tirón técnico");
  });

  it("renders a logout button inside a form", async () => {
    vi.mocked(getDashboardAction).mockResolvedValueOnce({ kind: "ok", summary: populatedSummary });

    const page = await DashboardPage();

    const submit = findFirst(page, (el) => el.props.type === "submit");
    expect(submit).toBeDefined();
    expect(textOf(submit)).toMatch(/log\s*out/i);
    const form = findFirst(page, (el) => el.type === "form");
    expect(form).toBeDefined();
  });

  it("renders real Spanish copy from the ES catalog (not EN leakage)", async () => {
    vi.mocked(getTranslations).mockResolvedValueOnce(createServerTranslator("es"));
    vi.mocked(getLocale).mockResolvedValueOnce("es");
    vi.mocked(getDashboardAction).mockResolvedValueOnce({ kind: "ok", summary: populatedSummary });

    const page = await DashboardPage();
    const text = textOf(page);

    expect(text).toContain("Racha activa");
    expect(text).toContain("Progreso semanal");
    expect(text).toContain("Ruta de carga");
    expect(text).toContain("Cerrar sesión");
  });
});

// --- React tree inspection helpers (mirror login/sign-up/history page tests) ---

function findFirst(
  node: ReactNode,
  match: (el: AnyElement) => boolean
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
