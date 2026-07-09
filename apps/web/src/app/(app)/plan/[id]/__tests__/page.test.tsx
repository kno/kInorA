// @vitest-environment jsdom
/**
 * Tests for PlanStatusPage (`/plan/[id]`) — a server component. It renders no
 * localized text of its own (it delegates entirely to PlanStatusClient), so
 * these tests assert the i18n-migration contract: no `resolveLocale`/
 * `loadMessages` threading, and no `messages` prop passed to the client child.
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

// --- Module mocks ---

const cookiesGet = vi.fn();
const fetchPlanStatus = vi.fn();
const notFound = vi.fn();

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: cookiesGet })),
}));

vi.mock("next/navigation", () => ({
  notFound: (...args: unknown[]) => notFound(...args),
}));

vi.mock("@/app/(app)/create-plan/plan-draft-client", () => ({
  fetchPlanStatus: (...args: unknown[]) => fetchPlanStatus(...args),
}));

vi.mock("../PlanStatusClient", () => ({
  PlanStatusClient: (props: AnyProps) => null,
}));

import PlanStatusPage from "../page";
import { PlanStatusClient } from "../PlanStatusClient";

afterEach(() => {
  vi.clearAllMocks();
});

describe("PlanStatusPage — no message threading (i18n migration)", () => {
  it("does NOT pass a messages prop to PlanStatusClient", async () => {
    cookiesGet.mockReturnValue(undefined);
    fetchPlanStatus.mockResolvedValue({
      kind: "ok",
      plan: { id: "plan-1", status: "generating" },
    });

    const page = await PlanStatusPage({ params: Promise.resolve({ id: "plan-1" }) });
    const client = findFirst(page, (el) => el.type === PlanStatusClient);
    expect(client).toBeDefined();
    expect(client?.props?.messages).toBeUndefined();
  });

  it("passes the fetched plan status through to PlanStatusClient", async () => {
    cookiesGet.mockReturnValue(undefined);
    fetchPlanStatus.mockResolvedValue({
      kind: "ok",
      plan: { id: "plan-1", status: "ready", program: { weeklySessions: [] } },
    });

    const page = await PlanStatusPage({ params: Promise.resolve({ id: "plan-1" }) });
    const client = findFirst(page, (el) => el.type === PlanStatusClient);
    expect(client?.props?.initialStatus).toBe("ready");
  });

  it("calls notFound() when fetchPlanStatus reports not_found", async () => {
    cookiesGet.mockReturnValue(undefined);
    fetchPlanStatus.mockResolvedValue({ kind: "error", message: "not_found" });

    await PlanStatusPage({ params: Promise.resolve({ id: "plan-missing" }) });
    expect(notFound).toHaveBeenCalled();
  });
});
