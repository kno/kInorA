import type { ReactElement, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import LoginPage from "../page";

type AnyProps = Record<string, unknown> & { children?: ReactNode };
type AnyElement = ReactElement<AnyProps>;

// LoginPage is a server component (`getTranslations`) — see
// `server-translator.ts` for why this is mocked rather than run for real
// (the real next-intl/server RSC build isn't available under Vitest).
// `getTranslations` is a `vi.fn` (not a plain async arrow) so the ES-locale
// test below can override it for a single call via `mockResolvedValueOnce`.
// `getRequestConfig` is a pass-through stub — LoginPage still imports
// `getFirstParam` from `@/i18n/request`, which calls `getRequestConfig` at
// module scope for the (unrelated) default export next.config.ts consumes.
vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => createServerTranslator()),
  getRequestConfig: (callback: (params: unknown) => unknown) => callback,
}));

vi.mock("../actions.js", () => ({
  loginAction: vi.fn(),
}));

import { getTranslations } from "next-intl/server";
import { createServerTranslator } from "@/test-utils/server-translator";

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

  it("renders English copy via getTranslations, no messages.* access", async () => {
    const page = await LoginPage({ searchParams: Promise.resolve({}) });
    const text = textOf(page);

    expect(text).toContain("Log in");
    expect(text).toContain("Email");
    expect(text).toContain("Password");
    expect(text).toContain("Don't have an account?");
  });

  it("renders real Spanish copy from the ES catalog (not EN leakage)", async () => {
    vi.mocked(getTranslations).mockResolvedValueOnce(createServerTranslator("es"));
    const page = await LoginPage({ searchParams: Promise.resolve({}) });
    const text = textOf(page);

    expect(text).toContain("Iniciar sesión");
    expect(text).toContain("Correo electrónico");
    expect(text).toContain("Contraseña");
    expect(text).toContain("¿No tienes una cuenta?");
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
