// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithIntl } from "@/test-utils/render-with-intl";
import type { WeightEntryDTO } from "@kinora/contracts";
import { WeightEntryForm } from "../WeightEntryForm.js";

// The form invokes the `createWeightEntryAction` server action (NOT the API
// directly). Mock the action; the real client is exercised in
// `weight-entry-client.test.ts`.

const createWeightEntryAction = vi.fn();

vi.mock("../weight-entry-actions.js", () => ({
  createWeightEntryAction: (...args: unknown[]) => createWeightEntryAction(...args),
}));

afterEach(() => {
  vi.clearAllMocks();
});

const ENTRIES: WeightEntryDTO[] = [
  { id: "e-2", weightKg: 78, recordedAt: "2026-08-01T00:00:00.000Z" },
  { id: "e-1", weightKg: 80, recordedAt: "2026-06-01T00:00:00.000Z" },
];

describe("WeightEntryForm", () => {
  it("submits weightKg and an optional date", async () => {
    createWeightEntryAction.mockResolvedValue({
      kind: "ok",
      entry: { id: "e-3", weightKg: 76, recordedAt: "2026-09-01T00:00:00.000Z" },
      wasFirstEntry: false,
    });

    renderWithIntl(<WeightEntryForm initialEntries={[]} />);

    const weightInput = screen.getByLabelText("Weight (kg)") as HTMLInputElement;
    fireEvent.change(weightInput, { target: { value: "76" } });

    const dateInput = screen.getByLabelText("Date") as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: "2026-09-01" } });

    const submitButton = screen.getByRole("button", { name: "Log weight" });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(createWeightEntryAction).toHaveBeenCalledWith(76, "2026-09-01");
    });
  });

  it("renders the list newest-first", () => {
    renderWithIntl(<WeightEntryForm initialEntries={ENTRIES} />);

    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain("78");
    expect(rows[1]!.textContent).toContain("80");
  });

  it("prepends a newly created entry to the list without a page reload", async () => {
    createWeightEntryAction.mockResolvedValue({
      kind: "ok",
      entry: { id: "e-3", weightKg: 76, recordedAt: "2026-10-01T00:00:00.000Z" },
      wasFirstEntry: false,
    });

    renderWithIntl(<WeightEntryForm initialEntries={ENTRIES} />);

    const weightInput = screen.getByLabelText("Weight (kg)") as HTMLInputElement;
    fireEvent.change(weightInput, { target: { value: "76" } });

    const submitButton = screen.getByRole("button", { name: "Log weight" });
    fireEvent.click(submitButton);

    await waitFor(() => {
      const rows = screen.getAllByRole("listitem");
      expect(rows).toHaveLength(3);
      expect(rows[0]!.textContent).toContain("76");
    });
  });

  it("surfaces a non-positive weight validation error inline, without a page reload", async () => {
    createWeightEntryAction.mockResolvedValue({
      kind: "validation_error",
      message: "invalid_weight_kg",
    });

    renderWithIntl(<WeightEntryForm initialEntries={[]} />);

    const weightInput = screen.getByLabelText("Weight (kg)") as HTMLInputElement;
    fireEvent.change(weightInput, { target: { value: "0" } });

    const submitButton = screen.getByRole("button", { name: "Log weight" });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeDefined();
    });
    // No entry appended — the invalid submission never mutated the list.
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  it("renders an empty-state message when there are no entries", () => {
    renderWithIntl(<WeightEntryForm initialEntries={[]} />);
    expect(screen.getByText("No weigh-ins recorded yet.")).toBeDefined();
  });
});
