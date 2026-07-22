// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import type { ReactElement, ReactNode } from "react";

type AnyProps = Record<string, unknown> & { children?: ReactNode };
type AnyElement = ReactElement<AnyProps>;

// --- Helpers ---

function findFirst(
  node: ReactNode,
  match: (el: AnyElement) => boolean,
): AnyElement | undefined {
  if (typeof node === "object" && node !== null && "props" in node) {
    const el = node as AnyElement;
    if (match(el)) return el;
    const found = findFirst(el.props.children, match);
    if (found) return found;
  }
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findFirst(child, match);
      if (found) return found;
    }
  }
  return undefined;
}

// --- Module mocks ---

const cookieGet = vi.fn();
const fetchUserProfile = vi.fn();

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: cookieGet })),
}));

// ProfilePage is a server component (`getTranslations`). The real
// next-intl/server RSC build isn't available under Vitest, so mock it with a
// catalog-backed translator. See `server-translator.ts` for the rationale.
vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => createServerTranslator()),
}));

import { getTranslations } from "next-intl/server";
import { createServerTranslator } from "@/test-utils/server-translator";

vi.mock("../profile-form-client.js", async () => {
  const actual = await vi.importActual<typeof import("../profile-form-client.js")>(
    "../profile-form-client.js",
  );
  return {
    ...actual,
    fetchUserProfile: (...args: unknown[]) => fetchUserProfile(...args),
  };
});

// Stub ProfileForm to a lightweight function component so the page test only
// asserts the page's wiring (fetch + props), not the form internals.
vi.mock("../ProfileForm.js", () => ({
  ProfileForm: (props: AnyProps) => null,
}));

import ProfilePage from "../page.js";
import { ProfileForm } from "../ProfileForm.js";

afterEach(() => {
  vi.clearAllMocks();
});

// --- Tests ---

describe("ProfilePage (server component)", () => {
  it("renders the profile heading via getTranslations", async () => {
    cookieGet.mockReturnValue({ value: "token-1" });
    fetchUserProfile.mockResolvedValue({
      kind: "ok",
      profile: { userId: "u", name: "Ada", goal: null, experienceLevel: null },
    });

    const page = (await ProfilePage()) as AnyElement;

    // English fallback catalog returns the literal "Profile".
    expect(findText(page)).toContain("Profile");
  });

  it("passes the fetched profile to ProfileForm on a successful load", async () => {
    cookieGet.mockReturnValue({ value: "token-1" });
    fetchUserProfile.mockResolvedValue({
      kind: "ok",
      profile: { userId: "u", name: "Ada Rivera", goal: "strength", experienceLevel: "intermediate" },
    });

    const page = (await ProfilePage()) as AnyElement;

    const form = findFirst(page, (el) => el.type === ProfileForm);
    expect(form).toBeDefined();
    const initialProfile = form?.props?.initialProfile as
      | { name?: string; goal?: string | null }
      | null
      | undefined;
    expect(initialProfile?.name).toBe("Ada Rivera");
    expect(initialProfile?.goal).toBe("strength");
    expect(form?.props?.initialError).toBeFalsy();
  });

  it("passes initialError to ProfileForm when the fetch fails", async () => {
    cookieGet.mockReturnValue({ value: "token-1" });
    fetchUserProfile.mockResolvedValue({ kind: "error", message: "api_unreachable" });

    const page = (await ProfilePage()) as AnyElement;

    const form = findFirst(page, (el) => el.type === ProfileForm);
    expect(form).toBeDefined();
    expect(form?.props?.initialProfile).toBeNull();
    expect(form?.props?.initialError).toBe("api_unreachable");
  });

  it("reads the session token from the kinora_session cookie", async () => {
    cookieGet.mockReturnValue({ value: "my-session-token" });
    fetchUserProfile.mockResolvedValue({ kind: "error", message: "no_session" });

    await ProfilePage();

    expect(fetchUserProfile).toHaveBeenCalledWith("my-session-token");
  });

  it("renders real Spanish copy from the ES catalog (no EN leakage)", async () => {
    vi.mocked(getTranslations).mockResolvedValueOnce(createServerTranslator("es"));
    cookieGet.mockReturnValue({ value: "token-1" });
    fetchUserProfile.mockResolvedValue({ kind: "ok", profile: { userId: "u", name: "Ada", goal: null, experienceLevel: null } });

    const page = (await ProfilePage()) as AnyElement;
    expect(findText(page)).toContain("Perfil");
    expect(findText(page)).toContain("Gestiona los ajustes y las preferencias de tu cuenta.");
  });
});

function findText(node: ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(findText).join("");
  if (typeof node === "object" && node !== null && "props" in node) {
    return findText((node as AnyElement).props.children);
  }
  return "";
}