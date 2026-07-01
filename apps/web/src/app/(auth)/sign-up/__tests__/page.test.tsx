import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { headers } from "next/headers";
import SignUpPage from "../page";

type AnyProps = Record<string, unknown> & { children?: ReactNode };
type AnyElement = ReactElement<AnyProps>;

vi.mock("next/headers", () => ({
  headers: vi.fn(),
}));

const mockedHeaders = vi.mocked(headers);

describe("SignUpPage", () => {
  beforeEach(() => {
    mockedHeaders.mockResolvedValue(new Headers({ "accept-language": "en-US,en;q=0.9" }));
  });

  it("renders an email/password form and a Google sign-up link", async () => {
    const page = await SignUpPage({ searchParams: Promise.resolve({}) });

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
    const page = await SignUpPage({
      searchParams: Promise.resolve({ error: "email_already_exists" }),
    });

    expect(textOf(page)).toContain("email_already_exists");
  });

  it("does not render an error notice when there is no error param", async () => {
    const page = await SignUpPage({ searchParams: Promise.resolve({}) });

    expect(textOf(page)).not.toContain("email_already_exists");
  });

  it("links to the login page", async () => {
    const page = await SignUpPage({ searchParams: Promise.resolve({}) });

    const loginLink = findFirst(
      page,
      (el) => typeof el.props.href === "string" && el.props.href === "/login"
    );
    expect(loginLink).toBeDefined();
  });

  it("renders English copy from the i18n catalog when lang=en", async () => {
    const page = await SignUpPage({ searchParams: Promise.resolve({ lang: "en" }) });
    const text = textOf(page);

    expect(text).toContain("Sign up");
    expect(text).toContain("Email");
    expect(text).toContain("Password");
    expect(text).toContain("Already have an account?");
  });

  it("renders Spanish copy from the i18n catalog when lang=es", async () => {
    const page = await SignUpPage({ searchParams: Promise.resolve({ lang: "es" }) });
    const text = textOf(page);

    expect(text).toContain("Crear cuenta");
    expect(text).toContain("Correo electrónico");
    expect(text).toContain("Contraseña");
    expect(text).toContain("¿Ya tienes una cuenta?");
  });
});

// --- React tree inspection helpers ---

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
