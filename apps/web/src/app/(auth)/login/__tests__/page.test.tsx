import type { ReactElement, ReactNode } from "react";
import { describe, expect, it } from "vitest";
import LoginPage from "../page";

type AnyProps = Record<string, unknown> & { children?: ReactNode };
type AnyElement = ReactElement<AnyProps>;

describe("LoginPage", () => {
  it("renders an email/password form and a Google sign-in link", async () => {
    const page = await LoginPage({ searchParams: Promise.resolve({}) });

    const email = findInputByName(page, "email");
    expect(email).toBeDefined();
    expect(email?.props.type).toBe("email");
    expect(email?.props.required).toBe(true);

    const password = findInputByName(page, "password");
    expect(password).toBeDefined();
    expect(password?.props.type).toBe("password");
    expect(password?.props.required).toBe(true);

    const submit = findFirst(page, (el) => el.props.type === "submit");
    expect(submit).toBeDefined();

    const google = findFirst(page, (el) => typeof el.props.href === "string");
    expect(google?.props.href).toBe("/auth/social/login?provider=google");
    expect(textOf(google)).toMatch(/google/i);
  });

  it("shows the error message when an error query param is present", async () => {
    const page = await LoginPage({
      searchParams: Promise.resolve({ error: "invalid_credentials" }),
    });

    expect(textOf(page)).toContain("invalid_credentials");
  });

  it("does not render an error notice when there is no error param", async () => {
    const page = await LoginPage({ searchParams: Promise.resolve({}) });

    expect(textOf(page)).not.toContain("invalid_credentials");
  });

  it("links to the sign-up page", async () => {
    const page = await LoginPage({ searchParams: Promise.resolve({}) });

    const signUpLink = findFirst(
      page,
      (el) => typeof el.props.href === "string" && el.props.href === "/sign-up"
    );
    expect(signUpLink).toBeDefined();
  });
});

// --- React tree inspection helpers (match the existing page.test.tsx style) ---

function findInputByName(
  node: ReactNode,
  name: string
): AnyElement | undefined {
  return findFirst(node, (el) => el.props.name === name && el.props.type !== undefined);
}

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
