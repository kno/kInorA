import type { ReactElement, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import StatsPage from "../page";

type AnyProps = Record<string, unknown> & { children?: ReactNode };
type AnyElement = ReactElement<AnyProps>;

// StatsPage is a server component (`getTranslations`) — see
// `server-translator.ts` for why this is mocked rather than run for real
// (the real next-intl/server RSC build isn't available under Vitest).
// `getTranslations` is a `vi.fn` (not a plain async arrow) so the ES-locale
// test below can override it for a single call via `mockResolvedValueOnce`.
vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => createServerTranslator()),
}));

import { getTranslations } from "next-intl/server";
import { createServerTranslator } from "@/test-utils/server-translator";

describe("StatsPage", () => {
  it("renders the statistics heading via getTranslations, no messages.* access", async () => {
    const page = await StatsPage();
    expect(textOf(page)).toContain("Statistics");
  });

  it("renders placeholder description text", async () => {
    const page = await StatsPage();
    expect(textOf(page)).toContain("progress");
  });

  it("renders inside a kin-page wrapper", async () => {
    const page = await StatsPage();
    const main = findFirst(page, (el) => el.type === "main");
    expect(main).toBeDefined();
    expect(main?.props?.className).toContain("kin-page");
  });

  it("renders real Spanish copy from the ES catalog (not EN leakage)", async () => {
    vi.mocked(getTranslations).mockResolvedValueOnce(createServerTranslator("es"));
    const page = await StatsPage();
    const text = textOf(page);

    expect(text).toContain("Estadísticas");
    expect(text).toContain("Sigue tu progreso y revisa tu historial de entrenamiento.");
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
