import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { IntlProvider } from "react-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveMessages } from "../../../i18n/locale.js";
import type { CreatePlanForClientResult } from "../../../api/trainer-client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("react-native", () => ({
  View: "View",
  Text: "Text",
  ScrollView: ({ children, ...rest }: any) => <div {...rest}>{children}</div>,
  TextInput: ({ onChangeText, value, ...rest }: any) => (
    <input value={value} onChange={(e: any) => onChangeText?.(e.target.value)} {...rest} />
  ),
  Pressable: ({ children, style, onPress, disabled, ...rest }: any) => (
    <button type="button" onClick={onPress} disabled={disabled} {...rest}>
      {typeof children === "function" ? children({ pressed: false }) : children}
    </button>
  ),
  ActivityIndicator: "ActivityIndicator",
  StyleSheet: { create: (styles: unknown) => styles },
}));

const ClientCreatePlanScreen = (await import("../ClientCreatePlanScreen.js")).default;

function findButton(renderer: ReactTestRenderer, testID: string) {
  return renderer.root
    .findAllByProps({ testID })
    .find((n) => n.type === "button")!;
}

function renderScreen(props: Record<string, unknown> = {}) {
  const navigation = { navigate: vi.fn() } as any;
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      <IntlProvider locale="en" messages={resolveMessages("en")}>
        <ClientCreatePlanScreen
          navigation={navigation}
          route={{ params: { clientUserId: "user_1" } }}
          {...props}
        />
      </IntlProvider>,
    );
  });
  return { renderer, navigation };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("ClientCreatePlanScreen", () => {
  it("submits the default minimal spec and navigates to PlanStatus on success", async () => {
    const createPlanForClient = vi
      .fn<() => Promise<CreatePlanForClientResult>>()
      .mockResolvedValue({ kind: "ok", planId: "plan_1", status: "generating" });

    const { renderer, navigation } = renderScreen({ createPlanForClient });

    const submitBtn = findButton(renderer, "submit-btn");
    await act(async () => {
      submitBtn.props.onClick();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(createPlanForClient).toHaveBeenCalledWith(
      "user_1",
      {
        goal: "strength",
        daysPerWeek: 3,
        sessionDurationMinutes: 45,
        location: "gym",
        equipment: [],
        limitations: [],
      },
      expect.anything(),
    );
    expect(navigation.navigate).toHaveBeenCalledWith("PlanStatus", { planId: "plan_1" });
  });

  it("threads a selected goal and location into the submitted spec", async () => {
    const createPlanForClient = vi
      .fn<() => Promise<CreatePlanForClientResult>>()
      .mockResolvedValue({ kind: "ok", planId: "plan_1", status: "generating" });

    const { renderer } = renderScreen({ createPlanForClient });

    act(() => {
      findButton(renderer, "goal-option-hypertrophy").props.onClick();
      findButton(renderer, "location-option-home").props.onClick();
    });

    await act(async () => {
      findButton(renderer, "submit-btn").props.onClick();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(createPlanForClient).toHaveBeenCalledWith(
      "user_1",
      expect.objectContaining({ goal: "hypertrophy", location: "home" }),
      expect.anything(),
    );
  });

  it("shows a forbidden-specific error when the trainer is not authorized for this client", async () => {
    const createPlanForClient = vi
      .fn<() => Promise<CreatePlanForClientResult>>()
      .mockResolvedValue({ kind: "error", message: "forbidden" });

    const { renderer, navigation } = renderScreen({ createPlanForClient });

    await act(async () => {
      findButton(renderer, "submit-btn").props.onClick();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(renderer.root.findByProps({ testID: "create-plan-error" }).children.join("")).toContain(
      "not authorized",
    );
    expect(navigation.navigate).not.toHaveBeenCalled();
  });
});
