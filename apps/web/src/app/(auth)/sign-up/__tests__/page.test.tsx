import type { ReactElement, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import SignUpPage from "../page";

type AnyProps = Record<string, unknown> & { children?: ReactNode };
type AnyElement = ReactElement<AnyProps>;

// SignUpPage is a server component (`getTranslations`) — see
// `server-translator.ts` for why this is mocked rather than run for real
// (the real next-intl/server RSC build isn't available under Vitest).
// `getTranslations` is a `vi.fn` (not a plain async arrow) so the ES-locale
// test below can override it for a single call via `mockResolvedValueOnce`.
// `getRequestConfig` is a pass-through stub — SignUpPage still imports
// `getFirstParam` from `@/i18n/request`, which calls `getRequestConfig` at
// module scope for the (unrelated) default export next.config.ts consumes.
vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => createServerTranslator()),
  getRequestConfig: (callback: (params: unknown) => unknown) => callback,
}));

vi.mock("../actions.js", () => ({
  signupAction: vi.fn(),
}));

import { getTranslations } from "next-intl/server";
import { createServerTranslator } from "@/test-utils/server-translator";

describe("SignUpPage", () => {
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

  it("renders English copy via getTranslations, no messages.* access", async () => {
    const page = await SignUpPage({ searchParams: Promise.resolve({}) });
    const text = textOf(page);

    expect(text).toContain("Sign up");
    expect(text).toContain("Email");
    expect(text).toContain("Password");
    expect(text).toContain("Already have an account?");
  });

  it("renders real Spanish copy from the ES catalog (not EN leakage)", async () => {
    vi.mocked(getTranslations).mockResolvedValueOnce(createServerTranslator("es"));
    const page = await SignUpPage({ searchParams: Promise.resolve({}) });
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
