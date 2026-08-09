// @vitest-environment jsdom
/**
 * 17d PR D — `/plan/[id]/edit` must never render a blank form over a failed
 * read. An empty editor invites the user to press Save, and Save is a
 * full-document replace: the blankness would land on a program that is still
 * perfectly fine on the server. Load failure, not-editable, and editable are
 * three distinct renders.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import type { ReactElement, ReactNode } from "react";

type AnyProps = Record<string, unknown> & { children?: ReactNode };
type AnyElement = ReactElement<AnyProps>;

function findFirst(
  node: ReactNode,
  match: (el: AnyElement) => boolean,
): AnyElement | undefined {
  if (typeof node === "object" && node !== null && "props" in node) {
    const el = node as AnyElement;
    if (match(el)) return el;
    const found = findFirst(el.props.children, match);
    if (found) return found;
  }
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findFirst(child, match);
      if (found) return found;
    }
  }
  return undefined;
}

const fetchPlanStatus = vi.fn();
const notFound = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});

vi.mock("next-intl/server", () => ({
  getTranslations: async () => createServerTranslator(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: "session-tok" }) }),
}));

vi.mock("next/navigation", () => ({
  notFound: () => notFound(),
}));

vi.mock("@/app/(app)/create-plan/plan-draft-client", () => ({
  fetchPlanStatus: (...args: unknown[]) => fetchPlanStatus(...args),
}));

vi.mock("../ProgramEditor.js", () => ({
  ProgramEditor: () => null,
}));

import ProgramEditPage from "../page";
import { ProgramEditor } from "../ProgramEditor";
import { createServerTranslator } from "@/test-utils/server-translator";

afterEach(() => {
  vi.clearAllMocks();
});

const params = Promise.resolve({ id: "plan-1" });

const readyPlan = {
  id: "plan-1",
  status: "ready",
  name: "Summer Cut",
  updatedAt: "2026-08-09T10:00:00.000Z",
  program: {
    weeklySessions: [
      {
        day: 1,
        title: "Push Day",
        exercises: [{ name: "Bench Press", sets: 3, reps: "8-10", restSeconds: 90 }],
      },
    ],
    limitationWarnings: [],
  },
};

describe("ProgramEditPage (17d PR D)", () => {
  it("renders a role=alert load error — never an empty editor — when the fetch fails", async () => {
    fetchPlanStatus.mockResolvedValue({ kind: "error", message: "api_unreachable" });

    const page = await ProgramEditPage({ params });

    expect(findFirst(page, (el) => el.props?.role === "alert")).toBeDefined();
    expect(findFirst(page, (el) => el.type === ProgramEditor)).toBeUndefined();
  });

  it("404s on a plan that does not belong to the caller", async () => {
    fetchPlanStatus.mockResolvedValue({ kind: "error", message: "not_found" });

    await expect(ProgramEditPage({ params })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalledTimes(1);
  });

  it("explains that a generating plan cannot be edited, without rendering the editor", async () => {
    fetchPlanStatus.mockResolvedValue({
      kind: "ok",
      plan: { id: "plan-1", status: "generating" },
    });

    const page = await ProgramEditPage({ params });

    expect(
      findFirst(page, (el) => el.props?.["data-testid"] === "plan-edit-not-ready"),
    ).toBeDefined();
    expect(findFirst(page, (el) => el.type === ProgramEditor)).toBeUndefined();
  });

  it("refuses to edit a ready plan that has no stored program", async () => {
    fetchPlanStatus.mockResolvedValue({
      kind: "ok",
      plan: { id: "plan-1", status: "ready", updatedAt: "2026-08-09T10:00:00.000Z" },
    });

    const page = await ProgramEditPage({ params });

    expect(findFirst(page, (el) => el.type === ProgramEditor)).toBeUndefined();
  });

  it("refuses to edit when the version token is missing, rather than saving blind", async () => {
    const { updatedAt: _dropped, ...withoutVersion } = readyPlan;
    fetchPlanStatus.mockResolvedValue({ kind: "ok", plan: withoutVersion });

    const page = await ProgramEditPage({ params });

    expect(findFirst(page, (el) => el.type === ProgramEditor)).toBeUndefined();
  });

  it("renders the editor with the program and its version for a ready plan", async () => {
    fetchPlanStatus.mockResolvedValue({ kind: "ok", plan: readyPlan });

    const page = await ProgramEditPage({ params });

    const editor = findFirst(page, (el) => el.type === ProgramEditor);
    expect(editor).toBeDefined();
    expect(editor?.props?.program).toEqual(readyPlan.program);
    expect(editor?.props?.updatedAt).toBe(readyPlan.updatedAt);
    expect(editor?.props?.planName).toBe("Summer Cut");
  });
});
