// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithIntl } from "@/test-utils/render-with-intl";
import type { PlanSummaryItem } from "../PlanSelector";

// --- Module mocks ---

const routerPush = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
}));

import { PlanSelector } from "../PlanSelector";

afterEach(() => {
  vi.clearAllMocks();
});

// --- Test fixtures ---

const summaries: PlanSummaryItem[] = [
  { id: "plan-newer", status: "ready", createdAt: "2026-06-29T10:00:00.000Z" },
  { id: "plan-older", status: "generating", createdAt: "2026-06-28T09:00:00.000Z" },
];

// --- Tests ---

describe("PlanSelector", () => {
  it("renders a <select> element", () => {
    renderWithIntl(<PlanSelector summaries={summaries} selectedId="plan-newer" />);
    expect(screen.getByRole("combobox")).toBeDefined();
  });

  it("renders the 'ready' ICU select branch for a ready plan (Gap 1)", () => {
    renderWithIntl(<PlanSelector summaries={summaries} selectedId="plan-newer" />);
    expect(screen.getByText(/Ready/)).toBeDefined();
  });

  it("renders the 'generating' ICU select branch for a generating plan (Gap 1)", () => {
    renderWithIntl(<PlanSelector summaries={summaries} selectedId="plan-newer" />);
    expect(screen.getByText(/Generating/)).toBeDefined();
  });

  it("renders the 'failed' ICU select branch for a failed plan (Gap 1)", () => {
    const failedSummaries: PlanSummaryItem[] = [
      { id: "plan-f", status: "failed", createdAt: "2026-06-29T10:00:00.000Z" },
    ];
    renderWithIntl(<PlanSelector summaries={failedSummaries} selectedId="plan-f" />);
    expect(screen.getByText(/Failed/)).toBeDefined();
  });

  it("renders the 'other' ICU select branch for an unrecognized status (Gap 1)", () => {
    const unknownSummaries: PlanSummaryItem[] = [
      { id: "plan-u", status: "archived", createdAt: "2026-06-29T10:00:00.000Z" },
    ];
    renderWithIntl(<PlanSelector summaries={unknownSummaries} selectedId="plan-u" />);
    expect(screen.getByText(/Unknown/)).toBeDefined();
  });

  it("marks the selectedId option as selected via value prop on <select>", () => {
    renderWithIntl(<PlanSelector summaries={summaries} selectedId="plan-older" />);
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("plan-older");
  });

  it("marks the first plan as selected when selectedId matches first entry", () => {
    renderWithIntl(<PlanSelector summaries={summaries} selectedId="plan-newer" />);
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("plan-newer");
  });

  it("onChange pushes /plan?planId=<encoded-id> via router.push (Fix 5 — encodeURIComponent)", () => {
    renderWithIntl(<PlanSelector summaries={summaries} selectedId="plan-newer" />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "plan-older" } });
    // "plan-older" has no special chars so encodeURIComponent keeps it the same
    expect(routerPush).toHaveBeenCalledWith("/plan?planId=plan-older");
  });

  it("encodeURIComponent encodes special characters in planId (Fix 5 — URL safety)", () => {
    // Verify encodeURIComponent is applied — IDs with special chars must be encoded
    const planWithSpecialId: PlanSummaryItem[] = [
      { id: "plan/with+special=chars&more", status: "ready", createdAt: "2026-06-29T10:00:00.000Z" },
    ];
    renderWithIntl(
      <PlanSelector
        summaries={planWithSpecialId}
        selectedId="plan/with+special=chars&more"
      />,
    );
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "plan/with+special=chars&more" },
    });
    // The raw id has special chars — encodeURIComponent must encode them
    expect(routerPush).toHaveBeenCalledWith(
      "/plan?planId=plan%2Fwith%2Bspecial%3Dchars%26more"
    );
  });

  it("onChange pushes the correct URL for a different selected plan", () => {
    renderWithIntl(<PlanSelector summaries={summaries} selectedId="plan-older" />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "plan-newer" } });
    expect(routerPush).toHaveBeenCalledWith("/plan?planId=plan-newer");
  });

  it("renders the resolved plan name as the option label (#93)", () => {
    const named: PlanSummaryItem[] = [
      { id: "p1", status: "ready", createdAt: "2026-06-29T10:00:00.000Z", name: "Summer Cut" },
      { id: "p2", status: "ready", createdAt: "2026-06-28T09:00:00.000Z", name: "Winter Bulk" },
    ];
    renderWithIntl(<PlanSelector summaries={named} selectedId="p1" />);
    expect(screen.getByText("Summer Cut")).toBeDefined();
    expect(screen.getByText("Winter Bulk")).toBeDefined();
  });

  it("two plans with distinct names render distinct labels (#93)", () => {
    const named: PlanSummaryItem[] = [
      { id: "p1", status: "ready", createdAt: "2026-06-29T10:00:00.000Z", name: "Alpha" },
      { id: "p2", status: "ready", createdAt: "2026-06-28T09:00:00.000Z", name: "Beta" },
    ];
    renderWithIntl(<PlanSelector summaries={named} selectedId="p1" />);
    const options = screen.getAllByRole("option") as HTMLOptionElement[];
    const labels = options.map((o) => o.textContent);
    expect(labels).toContain("Alpha");
    expect(labels).toContain("Beta");
  });

  it("renders the server-resolved default label when name is a resolved fallback (#93)", () => {
    // The server always resolves name via defaultPlanName, so the client renders
    // it verbatim with NO client-side fallback branching.
    const resolved: PlanSummaryItem[] = [
      { id: "p1", status: "ready", createdAt: "2026-06-29T10:00:00.000Z", name: "Plan 2026-06-29" },
    ];
    renderWithIntl(<PlanSelector summaries={resolved} selectedId="p1" />);
    expect(screen.getByText("Plan 2026-06-29")).toBeDefined();
  });

  it("renders the date + ICU-select fallback label when a summary has no name (#93 legacy safety)", () => {
    // The name field is optional; a legacy/undefined summary must NOT crash and
    // must fall back to the "{date} ({select-branch})" template.
    const noName: PlanSummaryItem[] = [
      { id: "p1", status: "ready", createdAt: "2026-06-29T10:00:00.000Z" },
    ];
    expect(() => {
      renderWithIntl(<PlanSelector summaries={noName} selectedId="p1" />);
    }).not.toThrow();
    // Status appears via the ICU select branch; the option is not blank.
    expect(screen.getByText(/Ready/)).toBeDefined();
  });

  it("formats the date via useFormatter().dateTime, not Date#toLocaleDateString (Gap 1)", () => {
    // A raw `.toLocaleDateString()` call would produce a different shape than
    // next-intl's `dateTime` formatter for the same Date under the "en" locale
    // used by renderWithIntl — assert the ACTUAL formatter output is present,
    // not a manually-reconstructed string.
    const noName: PlanSummaryItem[] = [
      { id: "p1", status: "ready", createdAt: "2026-06-29T10:00:00.000Z" },
    ];
    renderWithIntl(<PlanSelector summaries={noName} selectedId="p1" />);
    const option = screen.getByRole("option") as HTMLOptionElement;
    // next-intl's default `dateTime()` (no format name/options) renders
    // Intl.DateTimeFormat("en").format(date) — for 2026-06-29 that's "6/29/2026".
    expect(option.textContent).toContain("6/29/2026");
    expect(option.textContent).toContain("Ready");
  });

  it("renders option values matching plan ids", () => {
    renderWithIntl(<PlanSelector summaries={summaries} selectedId="plan-newer" />);
    const options = screen.getAllByRole("option") as HTMLOptionElement[];
    expect(options.length).toBeGreaterThanOrEqual(2);
    const optionValues = options.map((o) => o.value);
    expect(optionValues).toContain("plan-newer");
    expect(optionValues).toContain("plan-older");
  });
});
