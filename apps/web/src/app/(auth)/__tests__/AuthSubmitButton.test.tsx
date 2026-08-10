// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

/**
 * `useFormStatus` reads the status of the nearest enclosing `<form>` from
 * React's internal form context, which only exists once a Server Action
 * submission is actually in flight — Vitest cannot produce that. The hook is
 * therefore mocked, which is the whole point of the component: it is the only
 * thing `AuthSubmitButton` does with the client.
 *
 * kno/kInorA#445 — the Open Design screens draw an explicit submitting state
 * (`web-login.html:217`, `web-sign-up.html:240`): spinner, a "Comprobando…" /
 * "Creando cuenta…" label, and the rest of the form greyed out. The greying is
 * done in CSS off the `data-pending` attribute asserted here, so that this
 * component stays the only client boundary under `(auth)/`.
 */
const useFormStatus = vi.fn(() => ({ pending: false }));
vi.mock("react-dom", async () => {
  const actual = await vi.importActual<typeof import("react-dom")>("react-dom");
  return { ...actual, useFormStatus: () => useFormStatus() };
});

const { AuthSubmitButton } = await import("../AuthSubmitButton");

afterEach(() => {
  cleanup();
  useFormStatus.mockReturnValue({ pending: false });
});

describe("AuthSubmitButton", () => {
  it("renders the idle label as an enabled submit button", () => {
    render(
      <AuthSubmitButton
        pendingLabel="Checking…"
        className="submit"
        spinnerClassName="spinner"
      >
        Log in
      </AuthSubmitButton>
    );

    const button = screen.getByRole("button", { name: "Log in" });
    expect(button.getAttribute("type")).toBe("submit");
    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(button.getAttribute("aria-busy")).toBe("false");
    expect(button.hasAttribute("data-pending")).toBe(false);
  });

  it("swaps to the pending label, disables itself and publishes data-pending", () => {
    useFormStatus.mockReturnValue({ pending: true });

    render(
      <AuthSubmitButton
        pendingLabel="Checking…"
        className="submit"
        spinnerClassName="spinner"
      >
        Log in
      </AuthSubmitButton>
    );

    const button = screen.getByRole("button", { name: "Checking…" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
    // The `:has()` hook the stylesheet uses to grey the sibling inputs and the
    // Google button. An empty string is what React renders for `data-x=""`.
    expect(button.getAttribute("data-pending")).toBe("");
    expect(button.querySelector(".spinner")).not.toBeNull();
  });

  it("does not render the idle label while pending", () => {
    useFormStatus.mockReturnValue({ pending: true });

    render(
      <AuthSubmitButton
        pendingLabel="Creating account…"
        className="submit"
        spinnerClassName="spinner"
      >
        Sign up
      </AuthSubmitButton>
    );

    expect(screen.queryByText("Sign up")).toBeNull();
  });
});
