// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithIntl } from "@/test-utils/render-with-intl";
import { LogsView } from "../LogsView";
import type { LogEvent } from "../logs-constants";

// The view invokes the `fetchLogsAction` server action (NOT the server-only
// client fn — the browser must never call the API directly). Mock the action.
const fetchLogsAction = vi.fn();

vi.mock("../actions", () => ({
  fetchLogsAction: (...args: unknown[]) => fetchLogsAction(...args),
}));

afterEach(() => {
  vi.clearAllMocks();
});

function makeEvent(overrides: Partial<LogEvent> = {}): LogEvent {
  return {
    id: "e1",
    tenantId: "bbbbbbbb-0000-0000-0000-000000000001",
    actorUserId: "aaaaaaaa-0000-0000-0000-000000000009",
    level: "info",
    event: "plan.generated",
    outcome: "success",
    metadata: { planId: "p1" },
    createdAt: "2026-07-30T10:00:00.000Z",
    ...overrides,
  };
}

describe("LogsView", () => {
  it("renders the empty state before any query is applied", () => {
    renderWithIntl(<LogsView />);
    expect(screen.getByTestId("logs-empty")).toBeDefined();
    expect(screen.queryByTestId("log-row")).toBeNull();
  });

  it("applies the filters and renders result rows with the metadata JSON", async () => {
    fetchLogsAction.mockResolvedValue({
      kind: "ok",
      events: [makeEvent()],
      nextCursor: undefined,
    });

    renderWithIntl(<LogsView />);

    fireEvent.change(screen.getByTestId("logs-filter-level"), {
      target: { value: "error" },
    });
    fireEvent.change(screen.getByTestId("logs-filter-event"), {
      target: { value: "plan" },
    });
    fireEvent.click(screen.getByTestId("logs-apply"));

    await waitFor(() => {
      expect(fetchLogsAction).toHaveBeenCalledWith(
        expect.objectContaining({ level: "error", event: "plan" }),
      );
    });

    await waitFor(() => {
      expect(screen.getAllByTestId("log-row")).toHaveLength(1);
    });

    const row = screen.getByTestId("log-row");
    expect(within(row).getByText("plan.generated")).toBeDefined();
    // metadata is JSON-stringified (PII-safe scalars/ids).
    expect(within(row).getByText(/"planId":"p1"/)).toBeDefined();
  });

  it("shows an error message when the action returns a non-ok result", async () => {
    fetchLogsAction.mockResolvedValue({ kind: "forbidden" });

    renderWithIntl(<LogsView />);
    fireEvent.click(screen.getByTestId("logs-apply"));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeDefined();
    });
    expect(screen.queryByTestId("log-row")).toBeNull();
  });

  it("appends the next page and forwards the cursor when Load more is clicked", async () => {
    fetchLogsAction
      .mockResolvedValueOnce({
        kind: "ok",
        events: [makeEvent({ id: "e1", event: "first.event" })],
        nextCursor: "cursor-2",
      })
      .mockResolvedValueOnce({
        kind: "ok",
        events: [makeEvent({ id: "e2", event: "second.event" })],
        nextCursor: undefined,
      });

    renderWithIntl(<LogsView />);
    fireEvent.click(screen.getByTestId("logs-apply"));

    await waitFor(() => {
      expect(screen.getAllByTestId("log-row")).toHaveLength(1);
    });

    const loadMore = screen.getByTestId("logs-load-more");
    fireEvent.click(loadMore);

    await waitFor(() => {
      expect(screen.getAllByTestId("log-row")).toHaveLength(2);
    });

    // The second call forwarded the opaque cursor from the first page.
    expect(fetchLogsAction).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: "cursor-2" }),
    );
    // No further pages → the Load more control is gone.
    expect(screen.queryByTestId("logs-load-more")).toBeNull();
    expect(screen.getByText("first.event")).toBeDefined();
    expect(screen.getByText("second.event")).toBeDefined();
  });
});
