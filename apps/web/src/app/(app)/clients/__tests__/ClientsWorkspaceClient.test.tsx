// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import type { ClientSummaryDTO } from "@kinora/contracts";
import { renderWithIntl } from "@/test-utils/render-with-intl";
import { ClientsWorkspaceClient } from "../ClientsWorkspaceClient";

/** Installs a controllable `window.matchMedia`, returning a setter for `.matches`. */
function mockMatchMedia(initialMatches: boolean) {
  let matches = initialMatches;
  const listeners: Array<(event: { matches: boolean }) => void> = [];

  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    media: query,
    get matches() {
      return matches;
    },
    addEventListener: (_: string, listener: (event: { matches: boolean }) => void) => {
      listeners.push(listener);
    },
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;

  return {
    setMatches(next: boolean) {
      matches = next;
      listeners.forEach((listener) => listener({ matches: next }));
    },
  };
}

beforeEach(() => {
  mockMatchMedia(true);
});

afterEach(() => {
  vi.clearAllMocks();
});

const clients: ClientSummaryDTO[] = [
  {
    clientUserId: "user_1" as never,
    email: "elena.lopez@correo.com",
    status: "active",
    name: "Elena López",
    lastSessionAt: null,
    completionRate: 92,
  },
  {
    clientUserId: "user_2" as never,
    email: "pablo.nieto@correo.com",
    status: "invited",
  },
];

describe("ClientsWorkspaceClient", () => {
  it("renders the empty state when there are no clients", () => {
    renderWithIntl(<ClientsWorkspaceClient clients={[]} inviteClientAction={vi.fn()} />);

    expect(screen.getByTestId("clients-empty")).toBeDefined();
  });

  it("renders the load error state when the initial fetch failed", () => {
    renderWithIntl(
      <ClientsWorkspaceClient clients={[]} initialError="fetch_clients_failed" inviteClientAction={vi.fn()} />,
    );

    expect(screen.getByRole("alert").textContent).toContain("couldn't load");
  });

  it("renders rich rows: display name (or email fallback), recency and adherence", () => {
    renderWithIntl(
      <ClientsWorkspaceClient clients={clients} selectedClientUserId="user_1" inviteClientAction={vi.fn()} />,
    );

    const rows = screen.getAllByTestId("client-row");
    expect(rows).toHaveLength(2);
    expect(screen.getByText("Elena López")).toBeDefined();
    expect(screen.getByText("elena.lopez@correo.com")).toBeDefined();
    // No name on user_2 -> falls back to the email local-part, not the email.
    expect(screen.getByText("pablo.nieto")).toBeDefined();
    // user_1 has no lastSessionAt -> honest "no sessions" copy, not a fabricated date.
    expect(screen.getByText("No sessions yet")).toBeDefined();
    expect(screen.getByText("92% adherence")).toBeDefined();
    // Invited client: pending copy instead of a recency/adherence guess.
    expect(screen.getByText("Pending acceptance")).toBeDefined();
  });

  it("marks the selected row with aria-selected", () => {
    renderWithIntl(
      <ClientsWorkspaceClient clients={clients} selectedClientUserId="user_2" inviteClientAction={vi.fn()} />,
    );

    const options = screen.getAllByRole("option");
    expect(options[0]?.getAttribute("aria-selected")).toBe("false");
    expect(options[1]?.getAttribute("aria-selected")).toBe("true");
  });

  it("filters the roster by search term, over name/email", () => {
    renderWithIntl(<ClientsWorkspaceClient clients={clients} inviteClientAction={vi.fn()} />);

    fireEvent.change(screen.getByRole("searchbox", { name: "Search clients" }), {
      target: { value: "pablo" },
    });

    expect(screen.getAllByTestId("client-row")).toHaveLength(1);
    expect(screen.getByText("pablo.nieto")).toBeDefined();
  });

  it("shows a distinct no-matches state when the search excludes every client", () => {
    renderWithIntl(<ClientsWorkspaceClient clients={clients} inviteClientAction={vi.fn()} />);

    fireEvent.change(screen.getByRole("searchbox", { name: "Search clients" }), {
      target: { value: "nobody-like-this" },
    });

    expect(screen.getByTestId("clients-no-matches")).toBeDefined();
    expect(screen.queryByTestId("clients-empty")).toBeNull();
  });

  it("filters the roster by status via the segmented control", () => {
    renderWithIntl(<ClientsWorkspaceClient clients={clients} inviteClientAction={vi.fn()} />);

    fireEvent.click(screen.getByTestId("client-filter-invited"));

    expect(screen.getAllByTestId("client-row")).toHaveLength(1);
    expect(screen.getByText("pablo.nieto")).toBeDefined();
  });

  it("points roster row links into the workspace URL on desktop", () => {
    renderWithIntl(
      <ClientsWorkspaceClient clients={clients} selectedClientUserId="user_1" inviteClientAction={vi.fn()} />,
    );

    const link = screen.getAllByRole("option")[0] as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/clients?client=user_1");
  });

  it("points roster row links to the standalone detail route on narrow viewports", () => {
    mockMatchMedia(false);
    renderWithIntl(
      <ClientsWorkspaceClient clients={clients} selectedClientUserId="user_1" inviteClientAction={vi.fn()} />,
    );

    const link = screen.getAllByRole("option")[0] as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/clients/user_1");
  });

  describe("invite sheet", () => {
    it("opens on the header CTA, focusing the email field, and is not shown until then", () => {
      renderWithIntl(<ClientsWorkspaceClient clients={clients} inviteClientAction={vi.fn()} />);

      expect(screen.queryByTestId("invite-sheet")).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "Invite client" }));

      const sheet = screen.getByTestId("invite-sheet");
      expect(sheet.getAttribute("role")).toBe("dialog");
      expect(sheet.getAttribute("aria-modal")).toBe("true");
      expect(document.activeElement).toBe(screen.getByLabelText("Client email"));
    });

    it("closes on Escape and returns focus to the trigger", () => {
      renderWithIntl(<ClientsWorkspaceClient clients={clients} inviteClientAction={vi.fn()} />);

      const trigger = screen.getByRole("button", { name: "Invite client" });
      fireEvent.click(trigger);
      expect(screen.getByTestId("invite-sheet")).toBeDefined();

      fireEvent.keyDown(screen.getByTestId("invite-sheet"), { key: "Escape" });

      expect(screen.queryByTestId("invite-sheet")).toBeNull();
      expect(document.activeElement).toBe(trigger);
    });

    it("closes on backdrop click", () => {
      const { container } = renderWithIntl(<ClientsWorkspaceClient clients={clients} inviteClientAction={vi.fn()} />);

      fireEvent.click(screen.getByRole("button", { name: "Invite client" }));
      const overlay = container.querySelector('[class*="sheetOverlay"]') as HTMLElement;
      fireEvent.click(overlay);

      expect(screen.queryByTestId("invite-sheet")).toBeNull();
    });

    it("closes on Cancel", () => {
      renderWithIntl(<ClientsWorkspaceClient clients={clients} inviteClientAction={vi.fn()} />);

      fireEvent.click(screen.getByRole("button", { name: "Invite client" }));
      fireEvent.click(screen.getByTestId("invite-sheet-cancel"));

      expect(screen.queryByTestId("invite-sheet")).toBeNull();
    });

    it("submits the invite and shows a success status", async () => {
      const inviteClientAction = vi.fn().mockResolvedValue({ kind: "ok" });
      renderWithIntl(<ClientsWorkspaceClient clients={clients} inviteClientAction={inviteClientAction} />);

      fireEvent.click(screen.getByRole("button", { name: "Invite client" }));
      fireEvent.change(screen.getByLabelText("Client email"), { target: { value: "new@test.com" } });
      fireEvent.click(screen.getByRole("button", { name: "Send invite" }));

      await waitFor(() => {
        expect(inviteClientAction).toHaveBeenCalledWith("new@test.com");
      });
      await waitFor(() => {
        expect(screen.getByRole("status").textContent).toContain("Invitation sent");
      });
    });

    it("shows a specific error status when the client is already assigned", async () => {
      const inviteClientAction = vi.fn().mockResolvedValue({ kind: "error", message: "client_already_assigned" });
      renderWithIntl(<ClientsWorkspaceClient clients={clients} inviteClientAction={inviteClientAction} />);

      fireEvent.click(screen.getByRole("button", { name: "Invite client" }));
      fireEvent.change(screen.getByLabelText("Client email"), { target: { value: "taken@test.com" } });
      fireEvent.click(screen.getByRole("button", { name: "Send invite" }));

      await waitFor(() => {
        expect(screen.getByRole("alert").textContent).toContain("already assigned");
      });
    });

    it("opens from the empty state's invite CTA too", () => {
      renderWithIntl(<ClientsWorkspaceClient clients={[]} inviteClientAction={vi.fn()} />);

      fireEvent.click(screen.getAllByRole("button", { name: "Invite client" })[0]!);

      expect(screen.getByTestId("invite-sheet")).toBeDefined();
    });
  });
});
