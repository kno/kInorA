import { describe, expect, it, vi } from "vitest";

const listUserMemories = vi.fn();
const cookies = vi.fn();
vi.mock("next-intl/server", () => ({
  getTranslations: async () => ((key: string) => ({
    "memory.title": "Your memory",
    "memory.description": "Review and control what kInorA remembers for you.",
  })[key] ?? key),
}));

vi.mock("next/headers", () => ({ cookies: (...args: unknown[]) => cookies(...args) }));

vi.mock("../memory-client", () => ({
  listUserMemories: (...args: unknown[]) => listUserMemories(...args),
}));

import MemoryPage from "../page";

describe("MemoryPage", () => {
  it("renders the page copy and passes fetched memory data to the client component", async () => {
    cookies.mockResolvedValue({ get: vi.fn(() => ({ value: "session-token" })) });
    listUserMemories.mockResolvedValue({ kind: "ok", data: { settings: { enabled: true }, memories: [] } });

    const page = await MemoryPage();
    const memoryClient = page.props.children[2];

    expect(page.props.className).toContain("kin-page");
    expect(memoryClient.props.initialError).toBeNull();
    expect(memoryClient.props.initialData).toEqual({ settings: { enabled: true }, memories: [] });
  });

  it("passes a safe initial error when the server load fails", async () => {
    cookies.mockResolvedValue({ get: vi.fn(() => ({ value: "session-token" })) });
    listUserMemories.mockResolvedValue({ kind: "error", message: "api_unreachable" });

    const page = await MemoryPage();
    const memoryClient = page.props.children[2];

    expect(memoryClient.props.initialData).toBeNull();
    expect(memoryClient.props.initialError).toBe("api_unreachable");
  });
});
