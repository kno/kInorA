// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import type { ReactElement, ReactNode } from "react";

type AnyProps = Record<string, unknown> & { children?: ReactNode };
type AnyElement = ReactElement<AnyProps>;

// --- Helpers ---

function findFirst(
  node: ReactNode,
  match: (el: AnyElement) => boolean
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
const redirect = vi.fn();
const fetchAiConfig = vi.fn();

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: cookieGet })),
}));

vi.mock("next/navigation", () => ({
  redirect: (...args: unknown[]) => redirect(...args),
}));

vi.mock("../ai-config-client.js", async () => {
  const actual = await vi.importActual<typeof import("../ai-config-client.js")>(
    "../ai-config-client.js"
  );
  return {
    ...actual,
    fetchAiConfig: (...args: unknown[]) => fetchAiConfig(...args),
  };
});

// Stub AiConfigForm to a simple function component (no top-level vars in factory)
vi.mock("../AiConfigForm.js", () => ({
  AiConfigForm: (props: AnyProps) => null,
}));

import AiConfigPage from "../page.js";
import { AiConfigForm } from "../AiConfigForm.js";

afterEach(() => {
  vi.clearAllMocks();
});

// --- Tests ---

describe("AiConfigPage (server component)", () => {
  // SC-13: non-admin redirect
  it("redirects to / when the API returns 403 (SC-13)", async () => {
    cookieGet.mockReturnValue({ value: "session-token" });
    fetchAiConfig.mockResolvedValue({ kind: "forbidden" });

    await AiConfigPage();

    expect(redirect).toHaveBeenCalledWith("/");
  });

  // SC-14: admin sees current config
  it("renders AiConfigForm with current config for admin users (SC-14)", async () => {
    cookieGet.mockReturnValue({ value: "admin-token" });
    fetchAiConfig.mockResolvedValue({
      kind: "ok",
      config: { provider: "openrouter", model: "openai/gpt-4o-mini", updatedAt: "2026-06-30T00:00:00Z" },
    });

    const page = (await AiConfigPage()) as AnyElement;

    // Find by component reference (AiConfigForm is the mock function)
    const form = findFirst(page, (el) => el.type === AiConfigForm);
    expect(form).toBeDefined();
    expect(form?.props?.initialProvider).toBe("openrouter");
    expect(form?.props?.initialModel).toBe("openai/gpt-4o-mini");
  });

  it("renders AiConfigForm with no initialProvider when no DB config exists", async () => {
    cookieGet.mockReturnValue({ value: "admin-token" });
    fetchAiConfig.mockResolvedValue({ kind: "ok", config: null });

    const page = (await AiConfigPage()) as AnyElement;

    const form = findFirst(page, (el) => el.type === AiConfigForm);
    expect(form).toBeDefined();
    // No DB config → initialProvider prop should be undefined
    expect(form?.props?.initialProvider).toBeUndefined();
  });

  it("passes the session token to fetchAiConfig", async () => {
    cookieGet.mockReturnValue({ value: "my-session-token" });
    fetchAiConfig.mockResolvedValue({ kind: "ok", config: null });

    await AiConfigPage();

    expect(fetchAiConfig).toHaveBeenCalledWith("my-session-token");
  });
});
