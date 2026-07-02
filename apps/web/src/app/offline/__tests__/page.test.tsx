import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { headers } from "next/headers";
import OfflinePage from "../page";

type AnyProps = Record<string, unknown> & { children?: ReactNode };
type AnyElement = ReactElement<AnyProps>;

vi.mock("next/headers", () => ({
  headers: vi.fn(),
}));

const mockedHeaders = vi.mocked(headers);

describe("OfflinePage", () => {
  beforeEach(() => {
    mockedHeaders.mockResolvedValue(new Headers({ "accept-language": "en-US,en;q=0.9" }));
  });

  it("renders the offline heading", async () => {
    const page = await OfflinePage({ searchParams: Promise.resolve({ lang: "en" }) });
    expect(textOf(page)).toContain("You're Offline");
  });

  it("renders the offline description and sync note", async () => {
    const page = await OfflinePage({ searchParams: Promise.resolve({ lang: "en" }) });
    const text = textOf(page);
    expect(text).toContain("disconnected from the internet");
    expect(text).toContain("synced once you're back online");
  });

  it("renders inside a kin-offline wrapper", async () => {
    const page = await OfflinePage({ searchParams: Promise.resolve({ lang: "en" }) });
    const wrapper = findFirst(
      page,
      (el) => typeof el.props.className === "string" && el.props.className.includes("kin-offline"),
    );
    expect(wrapper).toBeDefined();
  });

  it("renders Spanish copy from the i18n catalog when lang=es", async () => {
    const page = await OfflinePage({ searchParams: Promise.resolve({ lang: "es" }) });
    const text = textOf(page);

    expect(text).toContain("Estás sin conexión");
    expect(text).toContain("conexión a internet");
    expect(text).toContain("se sincronizarán");
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
