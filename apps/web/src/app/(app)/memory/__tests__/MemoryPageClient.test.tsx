// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import type { ListUserMemoriesResponse, CreateUserMemoryResponse } from "@kinora/contracts";
import { renderWithIntl } from "@/test-utils/render-with-intl";
import { MemoryPageClient } from "../MemoryPageClient.js";

const getUserMemoriesAction = vi.fn();
const createUserMemoryAction = vi.fn();
const deleteUserMemoryAction = vi.fn();
const updateMemorySettingsAction = vi.fn();

vi.mock("../actions.js", () => ({
  getUserMemoriesAction: (...args: unknown[]) => getUserMemoriesAction(...args),
  createUserMemoryAction: (...args: unknown[]) => createUserMemoryAction(...args),
  deleteUserMemoryAction: (...args: unknown[]) => deleteUserMemoryAction(...args),
  updateMemorySettingsAction: (...args: unknown[]) => updateMemorySettingsAction(...args),
}));

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

const LIST_RESPONSE: ListUserMemoriesResponse = {
  settings: {
    tenantId: "tenant-1" as never,
    userId: "user-1" as never,
    enabled: true,
    settingsVersion: 2,
    disabledAt: null,
    updatedAt: "2026-07-22T12:00:00.000Z",
  },
  memories: [
    {
      id: "memory-1",
      tenantId: "tenant-1" as never,
      userId: "user-1" as never,
      summary: "Prefers morning workouts",
      source: "user_confirmation",
      status: "active",
      eligibility: "eligible",
      consentStatus: "granted",
      consentedAt: "2026-07-22T12:00:00.000Z",
      revokedAt: null,
      disabledAt: null,
      deletedAt: null,
      idempotencyKey: "idem-1",
      fingerprint: "fp-1",
      schemaVersion: "10b-v1",
      embeddingProvider: "openai",
      embeddingModel: "text-embedding-3-small",
      embeddingVersion: "text-embedding-3-small",
      embeddingDimension: 1536,
      createdAt: "2026-07-22T12:00:00.000Z",
      updatedAt: "2026-07-22T12:00:00.000Z",
    },
  ],
};

function jsonResponse(overrides: Partial<ListUserMemoriesResponse> = {}): ListUserMemoriesResponse {
  return {
    settings: LIST_RESPONSE.settings,
    memories: LIST_RESPONSE.memories,
    ...overrides,
  };
}

describe("MemoryPageClient", () => {
  it("renders existing memories, metadata, and create controls", () => {
    renderWithIntl(<MemoryPageClient initialData={LIST_RESPONSE} />);

    expect(screen.getByRole("heading", { name: "Your memory" })).toBeDefined();
    expect(screen.getByText("Prefers morning workouts")).toBeDefined();
    expect(screen.getByRole("textbox", { name: "Fact to remember" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Save memory" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Disable memory" })).toBeDefined();
  });

  it("creates a confirmed memory and updates the list immediately on success", async () => {
    const baseMemory = LIST_RESPONSE.memories[0]!;
    const created: CreateUserMemoryResponse = {
      memory: {
        ...baseMemory,
        id: "memory-2",
        summary: "Avoid late-night caffeine",
        idempotencyKey: "idem-2",
        fingerprint: "fp-2",
      },
    };
    createUserMemoryAction.mockResolvedValue({ kind: "ok", data: created });

    renderWithIntl(<MemoryPageClient initialData={jsonResponse({ memories: [] })} />);

    fireEvent.change(screen.getByRole("textbox", { name: "Fact to remember" }), {
      target: { value: "Avoid late-night caffeine" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save memory" }));

    await waitFor(() => {
      expect(createUserMemoryAction).toHaveBeenCalledWith({
        factText: "Avoid late-night caffeine",
      });
    });
    await waitFor(() => {
      expect(screen.getByText("Avoid late-night caffeine")).toBeDefined();
      expect(screen.getByRole("status").textContent).toContain("Memory saved");
    });
  });

  it("shows a safe validation message when confirmed-memory creation is rejected", async () => {
    createUserMemoryAction.mockResolvedValue({
      kind: "validation_error",
      message: "memory_ineligible",
    });

    renderWithIntl(<MemoryPageClient initialData={LIST_RESPONSE} />);

    fireEvent.change(screen.getByRole("textbox", { name: "Fact to remember" }), {
      target: { value: "My raw transcript is secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save memory" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain(
        "Only durable, non-sensitive facts can be saved",
      );
    });
  });

  it("renders the empty state when no confirmed memories exist", () => {
    renderWithIntl(<MemoryPageClient initialData={jsonResponse({ memories: [] })} />);

    expect(screen.getByText("No saved memories yet.")).toBeDefined();
    expect(screen.getByText("Save a durable preference or context note to avoid repeating it.")).toBeDefined();
  });

  it("shows an accessible loading state while retrying a failed load", async () => {
    let resolve!: (value: unknown) => void;
    getUserMemoriesAction.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );

    renderWithIntl(<MemoryPageClient initialData={null} initialError="api_unreachable" />);

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(screen.getByRole("status").textContent).toContain("Loading your memory");
    resolve({ kind: "ok", data: LIST_RESPONSE });
    await waitFor(() => expect(screen.getByText("Prefers morning workouts")).toBeDefined());
  });

  it("renders the offline state when the API is unreachable and the browser is offline", () => {
    vi.stubGlobal("navigator", { onLine: false });

    renderWithIntl(<MemoryPageClient initialData={null} initialError="api_unreachable" />);

    expect(screen.getByText("You are offline")).toBeDefined();
    expect(screen.getByText("Reconnect to load or update your saved memories.")).toBeDefined();
    expect(screen.getByRole("button", { name: "Retry" })).toBeDefined();
  });

  it("renders the error state and focuses Retry for keyboard recovery", async () => {
    renderWithIntl(<MemoryPageClient initialData={null} initialError="api_error_500" />);

    const retryButton = await screen.findByRole("button", { name: "Retry" });
    expect(retryButton).toBe(document.activeElement);
    expect(screen.getByText("We could not load your memory.")).toBeDefined();
  });

  it("requires delete confirmation and removes the memory immediately after confirm", async () => {
    deleteUserMemoryAction.mockResolvedValue({ kind: "ok", data: { deleted: true } });

    renderWithIntl(<MemoryPageClient initialData={LIST_RESPONSE} />);

    fireEvent.click(screen.getByRole("button", { name: "Delete memory Prefers morning workouts" }));

    const dialog = screen.getByRole("alertdialog", { name: "Delete memory" });
    expect(dialog).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));

    await waitFor(() => {
      expect(deleteUserMemoryAction).toHaveBeenCalledWith("memory-1");
      expect(screen.queryByText("Prefers morning workouts")).toBeNull();
    });
  });

  it("requires disable confirmation and updates controls immediately after confirm", async () => {
    updateMemorySettingsAction.mockResolvedValue({
      kind: "ok",
      data: {
        ...LIST_RESPONSE.settings,
        enabled: false,
        settingsVersion: 3,
        disabledAt: "2026-07-22T12:30:00.000Z",
      },
    });

    renderWithIntl(<MemoryPageClient initialData={LIST_RESPONSE} />);

    fireEvent.click(screen.getByRole("button", { name: "Disable memory" }));
    expect(screen.getByRole("alertdialog", { name: "Disable memory" })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Confirm disable" }));

    await waitFor(() => {
      expect(updateMemorySettingsAction).toHaveBeenCalledWith(false);
      expect(screen.getByRole("button", { name: "Enable memory" })).toBeDefined();
      expect(screen.getByRole("textbox", { name: "Fact to remember" }).hasAttribute("disabled")).toBe(true);
    });
  });

  it("retries a failed load and replaces the error state with fresh data", async () => {
    getUserMemoriesAction.mockResolvedValue({ kind: "ok", data: LIST_RESPONSE });

    renderWithIntl(<MemoryPageClient initialData={null} initialError="api_error_500" />);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(getUserMemoriesAction).toHaveBeenCalledTimes(1);
      expect(screen.getByText("Prefers morning workouts")).toBeDefined();
    });
  });
});
