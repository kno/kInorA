import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { IntlProvider } from "react-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClientSummaryDTO } from "@kinora/contracts";
import { resolveMessages } from "../../../i18n/locale.js";
import type { FetchClientsResult, InviteClientResult } from "../../../api/trainer-client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("react-native", () => ({
  View: "View",
  Text: "Text",
  ScrollView: ({ children, ...rest }: any) => <div {...rest}>{children}</div>,
  TextInput: ({ onChangeText, value, ...rest }: any) => (
    <input
      value={value}
      onChange={(e: any) => onChangeText?.(e.target.value)}
      {...rest}
    />
  ),
  Pressable: ({ children, style, onPress, disabled, ...rest }: any) => (
    <button type="button" onClick={onPress} disabled={disabled} {...rest}>
      {typeof children === "function" ? children({ pressed: false }) : children}
    </button>
  ),
  ActivityIndicator: "ActivityIndicator",
  StyleSheet: { create: (styles: unknown) => styles },
}));

const ClientListScreen = (await import("../ClientListScreen.js")).default;

const clients: ClientSummaryDTO[] = [
  { clientUserId: "user_1" as never, email: "client1@test.com", status: "active" },
  { clientUserId: "user_2" as never, email: "client2@test.com", status: "invited" },
];

function makeClient(
  overrides: {
    fetchClients?: (...a: any[]) => Promise<FetchClientsResult>;
    inviteClient?: (...a: any[]) => Promise<InviteClientResult>;
  } = {},
) {
  return {
    fetchClients:
      overrides.fetchClients ??
      vi.fn<() => Promise<FetchClientsResult>>(async () => ({ kind: "ok", clients })),
    inviteClient:
      overrides.inviteClient ?? vi.fn<() => Promise<InviteClientResult>>(async () => ({ kind: "ok" })),
  };
}

function renderScreen(props: Record<string, unknown> = {}) {
  const navigation = { navigate: vi.fn() } as any;
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      <IntlProvider locale="en" messages={resolveMessages("en")}>
        <ClientListScreen navigation={navigation} {...props} />
      </IntlProvider>,
    );
  });
  return { renderer, navigation };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("ClientListScreen", () => {
  it("renders the client list with email/status and a create-plan action per row", async () => {
    const client = makeClient();
    const { renderer } = renderScreen({ client });
    await flush();

    const rows = renderer.root.findAllByProps({ testID: "client-row" });
    expect(rows).toHaveLength(2);
    expect(
      renderer.root.findAllByProps({ testID: "create-plan-btn" }).filter((n) => n.type === "button"),
    ).toHaveLength(2);
  });

  it("navigates to ClientCreatePlan with the selected clientUserId", async () => {
    const client = makeClient();
    const { renderer, navigation } = renderScreen({ client });
    await flush();

    const [firstCreateBtn] = renderer.root
      .findAllByProps({ testID: "create-plan-btn" })
      .filter((n) => n.type === "button");
    act(() => {
      firstCreateBtn!.props.onClick();
    });

    expect(navigation.navigate).toHaveBeenCalledWith("ClientCreatePlan", {
      clientUserId: "user_1",
    });
  });

  it("renders the access-restricted state on a forbidden (non-trainer) response", async () => {
    const client = makeClient({
      fetchClients: vi.fn<() => Promise<FetchClientsResult>>(async () => ({ kind: "forbidden" })),
    });
    const { renderer } = renderScreen({ client });
    await flush();

    expect(renderer.root.findByProps({ testID: "clients-forbidden" })).toBeDefined();
  });

  it("renders the empty state when there are no clients", async () => {
    const client = makeClient({ fetchClients: vi.fn<() => Promise<FetchClientsResult>>(async () => ({ kind: "ok", clients: [] })) });
    const { renderer } = renderScreen({ client });
    await flush();

    expect(renderer.root.findByProps({ testID: "clients-empty" })).toBeDefined();
  });

  it("renders the error state and retries on a network failure", async () => {
    const fetchClients = vi
      .fn<() => Promise<FetchClientsResult>>()
      .mockResolvedValueOnce({ kind: "error", message: "api_unreachable" })
      .mockResolvedValueOnce({ kind: "ok", clients: [] });
    const client = makeClient({ fetchClients });
    const { renderer } = renderScreen({ client });
    await flush();

    expect(renderer.root.findByProps({ testID: "clients-error" })).toBeDefined();

    const retryBtn = renderer.root
      .findAllByProps({ testID: "retry-btn" })
      .find((n) => n.type === "button")!;
    act(() => {
      retryBtn.props.onClick();
    });
    await flush();

    expect(fetchClients).toHaveBeenCalledTimes(2);
    expect(renderer.root.findByProps({ testID: "clients-empty" })).toBeDefined();
  });

  it("invites a client by email and shows a success status", async () => {
    const inviteClient = vi.fn<() => Promise<InviteClientResult>>(async () => ({ kind: "ok" }));
    const client = makeClient({
      fetchClients: vi.fn<() => Promise<FetchClientsResult>>(async () => ({ kind: "ok", clients: [] })),
      inviteClient,
    });
    const { renderer } = renderScreen({ client });
    await flush();

    const input = renderer.root
      .findAllByProps({ testID: "invite-email-input" })
      .find((n) => n.type === "input")!;
    act(() => {
      input.props.onChange({ target: { value: "new@test.com" } });
    });
    const submitBtn = renderer.root
      .findAllByProps({ testID: "invite-submit-btn" })
      .find((n) => n.type === "button")!;
    await act(async () => {
      submitBtn.props.onClick();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(inviteClient).toHaveBeenCalledWith("new@test.com", expect.anything());
    expect(renderer.root.findByProps({ testID: "invite-status" }).children.join("")).toContain(
      "Invitation sent",
    );
  });
});
