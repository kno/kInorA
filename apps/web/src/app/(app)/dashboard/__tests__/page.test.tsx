import type { ReactElement, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import DashboardPage from "../page";

type AnyProps = Record<string, unknown> & { children?: ReactNode };
type AnyElement = ReactElement<AnyProps>;

// DashboardPage is a server component (`getTranslations`) — see
// `server-translator.ts` for why this is mocked rather than run for real
// (the real next-intl/server RSC build isn't available under Vitest).
// `getTranslations` is a `vi.fn` (not a plain async arrow) so the ES-locale
// test below can override it for a single call via `mockResolvedValueOnce`.
vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => createServerTranslator()),
}));

vi.mock("../actions.js", () => ({
  logoutAction: vi.fn(),
}));

import { getTranslations } from "next-intl/server";
import { createServerTranslator } from "@/test-utils/server-translator";

describe("DashboardPage", () => {
  it("renders the dashboard heading via getTranslations, no messages.* access", async () => {
    const page = await DashboardPage();
    expect(textOf(page)).toContain("Dashboard");
  });

  it("confirms the user is authenticated", async () => {
    const page = await DashboardPage();
    expect(textOf(page)).toContain("You are authenticated");
  });

  it("renders a logout button inside a form", async () => {
    const page = await DashboardPage();

    const submit = findFirst(page, (el) => el.props.type === "submit");
    expect(submit).toBeDefined();
    expect(textOf(submit)).toMatch(/log\s*out/i);

    // The submit button must be inside a <form> (logout uses a server action)
    const form = findFirst(page, (el) => el.type === "form");
    expect(form).toBeDefined();
  });

  it("renders real Spanish copy from the ES catalog (not EN leakage)", async () => {
    vi.mocked(getTranslations).mockResolvedValueOnce(createServerTranslator("es"));
    const page = await DashboardPage();
    const text = textOf(page);

    expect(text).toContain("Panel");
    expect(text).toContain("Has iniciado sesión.");
    expect(text).toContain("Cerrar sesión");
  });
});

// --- React tree inspection helpers (mirror login/sign-up page tests) ---

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
