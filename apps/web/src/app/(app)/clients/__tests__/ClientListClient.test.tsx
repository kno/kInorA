// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import type { ClientSummaryDTO } from "@kinora/contracts";
import { renderWithIntl } from "@/test-utils/render-with-intl";
import { ClientListClient } from "../ClientListClient";

afterEach(() => {
  vi.clearAllMocks();
});

const clients: ClientSummaryDTO[] = [
  { clientUserId: "user_1" as never, email: "client1@test.com", status: "active" },
  { clientUserId: "user_2" as never, email: "client2@test.com", status: "invited" },
];

describe("ClientListClient", () => {
  it("renders the empty state when there are no clients", () => {
    renderWithIntl(
      <ClientListClient initialClients={[]} inviteClientAction={vi.fn()} />,
    );

    expect(screen.getByTestId("clients-empty")).toBeDefined();
  });

  it("renders the client list with email and status", () => {
    renderWithIntl(
      <ClientListClient initialClients={clients} inviteClientAction={vi.fn()} />,
    );

    expect(screen.getAllByTestId("client-row")).toHaveLength(2);
    expect(screen.getByText("client1@test.com")).toBeDefined();
    expect(screen.getByText("client2@test.com")).toBeDefined();
    expect(screen.getAllByRole("link", { name: "Create plan" })).toHaveLength(2);
  });

  it("renders the load error state when the initial fetch failed", () => {
    renderWithIntl(
      <ClientListClient
        initialClients={[]}
        initialError="fetch_clients_failed"
        inviteClientAction={vi.fn()}
      />,
    );

    expect(screen.getByRole("alert").textContent).toContain("couldn't load");
  });

  it("invites a client by email and shows a success status", async () => {
    const inviteClientAction = vi.fn().mockResolvedValue({ kind: "ok" });

    renderWithIntl(
      <ClientListClient initialClients={[]} inviteClientAction={inviteClientAction} />,
    );

    fireEvent.change(screen.getByRole("textbox", { name: "Client email" }), {
      target: { value: "new@test.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send invite" }));

    await waitFor(() => {
      expect(inviteClientAction).toHaveBeenCalledWith("new@test.com");
    });
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain("Invitation sent");
    });
  });

  it("shows a specific error when the client is already assigned", async () => {
    const inviteClientAction = vi
      .fn()
      .mockResolvedValue({ kind: "error", message: "client_already_assigned" });

    renderWithIntl(
      <ClientListClient initialClients={[]} inviteClientAction={inviteClientAction} />,
    );

    fireEvent.change(screen.getByRole("textbox", { name: "Client email" }), {
      target: { value: "taken@test.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send invite" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("already assigned");
    });
  });
});
