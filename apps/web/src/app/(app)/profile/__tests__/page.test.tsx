import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { headers } from "next/headers";
import ProfilePage from "../page";

type AnyProps = Record<string, unknown> & { children?: ReactNode };
type AnyElement = ReactElement<AnyProps>;

vi.mock("next/headers", () => ({
  headers: vi.fn(),
}));

const mockedHeaders = vi.mocked(headers);

describe("ProfilePage", () => {
  beforeEach(() => {
    mockedHeaders.mockResolvedValue(new Headers({ "accept-language": "en-US,en;q=0.9" }));
  });

  it("renders the profile heading", async () => {
    const page = await ProfilePage({ searchParams: Promise.resolve({ lang: "en" }) });
    expect(textOf(page)).toContain("Profile");
  });

  it("renders placeholder description text", async () => {
    const page = await ProfilePage({ searchParams: Promise.resolve({ lang: "en" }) });
    expect(textOf(page)).toContain("account settings");
  });

  it("renders inside a kin-page wrapper", async () => {
    const page = await ProfilePage({ searchParams: Promise.resolve({ lang: "en" }) });
    const main = findFirst(page, (el) => el.type === "main");
    expect(main).toBeDefined();
    expect(main?.props?.className).toContain("kin-page");
  });

  it("renders Spanish copy from the i18n catalog when lang=es", async () => {
    const page = await ProfilePage({ searchParams: Promise.resolve({ lang: "es" }) });
    const text = textOf(page);

    expect(text).toContain("Perfil");
    expect(text).toContain("ajustes");
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
