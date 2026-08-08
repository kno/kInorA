import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { IntlProvider } from "react-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UserProfile, WeightEntryDTO } from "@kinora/contracts";
import { resolveMessages } from "../../../i18n/locale.js";
import type {
  GetProfileResult,
  SaveProfileResult,
} from "../../../api/user-profile-client";
import type {
  CreateWeightEntryResult,
  ListWeightEntriesResult,
} from "../../../api/weight-entry-client";

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
  StyleSheet: { create: (styles: unknown) => styles },
}));

const ProfileScreen = (await import("../ProfileScreen.js")).default;

const emptyProfile: UserProfile = {
  userId: "user_1",
  name: "",
  goal: null,
  experienceLevel: null,
  selfDescribedSex: null,
  heightCm: null,
};

const filledProfile: UserProfile = {
  userId: "user_1",
  name: "Ada",
  goal: "strength",
  experienceLevel: "intermediate",
  selfDescribedSex: "female",
  heightCm: 172,
};

function findButton(renderer: ReactTestRenderer, testID: string) {
  return renderer.root.findAllByProps({ testID }).find((n) => n.type === "button")!;
}
function findInput(renderer: ReactTestRenderer, testID: string) {
  return renderer.root.findAllByProps({ testID }).find((n) => n.type === "input")!;
}

function renderScreen(props: Record<string, unknown> = {}) {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      <IntlProvider locale="en" messages={resolveMessages("en")}>
        <ProfileScreen {...props} />
      </IntlProvider>,
    );
  });
  return { renderer };
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("ProfileScreen (17c PR 5 — mobile profile parity)", () => {
  it("loads and renders name, goal, experience level, selfDescribedSex and height, and round-trips a save", async () => {
    const fetchUserProfile = vi
      .fn<() => Promise<GetProfileResult>>()
      .mockResolvedValue({ kind: "ok", profile: filledProfile });
    const fetchWeightEntries = vi
      .fn<() => Promise<ListWeightEntriesResult>>()
      .mockResolvedValue({ kind: "ok", entries: [] });
    const updateUserProfile = vi
      .fn<() => Promise<SaveProfileResult>>()
      .mockResolvedValue({ kind: "ok", profile: filledProfile });

    const { renderer } = renderScreen({ fetchUserProfile, fetchWeightEntries, updateUserProfile });
    await settle();

    expect(findInput(renderer, "profile-name-input").props.value).toBe("Ada");
    expect(findInput(renderer, "profile-height-input").props.value).toBe("172");
    expect(findButton(renderer, "goal-option-strength").props["accessibilityState"]).toEqual({
      selected: true,
    });
    expect(
      findButton(renderer, "experience-option-intermediate").props["accessibilityState"],
    ).toEqual({ selected: true });
    expect(
      findButton(renderer, "self-described-sex-option-female").props["accessibilityState"],
    ).toEqual({ selected: true });

    act(() => {
      findButton(renderer, "self-described-sex-option-prefer_not_to_say").props.onClick();
      findButton(renderer, "goal-option-hypertrophy").props.onClick();
    });
    await act(async () => {
      findButton(renderer, "profile-save-btn").props.onClick();
    });
    await settle();

    expect(updateUserProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Ada",
        goal: "hypertrophy",
        selfDescribedSex: "prefer_not_to_say",
        heightCm: 172,
      }),
      expect.anything(),
    );
    expect(renderer.root.findByProps({ testID: "profile-status" })).toBeTruthy();
  });

  it("posts a new weight reading, renders it newest-first, and shows the first-entry notice once", async () => {
    const existing: WeightEntryDTO = { id: "we_0", weightKg: 70, recordedAt: "2026-07-01T00:00:00.000Z" };
    const created: WeightEntryDTO = { id: "we_1", weightKg: 68, recordedAt: "2026-08-01T00:00:00.000Z" };

    const fetchUserProfile = vi
      .fn<() => Promise<GetProfileResult>>()
      .mockResolvedValue({ kind: "ok", profile: emptyProfile });
    const fetchWeightEntries = vi
      .fn<() => Promise<ListWeightEntriesResult>>()
      .mockResolvedValue({ kind: "ok", entries: [existing] });
    const createWeightEntry = vi
      .fn<() => Promise<CreateWeightEntryResult>>()
      .mockResolvedValue({ kind: "ok", entry: created, wasFirstEntry: true });

    const { renderer } = renderScreen({ fetchUserProfile, fetchWeightEntries, createWeightEntry });
    await settle();

    act(() => {
      findInput(renderer, "weight-entry-input").props.onChange({ target: { value: "68" } });
    });
    await act(async () => {
      findButton(renderer, "weight-entry-submit-btn").props.onClick();
    });
    await settle();

    expect(createWeightEntry).toHaveBeenCalledWith({ weightKg: 68 }, expect.anything());
    const rows = renderer.root.findAllByProps({ testID: "weight-entry-row" });
    expect(rows).toHaveLength(2);
    // Newest (August) first.
    const firstRowText = rows[0]!.findAll((n) => (n.type as unknown) === "Text")[0]!;
    expect(firstRowText.children.join("")).toContain("8/1/2026");
    expect(renderer.root.findByProps({ testID: "weight-volume-shift-notice" })).toBeTruthy();

    // Dismiss and a SECOND entry (wasFirstEntry: false) must not re-show it.
    act(() => {
      findButton(renderer, "weight-volume-shift-dismiss").props.onClick();
    });
    createWeightEntry.mockResolvedValue({
      kind: "ok",
      entry: { id: "we_2", weightKg: 69, recordedAt: "2026-08-02T00:00:00.000Z" },
      wasFirstEntry: false,
    });
    act(() => {
      findInput(renderer, "weight-entry-input").props.onChange({ target: { value: "69" } });
    });
    await act(async () => {
      findButton(renderer, "weight-entry-submit-btn").props.onClick();
    });
    await settle();

    expect(
      renderer.root.findAllByProps({ testID: "weight-volume-shift-notice" }),
    ).toHaveLength(0);
  });

  it("surfaces the API's 422 for an invalid selfDescribedSex without duplicating the enum check client-side", async () => {
    const fetchUserProfile = vi
      .fn<() => Promise<GetProfileResult>>()
      .mockResolvedValue({ kind: "ok", profile: emptyProfile });
    const fetchWeightEntries = vi
      .fn<() => Promise<ListWeightEntriesResult>>()
      .mockResolvedValue({ kind: "ok", entries: [] });
    const updateUserProfile = vi
      .fn<() => Promise<SaveProfileResult>>()
      .mockResolvedValue({ kind: "validation_error", message: "invalid_self_described_sex" });

    const { renderer } = renderScreen({ fetchUserProfile, fetchWeightEntries, updateUserProfile });
    await settle();

    act(() => {
      findButton(renderer, "self-described-sex-option-female").props.onClick();
    });
    await act(async () => {
      findButton(renderer, "profile-save-btn").props.onClick();
    });
    await settle();

    expect(renderer.root.findByProps({ testID: "profile-error" })).toBeTruthy();
  });

  it("surfaces the API's 422 for a non-positive/out-of-range heightCm without duplicating the bound client-side", async () => {
    const fetchUserProfile = vi
      .fn<() => Promise<GetProfileResult>>()
      .mockResolvedValue({ kind: "ok", profile: emptyProfile });
    const fetchWeightEntries = vi
      .fn<() => Promise<ListWeightEntriesResult>>()
      .mockResolvedValue({ kind: "ok", entries: [] });
    const updateUserProfile = vi
      .fn<() => Promise<SaveProfileResult>>()
      .mockResolvedValue({ kind: "validation_error", message: "invalid_height_cm" });

    const { renderer } = renderScreen({ fetchUserProfile, fetchWeightEntries, updateUserProfile });
    await settle();

    act(() => {
      findInput(renderer, "profile-height-input").props.onChange({ target: { value: "0" } });
    });
    await act(async () => {
      findButton(renderer, "profile-save-btn").props.onClick();
    });
    await settle();

    expect(updateUserProfile).toHaveBeenCalledWith(
      expect.objectContaining({ heightCm: 0 }),
      expect.anything(),
    );
    expect(renderer.root.findByProps({ testID: "profile-error" })).toBeTruthy();
  });

  it("rejects a non-positive weightKg with the specific invalid-weight copy, without calling the API", async () => {
    const fetchUserProfile = vi
      .fn<() => Promise<GetProfileResult>>()
      .mockResolvedValue({ kind: "ok", profile: emptyProfile });
    const fetchWeightEntries = vi
      .fn<() => Promise<ListWeightEntriesResult>>()
      .mockResolvedValue({ kind: "ok", entries: [] });
    const createWeightEntry = vi.fn<() => Promise<CreateWeightEntryResult>>();

    const { renderer } = renderScreen({ fetchUserProfile, fetchWeightEntries, createWeightEntry });
    await settle();

    act(() => {
      findInput(renderer, "weight-entry-input").props.onChange({ target: { value: "0" } });
    });
    await act(async () => {
      findButton(renderer, "weight-entry-submit-btn").props.onClick();
    });
    await settle();

    expect(createWeightEntry).not.toHaveBeenCalled();
    expect(renderer.root.findByProps({ testID: "weight-entry-error" })).toBeTruthy();
  });
});
