// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AiConfigForm } from "../AiConfigForm.js";
import { MODEL_DEFAULTS } from "../ai-config-client.js";

// --- Module mocks ---

const updateAiConfig = vi.fn();

vi.mock("../ai-config-client.js", async () => {
  const actual = await vi.importActual<typeof import("../ai-config-client.js")>(
    "../ai-config-client.js"
  );
  return {
    ...actual,
    updateAiConfig: (...args: unknown[]) => updateAiConfig(...args),
  };
});

afterEach(() => {
  vi.clearAllMocks();
});

// --- Tests ---

describe("AiConfigForm", () => {
  // SC-14: shows current config
  it("renders with the initial provider selected (SC-14)", () => {
    render(
      <AiConfigForm
        token="tok-admin"
        initialProvider="anthropic"
        initialModel="claude-3-5-haiku-20241022"
      />
    );

    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.value).toBe("anthropic");
  });

  it("renders with the initial model value (SC-14)", () => {
    render(
      <AiConfigForm
        token="tok-admin"
        initialProvider="openai"
        initialModel="gpt-4o"
      />
    );

    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.value).toBe("gpt-4o");
  });

  it("updates model default when provider changes", () => {
    render(
      <AiConfigForm
        token="tok-admin"
        initialProvider="openrouter"
        initialModel="openai/gpt-4o-mini"
      />
    );

    const select = screen.getByRole("combobox") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "anthropic" } });

    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.value).toBe(MODEL_DEFAULTS.anthropic);
  });

  // SC-15: submit calls PUT and shows confirmation
  it("calls updateAiConfig on submit and shows success message (SC-15)", async () => {
    updateAiConfig.mockResolvedValue({
      kind: "ok",
      config: { provider: "openai", model: "gpt-4o", updatedAt: "2026-06-30T00:00:00Z" },
    });

    render(
      <AiConfigForm
        token="tok-admin"
        initialProvider="openai"
        initialModel="gpt-4o-mini"
      />
    );

    const input = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "gpt-4o" } });

    const button = screen.getByRole("button");
    fireEvent.click(button);

    await waitFor(() => {
      expect(updateAiConfig).toHaveBeenCalledWith("tok-admin", "openai", "gpt-4o");
    });

    await waitFor(() => {
      expect(screen.getByText(/saved/i)).toBeDefined();
    });
  });

  it("shows error message when update fails", async () => {
    updateAiConfig.mockResolvedValue({ kind: "error", message: "api_error_500" });

    render(
      <AiConfigForm
        token="tok-admin"
        initialProvider="openai"
        initialModel="gpt-4o-mini"
      />
    );

    const button = screen.getByRole("button");
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByText(/error/i)).toBeDefined();
    });
  });
});
