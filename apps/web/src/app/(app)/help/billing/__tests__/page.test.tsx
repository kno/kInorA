import type { ReactElement, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import BillingHelpPage from "../page";

type AnyProps = Record<string, unknown> & { children?: ReactNode };
type AnyElement = ReactElement<AnyProps>;

// Server component (`getTranslations`) — mocked, matching the pattern used by
// the other (app) page tests (the real next-intl RSC build isn't available
// under Vitest). See `server-translator.ts`.
vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => createServerTranslator()),
}));

import { getTranslations } from "next-intl/server";
import { createServerTranslator } from "@/test-utils/server-translator";

describe("BillingHelpPage (/help/billing) — #199", () => {
  it("renders the billing FAQ heading and answers from the catalog", async () => {
    const page = await BillingHelpPage();
    const text = textOf(page);

    expect(text).toContain("Billing help");
    expect(text).toContain("How do I upgrade to Pro?");
    expect(text).toContain("Where can I find my invoices and receipts?");
    expect(text).toContain("What happens when my trial or subscription ends?");
  });

  it("links back to the billing page (reachable destination, not a dead end)", async () => {
    const page = await BillingHelpPage();
    const back = findFirst(page, (el) => el.props?.href === "/billing");
    expect(back).toBeDefined();
  });

  it("renders inside a kin-page wrapper", async () => {
    const page = await BillingHelpPage();
    const main = findFirst(page, (el) => el.type === "main");
    expect(main?.props?.className).toContain("kin-page");
  });

  it("renders real Spanish copy from the ES catalog (not EN leakage)", async () => {
    vi.mocked(getTranslations).mockResolvedValueOnce(createServerTranslator("es"));
    const page = await BillingHelpPage();
    const text = textOf(page);

    expect(text).toContain("Ayuda de facturación");
    expect(text).toContain("¿Cómo mejoro a Pro?");
  });
});

// --- React tree inspection helpers (same shape as stats/__tests__/page.test) ---

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
