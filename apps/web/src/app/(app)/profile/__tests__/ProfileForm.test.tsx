// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithIntl } from "@/test-utils/render-with-intl";
import type { UserProfile } from "@kinora/contracts";
import { ProfileForm } from "../ProfileForm.js";

// The form invokes the `saveProfileAction` server action (NOT the API
// directly — the browser must never call the API). Mock the action; the
// real client is exercised in `profile-form-client.test.ts`.

const saveProfileAction = vi.fn();

vi.mock("../actions.js", () => ({
  saveProfileAction: (...args: unknown[]) => saveProfileAction(...args),
}));

afterEach(() => {
  vi.clearAllMocks();
});

const PROFILE_FULL: UserProfile = {
  userId: "user-1",
  name: "Ada Rivera",
  goal: "strength",
  experienceLevel: "intermediate",
};

const PROFILE_EMPTY_SELECTORS: UserProfile = {
  userId: "user-2",
  name: "New User",
  goal: null,
  experienceLevel: null,
};

describe("ProfileForm", () => {
  it("renders the editable fields with the initial profile values populated", () => {
    renderWithIntl(<ProfileForm initialProfile={PROFILE_FULL} />);

    const nameInput = screen.getByLabelText("Name") as HTMLInputElement;
    expect(nameInput.value).toBe("Ada Rivera");

    const goalSelect = screen.getByLabelText("Goal") as HTMLSelectElement;
    expect(goalSelect.value).toBe("strength");

    const expSelect = screen.getByLabelText("Experience level") as HTMLSelectElement;
    expect(expSelect.value).toBe("intermediate");
  });

  it("renders placeholder options when goal/experienceLevel are null", () => {
    renderWithIntl(<ProfileForm initialProfile={PROFILE_EMPTY_SELECTORS} />);

    const goalSelect = screen.getByLabelText("Goal") as HTMLSelectElement;
    expect(goalSelect.value).toBe("");

    const expSelect = screen.getByLabelText("Experience level") as HTMLSelectElement;
    expect(expSelect.value).toBe("");
  });

  it("disables the Save button while the name is blank and shows the required hint", () => {
    renderWithIntl(<ProfileForm initialProfile={PROFILE_FULL} />);

    const nameInput = screen.getByLabelText("Name") as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "   " } });

    const saveButton = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true);
    expect(screen.getByText("Name is required.")).toBeDefined();
  });

  it("calls saveProfileAction with the current values on submit and confirms (SC: save)", async () => {
    saveProfileAction.mockResolvedValue({
      kind: "ok",
      profile: { ...PROFILE_FULL, name: "Ada R.", goal: "hypertrophy", experienceLevel: "advanced" },
    });

    renderWithIntl(<ProfileForm initialProfile={PROFILE_FULL} />);

    const goalSelect = screen.getByLabelText("Goal") as HTMLSelectElement;
    fireEvent.change(goalSelect, { target: { value: "hypertrophy" } });

    const saveButton = screen.getByRole("button", { name: "Save" });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(saveProfileAction).toHaveBeenCalledWith(
        "Ada Rivera",
        "hypertrophy",
        "intermediate",
      );
    });

    await waitFor(() => {
      expect(screen.getByText("Profile saved.")).toBeDefined();
    });

    // The reflected (server-normalized) values reset into the form.
    const nameInput = screen.getByLabelText("Name") as HTMLInputElement;
    expect(nameInput.value).toBe("Ada R.");
    const expSelect = screen.getByLabelText("Experience level") as HTMLSelectElement;
    expect(expSelect.value).toBe("advanced");
  });

  it("omits null selectors from the save action call (preserve stored)", async () => {
    saveProfileAction.mockResolvedValue({ kind: "ok", profile: PROFILE_EMPTY_SELECTORS });

    renderWithIntl(<ProfileForm initialProfile={PROFILE_EMPTY_SELECTORS} />);

    const saveButton = screen.getByRole("button", { name: "Save" });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(saveProfileAction).toHaveBeenCalledWith("New User", null, null);
    });
  });

  it("shows an error message when the save action returns an error", async () => {
    saveProfileAction.mockResolvedValue({ kind: "error", message: "api_error_500" });

    renderWithIntl(<ProfileForm initialProfile={PROFILE_FULL} />);

    const saveButton = screen.getByRole("button", { name: "Save" });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(screen.getByText(/Could not save your profile/i)).toBeDefined();
    });
  });

  it("shows a load-error alert when initialError is supplied", () => {
    renderWithIntl(
      // A real identity so the name field is non-blank and the only
      // role="alert" rendered is the load-error one.
      <ProfileForm
        initialProfile={{ userId: "u", name: "Ada", goal: null, experienceLevel: null }}
        initialError="api_unreachable"
      />,
    );

    expect(screen.getByRole("alert")).toBeDefined();
    expect(screen.getByText(/Could not load your profile/i)).toBeDefined();
  });

  it("renders a save button labelled with the catalog action label", () => {
    renderWithIntl(<ProfileForm initialProfile={PROFILE_FULL} />);
    expect(screen.getByRole("button", { name: "Save" })).toBeDefined();
  });
});