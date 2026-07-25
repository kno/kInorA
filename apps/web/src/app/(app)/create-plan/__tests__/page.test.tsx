// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";

type AnyProps = Record<string, unknown> & { children?: ReactNode };
type AnyElement = ReactElement<AnyProps>;

const cookieGet = vi.fn();
const loadCurrentDraft = vi.fn();
const getTranslations = vi.fn();
const fetchUserProfile = vi.fn();
const fetchUserPreferences = vi.fn();
const getBillingVisibility = vi.fn();

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: cookieGet })),
}));

// CreatePlanPage is a server component (`getTranslations`) — see
// `server-translator.ts` for why this is mocked rather than run for real
// (the real next-intl/server RSC build isn't available under Vitest).
vi.mock("next-intl/server", () => ({
  getTranslations: (...args: unknown[]) => getTranslations(...args),
}));

vi.mock("../actions", () => ({
  saveDraftAction: vi.fn(),
  confirmPlanSpecAction: vi.fn(),
  saveUserPreferencesAction: vi.fn(),
}));

vi.mock("../plan-draft-client", () => ({
  loadCurrentDraft: (...args: unknown[]) => loadCurrentDraft(...args),
}));

vi.mock("../../profile/profile-form-client", () => ({
  fetchUserProfile: (...args: unknown[]) => fetchUserProfile(...args),
}));

vi.mock("../preferences-client", () => ({
  fetchUserPreferences: (...args: unknown[]) => fetchUserPreferences(...args),
}));

vi.mock("../../billing/billing-client", () => ({
  getBillingVisibility: (...args: unknown[]) => getBillingVisibility(...args),
}));

// Stub CreatePlanShell so the page test asserts wiring, not the shell internals.
vi.mock("../CreatePlanShell", () => ({
  CreatePlanShell: (props: AnyProps) => ({
    type: "CreatePlanShell",
    props,
    key: null,
  }) as unknown as ReactElement,
}));

import CreatePlanPage from "../page";

beforeEach(() => {
  // Default: no Pro entitlement resolved → Free (Formulario) unless overridden.
  getBillingVisibility.mockResolvedValue({ kind: "error", message: "no_session" });
});

afterEach(() => {
  vi.clearAllMocks();
});

function proVisibility() {
  return { kind: "ok", data: { billing: { tier: "pro" } } };
}
function freeVisibility() {
  return { kind: "ok", data: { billing: { tier: "free" } } };
}

function mockUserMemorySuccess() {
  fetchUserProfile.mockResolvedValue({
    kind: "ok",
    profile: { userId: "u", name: "Ada", goal: null, experienceLevel: null },
  });
  fetchUserPreferences.mockResolvedValue({
    kind: "ok",
    preferences: {
      userId: "u",
      defaultLocation: null,
      defaultDuration: null,
      defaultEquipment: null,
    },
  });
}

describe("CreatePlanPage", () => {
  it("resolves copy server-side via next-intl's getTranslations (not resolvePageI18n)", async () => {
    cookieGet.mockReturnValue({ value: "tok-1" });
    loadCurrentDraft.mockResolvedValue(null);
    mockUserMemorySuccess();
    getTranslations.mockResolvedValue(() => "");

    await CreatePlanPage();

    expect(getTranslations).toHaveBeenCalled();
  });

  it("does NOT thread a messages prop to StepperShell", async () => {
    cookieGet.mockReturnValue({ value: "tok-1" });
    loadCurrentDraft.mockResolvedValue(null);
    mockUserMemorySuccess();
    getTranslations.mockResolvedValue(() => "");

    const page = (await CreatePlanPage()) as AnyElement;

    expect(page.props.messages).toBeUndefined();
  });

  it("hydrates the stepper with the current server draft when one exists", async () => {
    cookieGet.mockReturnValue({ value: "tok-1" });
    loadCurrentDraft.mockResolvedValue({ step: 3, spec: { goal: "strength" } });
    fetchUserProfile.mockResolvedValue({ kind: "ok", profile: { userId: "u", name: "Ada", goal: "strength", experienceLevel: "intermediate" } });
    fetchUserPreferences.mockResolvedValue({ kind: "ok", preferences: { userId: "u", defaultLocation: "gym", defaultDuration: 45, defaultEquipment: ["barbell"] } });
    getTranslations.mockResolvedValue(() => "");

    const page = (await CreatePlanPage()) as AnyElement;

    expect(loadCurrentDraft).toHaveBeenCalledWith("tok-1");
    expect(fetchUserProfile).toHaveBeenCalledWith("tok-1");
    expect(fetchUserPreferences).toHaveBeenCalledWith("tok-1");
    expect(page.props.initialDraft).toEqual({ step: 3, spec: { goal: "strength" } });
    expect(page.props.initialProfile).toEqual({ userId: "u", name: "Ada", goal: "strength", experienceLevel: "intermediate" });
    expect(page.props.initialPreferences).toEqual({ userId: "u", defaultLocation: "gym", defaultDuration: 45, defaultEquipment: ["barbell"] });
    expect(page.props.saveDraftAction).toBeDefined();
    expect(page.props.confirmPlanSpecAction).toBeDefined();
  });

  it("starts the stepper with no draft when the API has none", async () => {
    cookieGet.mockReturnValue({ value: "tok-2" });
    loadCurrentDraft.mockResolvedValue(null);
    fetchUserProfile.mockResolvedValue({ kind: "error", message: "api_unreachable" });
    fetchUserPreferences.mockResolvedValue({ kind: "error", message: "api_unreachable" });
    getTranslations.mockResolvedValue(() => "");

    const page = (await CreatePlanPage()) as AnyElement;

    expect(page.props.initialDraft).toBeUndefined();
    expect(page.props.initialProfile).toBeNull();
    expect(page.props.initialPreferences).toBeNull();
  });

  it("passes an undefined token when no session cookie is present", async () => {
    cookieGet.mockReturnValue(undefined);
    loadCurrentDraft.mockResolvedValue(null);
    mockUserMemorySuccess();
    getTranslations.mockResolvedValue(() => "");

    await CreatePlanPage();

    expect(loadCurrentDraft).toHaveBeenCalledWith(undefined);
  });

  it("defaults a Pro tenant to Asistente (tier resolved server-side)", async () => {
    cookieGet.mockReturnValue({ value: "tok-pro" });
    loadCurrentDraft.mockResolvedValue(null);
    mockUserMemorySuccess();
    getTranslations.mockResolvedValue(() => "");
    getBillingVisibility.mockResolvedValue(proVisibility());

    const page = (await CreatePlanPage()) as AnyElement;

    expect(getBillingVisibility).toHaveBeenCalledWith("tok-pro");
    expect(page.props.isPro).toBe(true);
    expect(page.props.defaultMode).toBe("asistente");
    expect(page.props.upgradePath).toBe("/billing#pro-card");
  });

  it("defaults a Free tenant to Formulario with the teaser flag", async () => {
    cookieGet.mockReturnValue({ value: "tok-free" });
    loadCurrentDraft.mockResolvedValue(null);
    mockUserMemorySuccess();
    getTranslations.mockResolvedValue(() => "");
    getBillingVisibility.mockResolvedValue(freeVisibility());

    const page = (await CreatePlanPage()) as AnyElement;

    expect(page.props.isPro).toBe(false);
    expect(page.props.defaultMode).toBe("formulario");
  });

  it("fails closed to Free when the billing read errors", async () => {
    cookieGet.mockReturnValue({ value: "tok-err" });
    loadCurrentDraft.mockResolvedValue(null);
    mockUserMemorySuccess();
    getTranslations.mockResolvedValue(() => "");
    getBillingVisibility.mockResolvedValue({ kind: "error", message: "api_unreachable" });

    const page = (await CreatePlanPage()) as AnyElement;

    expect(page.props.isPro).toBe(false);
    expect(page.props.defaultMode).toBe("formulario");
  });
});
