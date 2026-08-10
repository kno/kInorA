import type { ReactElement, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
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

// 16a-v3-gym-white-label, Slice 4 — the login page is a Node-runtime Server
// Component that reads `headers().get("host")`. `next/headers` is mocked the
// same way the other server-component page tests mock it (see
// `(app)/clients/__tests__/page.test.tsx`).
const headersGet = vi.fn((_name: string) => null as string | null);
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => ({ get: headersGet })),
}));

const fetchPublicBranding = vi.fn(async (_slug: string) => null as unknown);
vi.mock("@/lib/gym-branding-client", () => ({
  fetchPublicBranding: (...args: [string]) => fetchPublicBranding(...args),
}));

import { getTranslations } from "next-intl/server";
import { createServerTranslator } from "@/test-utils/server-translator";

const GYM_PALETTE = {
  accent: "#112233",
  accentFg: "#ffffff",
  surface: "#000000",
  surface2: "#111111",
  fg: "#eeeeee",
  muted: "#999999",
};

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

    // kno/kInorA#445 — the submit control is now `AuthSubmitButton`, the one
    // client component on this page (it needs `useFormStatus` to render the
    // screen's submitting state). It renders `<button type="submit">`, but
    // this suite inspects the element tree WITHOUT rendering, so the marker
    // is the component's own `pendingLabel` prop rather than `type`.
    const submit = findFirst(page, (el) => typeof el.props.pendingLabel === "string");
    expect(submit).toBeDefined();
    expect(textOf(submit)).toContain("Log in");

    const google = findFirst(page, (el) => typeof el.props.href === "string");
    expect(google?.props.href).toBe("/auth/social/login?provider=google");
    expect(textOf(google)).toMatch(/google/i);
  });

  // kno/kInorA#445 — the screen's `Estados` sections. There is no new state:
  // both are the existing `?error=` query parameter, rendered the way
  // `web-login.html` draws it.
  it("marks both credential fields invalid when the submission was rejected", async () => {
    const page = await LoginPage({
      searchParams: Promise.resolve({ error: "invalid_credentials" }),
    });

    const marked = findAll(page, (el) => el.props["data-invalid"] === "");
    expect(marked).toHaveLength(2);
  });

  it("leaves the fields unmarked when there is no error", async () => {
    const page = await LoginPage({ searchParams: Promise.resolve({}) });

    expect(findAll(page, (el) => el.props["data-invalid"] === "")).toEqual([]);
  });

  it("renders the supporting poster copy beside the form", async () => {
    const page = await LoginPage({ searchParams: Promise.resolve({}) });

    expect(textOf(page)).toContain("The plan adapts. You just train.");
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

// 16a-v3-gym-white-label, Slice 4 — host-resolved gym branding (tasks 4.1-4.3).
describe("LoginPage — gym branding", () => {
  afterEach(() => {
    headersGet.mockReset().mockReturnValue(null);
    fetchPublicBranding.mockReset().mockResolvedValue(null);
  });

  it("renders a gym's inline <style> palette + logo when the host resolves to a known slug", async () => {
    headersGet.mockReturnValue("gymname.kinora.aitsai.com");
    fetchPublicBranding.mockResolvedValue({
      logoUrl: "/media/branding/abc",
      palette: GYM_PALETTE,
    });

    const page = await LoginPage({ searchParams: Promise.resolve({}) });

    expect(fetchPublicBranding).toHaveBeenCalledWith("gymname");

    const style = findByType(page, "style");
    expect(style).toBeDefined();
    const css = textOf(style);
    expect(css).toContain("--gym-accent:#112233");
    expect(css).toContain("--gym-surface:#000000");

    const logo = findByType(page, "img");
    expect(logo).toBeDefined();
    expect(logo?.props.src).toBe("/media/branding/abc");
  });

  it("renders default tokens with no gym <style>/logo when the host resolves to no known slug", async () => {
    headersGet.mockReturnValue("kinora.aitsai.com");
    fetchPublicBranding.mockResolvedValue(null);

    const page = await LoginPage({ searchParams: Promise.resolve({}) });

    expect(fetchPublicBranding).not.toHaveBeenCalled();
    expect(findByType(page, "style")).toBeUndefined();
    expect(findByType(page, "img")).toBeUndefined();
  });

  it("fails safe to default tokens when the public branding fetch errors", async () => {
    headersGet.mockReturnValue("gymname.kinora.aitsai.com");
    fetchPublicBranding.mockResolvedValue(null);

    const page = await LoginPage({ searchParams: Promise.resolve({}) });

    expect(fetchPublicBranding).toHaveBeenCalledWith("gymname");
    expect(findByType(page, "style")).toBeUndefined();
    expect(findByType(page, "img")).toBeUndefined();
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

function findAll(
  node: ReactNode,
  match: (el: AnyElement) => boolean,
  out: AnyElement[] = []
): AnyElement[] {
  if (isReactElement(node)) {
    if (match(node)) out.push(node);
    findAll(node.props.children, match, out);
  }
  if (Array.isArray(node)) for (const child of node) findAll(child, match, out);
  return out;
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

function findByType(node: ReactNode, type: string): AnyElement | undefined {
  return findFirst(node, (el) => el.type === type);
}
