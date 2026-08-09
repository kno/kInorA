// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, cleanup } from "@testing-library/react";
import { renderWithIntl } from "@/test-utils/render-with-intl";
import { EMPTY_PALETTE, DEFAULT_PALETTE_HEX, BRANDING_PRESETS } from "../branding-constants";

const saveBrandingAction = vi.fn();
const uploadLogoAction = vi.fn();
vi.mock("../actions", () => ({
  saveBrandingAction: (...args: unknown[]) => saveBrandingAction(...args),
  uploadLogoAction: (...args: unknown[]) => uploadLogoAction(...args),
}));

import { BrandingStudio } from "../BrandingStudio";

const INITIAL = {
  subdomainSlug: "acme-gym",
  logoUrl: null as string | null,
  palette: { ...EMPTY_PALETTE },
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("BrandingStudio — live preview", () => {
  it("re-themes the preview in real time when a palette token is edited", () => {
    renderWithIntl(<BrandingStudio initial={INITIAL} />);

    const style = screen.getByTestId("branding-preview-style");
    expect(style.textContent).not.toContain("--gym-accent");

    fireEvent.change(screen.getByTestId("hex-accent"), { target: { value: "#ff0000" } });

    expect(screen.getByTestId("branding-preview-style").textContent).toContain("--gym-accent:#ff0000;");
  });

  it("reset restores defaults — clears every override so the preview falls back to kInorA", () => {
    renderWithIntl(
      <BrandingStudio
        initial={{ ...INITIAL, palette: { ...EMPTY_PALETTE, accent: "#123456", fg: "#eeeeee" } }}
      />,
    );

    // Pre-condition: the seeded overrides are themed.
    expect(screen.getByTestId("branding-preview-style").textContent).toContain("--gym-accent:#123456;");

    fireEvent.click(screen.getByTestId("reset-palette"));

    const style = screen.getByTestId("branding-preview-style");
    expect(style.textContent).not.toContain("--gym-");
    // The swatch hex input now shows the default kInorA accent.
    expect((screen.getByTestId("hex-accent") as HTMLInputElement).value.toLowerCase()).toBe(
      DEFAULT_PALETTE_HEX.accent.toLowerCase(),
    );
  });

  it("applies a curated preset, themeing every token from the chip in one click", () => {
    renderWithIntl(<BrandingStudio initial={INITIAL} />);

    const preset = BRANDING_PRESETS[0]!;
    fireEvent.click(screen.getByText(new RegExp(preset.id, "i")));

    expect((screen.getByTestId("hex-accent") as HTMLInputElement).value.toLowerCase()).toBe(
      preset.palette.accent.toLowerCase(),
    );
    expect(screen.getByTestId("branding-preview-style").textContent).toContain(
      `--gym-accent:${preset.palette.accent};`,
    );
  });

  it("edits a swatch color-picker input and reflects it in the hex field + preview", () => {
    renderWithIntl(<BrandingStudio initial={INITIAL} />);

    fireEvent.change(screen.getByTestId("swatch-accent"), { target: { value: "#00ff00" } });

    expect((screen.getByTestId("hex-accent") as HTMLInputElement).value.toLowerCase()).toBe(
      "#00ff00",
    );
  });
});

describe("BrandingStudio — subdomain slug", () => {
  it("lowercases + trims the slug on change and flags an invalid value", () => {
    renderWithIntl(<BrandingStudio initial={INITIAL} />);

    const input = screen.getByTestId("slug-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "  ACME Gym!! " } });

    expect(input.value).toBe("acme gym!!");
    expect(input.getAttribute("aria-invalid")).toBe("true");
  });
});

describe("BrandingStudio — logo dropzone", () => {
  it("opens the file picker on click and on Enter/Space, and toggles the dragging state", () => {
    renderWithIntl(<BrandingStudio initial={INITIAL} />);

    const dropzone = document.querySelector(".branding-dropzone") as HTMLElement;
    const fileInput = screen.getByTestId("logo-file-input") as HTMLInputElement;
    const clickSpy = vi.spyOn(fileInput, "click");

    fireEvent.click(dropzone);
    expect(clickSpy).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(dropzone, { key: "Enter" });
    expect(clickSpy).toHaveBeenCalledTimes(2);

    fireEvent.keyDown(dropzone, { key: " " });
    expect(clickSpy).toHaveBeenCalledTimes(3);

    // A key other than Enter/Space must NOT trigger the file picker.
    fireEvent.keyDown(dropzone, { key: "Tab" });
    expect(clickSpy).toHaveBeenCalledTimes(3);

    fireEvent.dragOver(dropzone);
    expect(dropzone.className).toContain("is-dragging");

    fireEvent.dragLeave(dropzone);
    expect(dropzone.className).not.toContain("is-dragging");
  });

  it("uploads the dropped file on drop and clears the dragging state", async () => {
    uploadLogoAction.mockResolvedValue({ kind: "ok", logoUrl: "/media/branding/dropped" });
    renderWithIntl(<BrandingStudio initial={INITIAL} />);

    const dropzone = document.querySelector(".branding-dropzone") as HTMLElement;
    fireEvent.dragOver(dropzone);
    expect(dropzone.className).toContain("is-dragging");

    const file = new File([new Uint8Array([1, 2, 3])], "logo.png", { type: "image/png" });
    fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });

    expect(dropzone.className).not.toContain("is-dragging");
    await waitFor(() => expect(uploadLogoAction).toHaveBeenCalledTimes(1));
  });
});

describe("BrandingStudio — save", () => {
  it("calls saveBrandingAction with the slug + edited palette", async () => {
    saveBrandingAction.mockResolvedValue({ kind: "ok", branding: { ...INITIAL, palette: EMPTY_PALETTE } });
    renderWithIntl(<BrandingStudio initial={INITIAL} />);

    fireEvent.change(screen.getByTestId("hex-accent"), { target: { value: "#ff0000" } });
    fireEvent.click(screen.getByTestId("save-branding"));

    await waitFor(() => expect(saveBrandingAction).toHaveBeenCalledTimes(1));
    const [payload] = saveBrandingAction.mock.calls[0] as [{ subdomainSlug: string; palette: { accent: string | null } }];
    expect(payload.subdomainSlug).toBe("acme-gym");
    expect(payload.palette.accent).toBe("#ff0000");
  });

  it("surfaces the slug-taken message on a 409 conflict", async () => {
    saveBrandingAction.mockResolvedValue({ kind: "conflict" });
    renderWithIntl(<BrandingStudio initial={INITIAL} />);

    fireEvent.click(screen.getByTestId("save-branding"));

    const error = await screen.findByTestId("branding-error");
    expect(error.textContent).toMatch(/already taken/i);
  });

  // kno/kInorA#378: a failed initial read must never let an owner overwrite
  // real branding with the studio's blank defaults.
  it("disables the Save button when loadFailed is true", () => {
    renderWithIntl(<BrandingStudio initial={INITIAL} loadFailed />);

    const button = screen.getByTestId("save-branding") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("does not call saveBrandingAction when Save is clicked while loadFailed is true (defense-in-depth)", () => {
    renderWithIntl(<BrandingStudio initial={INITIAL} loadFailed />);

    fireEvent.click(screen.getByTestId("save-branding"));

    expect(saveBrandingAction).not.toHaveBeenCalled();
  });

  it("re-enables Save and allows submission when loadFailed is false (default)", async () => {
    saveBrandingAction.mockResolvedValue({ kind: "ok", branding: { ...INITIAL, palette: EMPTY_PALETTE } });
    renderWithIntl(<BrandingStudio initial={INITIAL} />);

    const button = screen.getByTestId("save-branding") as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.click(button);

    await waitFor(() => expect(saveBrandingAction).toHaveBeenCalledTimes(1));
  });
});

describe("BrandingStudio — logo", () => {
  it("shows the initial logo in the preview", () => {
    renderWithIntl(<BrandingStudio initial={{ ...INITIAL, logoUrl: "/media/branding/existing" }} />);
    const img = screen.getByTestId("logo-preview-img") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("/media/branding/existing");
  });

  it("uploads a selected file and shows the returned logo in the preview", async () => {
    uploadLogoAction.mockResolvedValue({ kind: "ok", logoUrl: "/media/branding/uploaded" });
    renderWithIntl(<BrandingStudio initial={INITIAL} />);

    const file = new File([new Uint8Array([1, 2, 3])], "logo.png", { type: "image/png" });
    fireEvent.change(screen.getByTestId("logo-file-input"), { target: { files: [file] } });

    await waitFor(() => expect(uploadLogoAction).toHaveBeenCalledTimes(1));
    const [formData] = uploadLogoAction.mock.calls[0] as [FormData];
    expect(formData).toBeInstanceOf(FormData);

    await waitFor(() => {
      const img = screen.getByTestId("logo-preview-img") as HTMLImageElement;
      expect(img.getAttribute("src")).toBe("/media/branding/uploaded");
    });
  });
});
