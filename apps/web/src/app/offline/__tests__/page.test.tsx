import type { ReactElement, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import OfflinePage from "../page";

type AnyProps = Record<string, unknown> & { children?: ReactNode };
type AnyElement = ReactElement<AnyProps>;

// OfflinePage is a server component (`getTranslations`) — see
// `server-translator.ts` for why this is mocked rather than run for real
// (the real next-intl/server RSC build isn't available under Vitest).
// `getTranslations` is a `vi.fn` (not a plain async arrow) so the ES-locale
// test below can override it for a single call via `mockResolvedValueOnce`.
vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => createServerTranslator()),
}));

import { getTranslations } from "next-intl/server";
import { createServerTranslator } from "@/test-utils/server-translator";

describe("OfflinePage", () => {
  it("renders the offline heading via getTranslations, no messages.* access", async () => {
    const page = await OfflinePage();
    expect(textOf(page)).toContain("You're Offline");
  });

  it("renders the offline description and sync note", async () => {
    const page = await OfflinePage();
    const text = textOf(page);
    expect(text).toContain("disconnected from the internet");
    expect(text).toContain("synced once you're back online");
  });

  it("renders inside a kin-offline wrapper", async () => {
    const page = await OfflinePage();
    const wrapper = findFirst(
      page,
      (el) => typeof el.props.className === "string" && el.props.className.includes("kin-offline"),
    );
    expect(wrapper).toBeDefined();
  });

  it("renders real Spanish copy from the ES catalog (not EN leakage)", async () => {
    vi.mocked(getTranslations).mockResolvedValueOnce(createServerTranslator("es"));
    const page = await OfflinePage();
    const text = textOf(page);

    expect(text).toContain("Estás sin conexión");
    expect(text).toContain("no tienes conexión a internet");
    expect(text).toContain("Tus datos se sincronizarán cuando vuelvas a tener conexión.");
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
